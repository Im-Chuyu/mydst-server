import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("startup validates every enabled mod in one Steam session and synchronizes every loaded copy", async (t) => {
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
      });
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
      }), /启动已取消.*3645824994/);
      assert.equal(calls, 2);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
