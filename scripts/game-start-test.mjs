import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { config } from "../dist/server/config.js";
import { gameConfig } from "../dist/server/game-config.js";
import { GameService } from "../dist/server/game-service.js";

test("shard startup updates mods before launching and preserves lifecycle safety", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mydst-start-test-"));
  const original = { ...config };
  Object.assign(config, {
    demo: false,
    root,
    dataRoot: path.join(root, "data"),
    backupRoot: path.join(root, "backups"),
    clusterRoot: path.join(root, "data", "DoNotStarveTogether", "Cluster_1"),
    gameRoot: path.join(root, "game"),
    gameBinary64: path.join(root, "game", "bin64", "server"),
    gameBinary32: path.join(root, "game", "bin", "server")
  });
  try {
    gameConfig.ensureLayout();
    gameConfig.save({
      ...gameConfig.get(),
      clusterToken: "test-cluster-token",
      masterPort: 8394,
      cavesPort: 8340
    });
    fs.mkdirSync(path.dirname(config.gameBinary64), { recursive: true });
    fs.writeFileSync(config.gameBinary64, "");
    // Inject the updater so lifecycle checks never need real Steam/network access.
    gameConfig.saveMods([{ id: "3802676080", name: "Test Mod", enabled: true, configuration: "{}" }]);
    const logFile = (shard) => path.join(config.clusterRoot, shard, "server_log.txt");
    const ok = { code: 0, stdout: "", stderr: "" };

    await t.test("both shards start, concurrent requests do not duplicate sessions", async () => {
      const sessions = new Set();
      const launches = [];
      let updates = 0;
      const service = new GameService(async (command, args, options) => {
        assert.equal(command, "tmux");
        if (args[0] === "has-session") {
          assert.match(args[2], /^=mydst-/);
          return { ...ok, code: sessions.has(args[2].slice(1)) ? 0 : 1 };
        }
        assert.equal(args[0], "new-session");
        assert.equal(options.env.MYDST_ROOT, root);
        assert.equal(options.env.TMUX_TMPDIR, path.join(root, "tmux"));
        assert.ok(updates > 0, "mods must be updated before the first shard launches");
        launches.push(args[3]);
        sessions.add(args[3]);
        fs.writeFileSync(logFile(args[5]), args[5] === "Master"
          ? "[00:00:25]: Server registered via geo DNS\n"
          : "[00:00:27]: [Shard] secondary shard LUA is now ready!\n");
        return ok;
      }, async () => { updates++; });
      await Promise.all([service.action("start", "all"), service.action("start", "all")]);
      assert.deepEqual(launches, ["mydst-master", "mydst-caves"]);
      assert.equal((await service.status()).caves.running, true);
      assert.equal(updates, 1, "both shards share a single update pass");
      sessions.clear();
      for (const shard of ["Master", "Caves"]) fs.unlinkSync(logFile(shard));
      await service.action("start", "all");
      assert.equal(updates, 2, "every new startup checks updates, including starts seconds apart");
    });

    await t.test("update failure cancels launch rather than silently using stale versions", async () => {
      let launched = false;
      const service = new GameService(async (_command, args) => {
        if (args[0] === "new-session") launched = true;
        return { ...ok, code: 1 };
      }, async () => { throw new Error("Steam mod update failed"); });
      await assert.rejects(service.action("start", "all"), /Steam mod update failed/);
      assert.equal(launched, false);
    });

    await t.test("partial restart refuses mixed mod versions before stopping either shard", async () => {
      const calls = [];
      const service = new GameService(async (_command, args) => { calls.push(args[0]); return ok; }, async () => {});
      await assert.rejects(service.action("restart", "master"), /全部重启/);
      assert.ok(calls.every((call) => call === "has-session"));
    });

    await t.test("truncated log that regrows beyond the old size is detected", () => {
      const service = new GameService();
      fs.writeFileSync(logFile("Master"), "old startup\n".repeat(100));
      const cursor = service.logCursor("master");
      fs.writeFileSync(logFile("Master"), "new startup\n[00:00:25]: Sim paused\n" + "new data\n".repeat(500));
      const lines = service.readLogAfter("master", cursor);
      assert.ok(lines.includes("[00:00:25]: Sim paused"));
      assert.equal(cursor.offset, 0);
    });

    await t.test("reset cursor stays reset as the new log grows", () => {
      const service = new GameService();
      fs.writeFileSync(logFile("Caves"), "previous log\n".repeat(100));
      const cursor = service.logCursor("caves");
      fs.writeFileSync(logFile("Caves"), "new startup\n");
      service.readLogAfter("caves", cursor);
      fs.appendFileSync(logFile("Caves"), "[00:00:27]: secondary shard LUA is now ready!\n" + "data\n".repeat(500));
      assert.ok(service.readLogAfter("caves", cursor).some((line) => line.includes("LUA is now ready")));
    });

    await t.test("unchanged old ready messages are not accepted", () => {
      const service = new GameService();
      fs.writeFileSync(logFile("Master"), "[00:00:25]: Sim paused\n" + "old data\n".repeat(100));
      const cursor = service.logCursor("master");
      assert.deepEqual(service.readLogAfter("master", cursor), []);
      fs.appendFileSync(logFile("Master"), "still starting\n");
      assert.deepEqual(service.readLogAfter("master", cursor), ["still starting"]);
    });

    await t.test("console uses an explicit pane and checks Enter failures", async () => {
      const calls = [];
      const service = new GameService(async (_command, args) => {
        calls.push(args);
        return args.includes("Enter") ? { ...ok, code: 1, stderr: "pane unavailable" } : ok;
      });
      await assert.rejects(service.console("master", "c_save()"), /pane unavailable/);
      assert.deepEqual(calls[1], ["send-keys", "-t", "mydst-master:0.0", "-l", "c_save()"]);
    });

    await t.test("failed startup includes recent game output", async () => {
      const service = new GameService(async (_command, args) => {
        if (args[0] === "new-session") {
          fs.writeFileSync(logFile("Master"), "[00:00:01]: LUA ERROR: broken mod\n");
          return ok;
        }
        return { ...ok, code: 1 };
      });
      await assert.rejects(service.start("master"), /LUA ERROR: broken mod/);
    });
  } finally {
    Object.assign(config, original);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
