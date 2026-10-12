import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import yazl from "yazl";
import * as tar from "tar";

test("surface-only archives validate and restore without enabling caves", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mydst-backup-test-"));
  process.env.MYDST_ROOT = root;
  const { config } = await import("../dist/server/config.js");
  const { BackupService } = await import("../dist/server/backup-service.js");
  const { gameConfig } = await import("../dist/server/game-config.js");
  const { StateStore } = await import("../dist/server/store.js");
  const backups = new BackupService();
  const surface = {
    "Cluster_1/cluster.ini": "[NETWORK]\ncluster_name=Surface\n[GAMEPLAY]\ngame_mode=survival\n[SHARD]\nshard_enabled=true\ncaves_enabled=true\ncaves_ever_enabled=true\n",
    "Cluster_1/Master/server.ini": "[SHARD]\nis_master=true\n[NETWORK]\nserver_port=8489\n",
    "Cluster_1/Master/save/session/test/0000000001": "surface-save"
  };
  fs.mkdirSync(config.backupRoot, { recursive: true });
  async function zip(name, files) {
    const archive = new yazl.ZipFile();
    for (const [entry, content] of Object.entries(files)) archive.addBuffer(Buffer.from(content), entry);
    const completed = new Promise((resolve, reject) => {
      const output = fs.createWriteStream(path.join(config.backupRoot, name));
      output.on("error", reject).on("close", resolve);
      archive.outputStream.on("error", reject).pipe(output);
    });
    archive.end();
    await completed;
    return name;
  }
  try {
    await t.test("root and wrapped surface ZIPs are accepted", async () => {
      await backups.validate(await zip("surface.zip", surface));
      await backups.validate(await zip("root.zip", Object.fromEntries(Object.entries(surface).map(([name, content]) => [name.slice("Cluster_1/".length), content]))));
      await backups.validate(await zip("wrapped.zip", Object.fromEntries(Object.entries(surface).map(([name, content]) => [`upload/${name}`, content]))));
    });
    await t.test("restore removes an old cave world and clears stale cave flags before ports are recreated", async () => {
      gameConfig.ensureLayout();
      const oldSave = path.join(config.clusterRoot, "Caves", "save", "session", "old", "0000000001");
      fs.mkdirSync(path.dirname(oldSave), { recursive: true });
      fs.writeFileSync(oldSave, "old-cave");
      await backups.restore("surface.zip", () => {});
      assert.equal(gameConfig.syncCavesFromRestoredSave(), false);
      gameConfig.restorePanelPorts({ masterPort: 8490, cavesPort: 8115, steamMasterPort: 12346, steamCavesPort: 12347 });
      const restored = gameConfig.get();
      assert.equal(restored.cavesEnabled, false);
      assert.equal(restored.cavesEnabledLocked, false);
      assert.equal(restored.masterPort, 8490);
      assert.equal(fs.existsSync(oldSave), false);
      assert.equal(fs.readFileSync(path.join(config.clusterRoot, "Master", "save", "session", "test", "0000000001"), "utf8"), "surface-save");
    });
    await t.test("existing cave configuration remains required and validated when cave files exist", async () => {
      const full = { ...surface, "Cluster_1/Caves/server.ini": "[SHARD]\nis_master=false\n[NETWORK]\nserver_port=8114\n", "Cluster_1/Caves/save/session/test/0000000001": "cave-save" };
      await backups.validate(await zip("both.zip", full));
      await backups.restore("both.zip", () => {});
      assert.equal(gameConfig.syncCavesFromRestoredSave(), true);
      assert.equal(gameConfig.get().cavesEnabledLocked, true);
      await assert.rejects(backups.validate(await zip("partial.zip", { ...surface, "Cluster_1/Caves/save/session/test/0000000001": "save" })), /Caves\/server.ini/);
      await assert.rejects(backups.validate(await zip("invalid-caves.zip", { ...surface, "Cluster_1/Caves/server.ini": "invalid" })), /洞穴分片配置/);
      await assert.rejects(backups.validate(await zip("invalid-master.zip", { ...surface, "Cluster_1/Master/server.ini": "invalid" })), /地面分片配置/);
    });
    await t.test("surface tar.gz accepted, missing master and partial caves rejected", async () => {
      const input = path.join(root, "tar-input");
      for (const [name, content] of Object.entries(surface)) {
        const destination = path.join(input, name);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content);
      }
      await tar.c({ gzip: true, cwd: input, file: path.join(config.backupRoot, "surface.tar.gz") }, ["Cluster_1"]);
      await backups.validate("surface.tar.gz");
      const demo = config.demo;
      try {
        config.demo = false;
        await backups.restore("surface.tar.gz", () => {});
        assert.equal(gameConfig.syncCavesFromRestoredSave(), false);
        assert.equal(gameConfig.get().cavesEnabled, false);
      } finally { config.demo = demo; }
      fs.mkdirSync(path.join(input, "Cluster_1", "Caves"));
      fs.writeFileSync(path.join(input, "Cluster_1", "Caves", "save-file"), "save");
      await tar.c({ gzip: true, cwd: input, file: path.join(config.backupRoot, "partial.tar.gz") }, ["Cluster_1"]);
      await assert.rejects(backups.validate("partial.tar.gz"), /Caves\/server.ini/);
      fs.unlinkSync(path.join(input, "Cluster_1", "Master", "server.ini"));
      await tar.c({ gzip: true, cwd: input, file: path.join(config.backupRoot, "invalid.tar.gz") }, ["Cluster_1"]);
      await assert.rejects(backups.validate("invalid.tar.gz"), /Master\/server.ini/);
    });
    await t.test("old panel state gets disabled announcements; settings and cursor survive restart", () => {
      fs.writeFileSync(config.stateFile, JSON.stringify({ users: [], sessions: [], schedules: { retentionCount: 7 }, audit: [] }));
      const store = new StateStore();
      assert.equal(store.snapshot().announcements.enabled, false);
      assert.equal(store.snapshot().schedules.retentionCount, 7);
      const settings = { ...store.snapshot().announcements, enabled: true, messages: ["A", "B"] };
      store.setAnnouncements(settings);
      const runtime = { ...store.snapshot().announcementRuntime, nextMessageIndex: 1, lastSentAt: 123456, lastScheduledSlot: "2026-10-12 20:00" };
      store.setAnnouncementRuntime(runtime);
      const restarted = new StateStore();
      assert.deepEqual(restarted.snapshot().announcementRuntime, runtime);
      assert.deepEqual(restarted.snapshot().announcements, settings);
      restarted.setAnnouncements(settings);
      assert.deepEqual(restarted.snapshot().announcementRuntime, runtime, "saving unchanged settings preserves progress");
      restarted.setAnnouncements({ ...settings, messages: ["new"] });
      restarted.setAnnouncementRuntime(runtime);
      assert.equal(restarted.snapshot().announcementRuntime.nextMessageIndex, 0, "stale sends cannot overwrite new settings");
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
