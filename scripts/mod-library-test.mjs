import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("library metadata and deletion include inactive mods and all cache locations", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mydst-library-test-"));
  process.env.MYDST_ROOT = root;
  const { config } = await import("../dist/server/config.js");
  const { gameConfig } = await import("../dist/server/game-config.js");
  const { listModLibrary, deleteCachedMod } = await import("../dist/server/mod-workshop-service.js");
  const id = "351325790";
  const copies = [
    path.join(config.gameRoot, "mods", `workshop-${id}`),
    path.join(root, "Steam", "steamapps", "workshop", "content", "322330", id),
    path.join(root, "steamapps", "workshop", "content", "322330", id),
    path.join(root, "steamcmd", "steamapps", "workshop", "content", "322330", id),
    path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", id),
    path.join(config.dataRoot, "ugc", "mods", `workshop-${id}`),
    path.join(config.dataRoot, "ugc", "322330", id),
    path.join(config.dataRoot, "ugc", "content", "322330", id),
    path.join(config.dataRoot, "ugc", "Cluster_1", "Master", "content", "322330", id)
  ];
  const previewUrl = "https://images.steamusercontent.com/test-preview.png";
  function seed(directory, name = "Geometric Placement") {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "modinfo.lua"), `name = "${name}"`);
  }
  try {
    gameConfig.ensureLayout();
    gameConfig.saveMods([]);
    copies.forEach((directory) => seed(directory));
    await t.test("inactive mods fetch their own cover and metadata survives another request", async () => {
      let calls = 0;
      const library = await listModLibrary(async (ids) => {
        assert.deepEqual(ids, [id]);
        calls++;
        return [{ id, title: "Geometric Placement", previewUrl }];
      });
      assert.equal(library.length, 1);
      assert.equal(library[0].inServer, false);
      assert.equal(library[0].previewUrl, previewUrl);
      const cached = await listModLibrary(async () => { throw new Error("must use persistent metadata"); });
      assert.equal(cached[0].previewUrl, previewUrl);
      assert.equal(calls, 1);
    });
    await t.test("cover persists when an existing mod is removed from the server list", async () => {
      gameConfig.saveMods([{ id, name: "Geometric Placement", previewUrl, enabled: false, configuration: "{}" }]);
      assert.equal((await listModLibrary())[0].previewUrl, previewUrl);
      assert.throws(() => deleteCachedMod(id), /先从服务器/);
      assert.ok(copies.every((directory) => fs.existsSync(directory)));
      gameConfig.saveMods([]);
      assert.equal((await listModLibrary())[0].previewUrl, previewUrl);
    });
    await t.test("deletion removes every copy without touching another mod, config or workshop containers", async () => {
      const other = path.join(config.gameRoot, "mods", "workshop-378160973");
      seed(other, "Other Mod");
      const before = fs.readFileSync(path.join(root, "mods.json"), "utf8");
      deleteCachedMod(id);
      assert.ok(copies.every((directory) => !fs.existsSync(directory)));
      assert.ok(fs.existsSync(path.join(other, "modinfo.lua")));
      assert.ok(fs.existsSync(path.join(config.dataRoot, "ugc", "content", "322330")));
      assert.equal(fs.readFileSync(path.join(root, "mods.json"), "utf8"), before);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, "mod-library-metadata.json"), "utf8"))[id], undefined);
      assert.equal((await listModLibrary(async () => [] )).some((item) => item.id === id), false);
      assert.throws(() => deleteCachedMod("../mods"), /无效/);
      assert.throws(() => deleteCachedMod(id), /没有找到/);
    });
    await t.test("UGC-only mods are found and missing Steam metadata does not hide the library", async () => {
      const directory = path.join(config.dataRoot, "ugc", "content", "322330", "9999912345");
      seed(directory);
      const library = await listModLibrary(async () => { throw new Error("offline"); });
      assert.ok(library.some((item) => item.id === "9999912345"));
      deleteCachedMod("9999912345");
      assert.equal(fs.existsSync(directory), false);
    });
    await t.test("symlink directories are never followed or deleted", async () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mydst-library-outside-"));
      const link = path.join(config.gameRoot, "mods", "workshop-9999988888");
      try {
        seed(outside);
        fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
        assert.equal((await listModLibrary(async () => [])).some((item) => item.id === "9999988888"), false);
        assert.throws(() => deleteCachedMod("9999988888"), /没有找到/);
        assert.ok(fs.existsSync(path.join(outside, "modinfo.lua")));
      } finally {
        if (fs.existsSync(link)) fs.unlinkSync(link);
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
