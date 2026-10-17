import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("startup checks published versions and only downloads changed or missing mods", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mydst-mod-start-"));
  process.env.MYDST_ROOT = root;
  const { config } = await import("../dist/server/config.js");
  const { gameConfig } = await import("../dist/server/game-config.js");
  const { updateEnabledMods } = await import("../dist/server/mod-workshop-service.js");
  config.demo = false;
  fs.mkdirSync(path.dirname(config.steamcmd), { recursive: true });
  fs.writeFileSync(config.steamcmd, "fake executable for injected command");
  gameConfig.ensureLayout();
  const ids = ["2287303119", "3645824994"];
  const versions = ids.map((id, i) => ({ id, manifestId: String(8145995609209102369n - BigInt(i)), updatedAt: 123456 }));
  const checkVersions = async () => versions;
  gameConfig.saveMods([...ids.map((id) => ({ id, name: id, enabled: true, configuration: "{}" })), { id: "351325790", name: "Disabled", enabled: false, configuration: "{}" }]);
  function seed(directory, version) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "modinfo.lua"), `version="${version}"`);
  }
  try {
    await t.test("current SteamCMD results override stale local, UGC and other Steam cache copies", async () => {
      for (const id of ids) {
        seed(path.join(config.gameRoot, "mods", `workshop-${id}`), "old-local");
        seed(path.join(config.dataRoot, "ugc", "content", "322330", id), "old-ugc");
        seed(path.join(root, "Steam", "steamapps", "workshop", "content", "322330", id), "old-cache");
        seed(path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", id), "latest");
      }
      let calls = 0;
      await updateEnabledMods(() => {}, async (command, args) => {
        calls++;
        assert.equal(command, config.steamcmd);
        assert.equal(args.filter((arg) => arg === "+login").length, 1);
        assert.equal(args.filter((arg) => arg === "+workshop_download_item").length, 2);
        assert.ok(!args.includes("351325790"), "disabled mods must not be updated");
        return { code: 0, stderr: "", stdout: ids.map((id) => `Success. Downloaded item ${id} to "${path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", id)}" (100 bytes)`).join("\n") };
      }, checkVersions);
      assert.equal(calls, 1);
      for (const id of ids) {
        assert.equal(fs.readFileSync(path.join(config.gameRoot, "mods", `workshop-${id}`, "modinfo.lua"), "utf8"), 'version="latest"');
        assert.equal(fs.readFileSync(path.join(config.dataRoot, "ugc", "content", "322330", id, "modinfo.lua"), "utf8"), 'version="latest"');
      }
    });
    await t.test("a zero exit code with partial successes still cancels startup", async () => {
      let calls = 0;
      await assert.rejects(updateEnabledMods(() => {}, async () => {
        calls++;
        return { code: 0, stderr: "", stdout: `Success. Downloaded item ${ids[0]} to "${path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", ids[0])}" (100 bytes)` };
      }, checkVersions), /启动已取消.*3645824994/);
      assert.equal(calls, 2);
    });
    function saveManifest(root) {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "appworkshop_322330.acf"), `"AppWorkshop" { "WorkshopItemsInstalled" { ${versions.map((v) => `"${v.id}" { "manifest" "${v.manifestId}" "timeupdated" "${v.updatedAt}" }`).join(" ")} } }`);
    }
    await t.test("unchanged mods start without any SteamCMD invocation or rewriting current files", async () => {
      saveManifest(path.join(config.gameRoot, "steamapps", "workshop"));
      saveManifest(path.join(config.dataRoot, "ugc"));
      const files = ids.map((id) => path.join(config.dataRoot, "ugc", "content", "322330", id, "modinfo.lua"));
      const before = files.map((file) => fs.statSync(file).mtimeMs);
      let checks = 0;
      const messages = [];
      for (let i = 0; i < 2; i++) await updateEnabledMods((line) => messages.push(line), async () => { throw new Error("must not launch SteamCMD"); }, async () => { checks++; return versions; });
      assert.equal(checks, 2, "each startup checks current metadata without a cooldown");
      assert.deepEqual(files.map((file) => fs.statSync(file).mtimeMs), before);
      assert.ok(messages.some((line) => line.includes("无需下载，直接启动")));
    });
    await t.test("only a changed manifest is downloaded; unchanged and disabled mods are excluded", async () => {
      let calls = 0;
      const latest = [{ ...versions[0], manifestId: "8145995609209102370" }, versions[1]];
      await updateEnabledMods(() => {}, async (_command, args) => {
        calls++;
        assert.ok(args.includes(ids[0]));
        assert.ok(!args.includes(ids[1]));
        assert.ok(!args.includes("validate"), "a version check must not force a full validation");
        return { code: 0, stderr: "", stdout: `Success. Downloaded item ${ids[0]} to "${path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", ids[0])}" (100 bytes)` };
      }, async () => latest);
      assert.equal(calls, 1);
    });
    await t.test("a stale local override is repaired from an existing current copy without downloading", async () => {
      const local = path.join(config.gameRoot, "mods", `workshop-${ids[0]}`);
      seed(local, "stale-override");
      await updateEnabledMods(() => {}, async () => { throw new Error("must use current local cache"); }, checkVersions);
      assert.equal(fs.readFileSync(path.join(local, "modinfo.lua"), "utf8"), 'version="latest"');
    });
    await t.test("failed or incomplete version checks never trigger unconditional downloads", async () => {
      let calls = 0;
      const command = async () => { calls++; throw new Error("unexpected download"); };
      await assert.rejects(updateEnabledMods(() => {}, command, async () => { throw new Error("metadata unavailable"); }), /metadata unavailable/);
      await assert.rejects(updateEnabledMods(() => {}, command, async () => []), /无法检查模组版本/);
      assert.equal(calls, 0);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
