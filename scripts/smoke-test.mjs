import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yazl from "yazl";
import { parseModInfoOptions } from "../dist/server/lua-config.js";
import { extractWorkshopIds } from "../dist/server/workshop-service.js";

const root = path.resolve(".runtime-smoke");
fs.rmSync(root, { recursive: true, force: true });
const port = 3199;
const child = spawn(process.execPath, ["dist/server/index.js"], {
  env: { ...process.env, PORT: String(port), MYDST_ROOT: root, MYDST_DEMO: "true", NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

const base = `http://127.0.0.1:${port}/api`;
let cookie = "";
let csrfToken = "";

async function call(url, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (csrfToken && !["GET", "HEAD"].includes(options.method || "GET")) headers.set("X-CSRF-Token", csrfToken);
  if (options.body && typeof options.body !== "string" && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${base}${url}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const text = await response.text();
  const body = text ? (response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text) : undefined;
  assert.ok(response.ok, `${options.method || "GET"} ${url}: ${response.status} ${text}`);
  if (body?.csrfToken) csrfToken = body.csrfToken;
  return body;
}

try {
  assert.deepEqual(extractWorkshopIds(`
    <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=351325790">Geometric Placement</a>
    <div data-publishedfileid="378160973"></div>
    <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=351325790">duplicate</a>
  `), ["351325790", "378160973"]);
  const parsedModOptions = parseModInfoOptions(`
    local levels = {}
    for i = 1, 3 do levels[i] = { description = "Level "..i, data = i } end
    configuration_options = {
      { name = "LEVEL", label = "Level", options = levels, default = 2 },
      { name = "ACTIVE", label = "Active", options = { { description = "On", data = true }, { description = "Off", data = false } }, default = true },
    }
  `);
  assert.equal(parsedModOptions.length, 2);
  assert.equal(parsedModOptions[0].choices.length, 3);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const health = await call("/health");
      if (health.status === "ok") break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (attempt === 39) throw new Error(`Server did not start:\n${output}`);
  }

  const setup = await call("/auth/setup", {
    method: "POST",
    body: { username: "admin", password: "StrongPass123!" }
  });
  csrfToken = setup.csrfToken;
  assert.equal(setup.user.username, "admin");

  const registeredUser = await call("/auth/register", { method: "POST", body: { username: "player001", password: "StrongPass456!" } });
  assert.equal(registeredUser.role, "user");
  const userPortsResponse = await fetch(`${base}/admin/ports`, { headers: { Cookie: cookie } });
  assert.equal(userPortsResponse.status, 403);
  await call("/auth/logout", { method: "POST" });
  const adminLogin = await call("/auth/login", { method: "POST", body: { username: "admin", password: "StrongPass123!" } });
  assert.equal(adminLogin.role, "admin");
  const initialPorts = await call("/admin/ports");
  assert.equal(initialPorts.masterPort, 8489);
  assert.equal(initialPorts.cavesPort, 8114);

  const configBeforePortAttempt = await call("/config");
  configBeforePortAttempt.clusterToken = "pds-g^smoke-test-token";
  configBeforePortAttempt.masterPort = 9000;
  configBeforePortAttempt.cavesPort = 9001;
  const configAfterPortAttempt = await call("/config", { method: "PUT", body: configBeforePortAttempt });
  assert.equal(configAfterPortAttempt.masterPort, 8489);
  assert.equal(configAfterPortAttempt.cavesPort, 8114);
  const adminPorts = { ...initialPorts, masterPort: 8490, cavesPort: 8115 };
  const savedAdminPorts = await call("/admin/ports", { method: "PUT", body: adminPorts });
  assert.equal(savedAdminPorts.masterPort, 8490);
  assert.equal(savedAdminPorts.cavesPort, 8115);

  const gameConfig = await call("/config");
  gameConfig.clusterToken = "pds-g^smoke-test-token";
  gameConfig.clusterName = "Smoke Test Server";
  gameConfig.playstyle = "relaxed";
  const saved = await call("/config", { method: "PUT", body: gameConfig });
  assert.equal(saved.clusterName, "Smoke Test Server");
  assert.equal(saved.playstyle, "relaxed");
  assert.equal(saved.gameMode, "survival");
  assert.equal(saved.cavesEnabled, true);
  gameConfig.cavesEnabled = false;
  const cavesDisabled = await call("/config", { method: "PUT", body: gameConfig });
  assert.equal(cavesDisabled.cavesEnabled, false);
  gameConfig.cavesEnabled = true;
  const cavesReenabled = await call("/config", { method: "PUT", body: gameConfig });
  assert.equal(cavesReenabled.cavesEnabled, true);
  const masterWorld = await call("/world/master");
  assert.match(masterWorld, /(?:settings_preset|preset)\s*=\s*"RELAXED"/);
  assert.match(masterWorld, /overrides\s*=\s*\{\}/);

  const status = await call("/server/action", { method: "POST", body: { action: "start", shard: "all" } });
  assert.equal(status.master.running, true);
  assert.equal(status.caves.running, true);

  const dashboard = await call("/dashboard");
  assert.equal(dashboard.server.configured, true);
  assert.equal(dashboard.room.name, "Smoke Test Server");
  assert.equal(dashboard.room.playstyle, "relaxed");
  assert.equal(dashboard.world.day, 23);
  assert.equal(dashboard.onlinePlayers, 1);
  assert.equal(dashboard.room.directConnect, "c_connect('127.0.0.1',8490)");
  assert.ok(dashboard.system.cpu.cores >= 1);

  const visual = await call("/world/master/visual");
  const caveVisual = await call("/world/caves/visual");
  const allDefinitions = new Map([...visual.definitions, ...caveVisual.definitions].map((item) => [`${item.category}:${item.key}`, item]));
  assert.equal(allDefinitions.size, 234);
  assert.equal([...allDefinitions.values()].filter((item) => item.category === "worldgen").length, 82);
  assert.equal([...allDefinitions.values()].filter((item) => item.category === "settings").length, 152);
  assert.equal(visual.definitions.find((item) => item.key === "hounds").defaultValue, "rare");
  assert.ok([...allDefinitions.values()].every((item) => item.label && item.choices.length && item.icon));
  visual.overrides.autumn = "longseason";
  visual.overrides.custom_mod_setting = true;
  const savedVisual = await call("/world/master/visual", { method: "PUT", body: { overrides: visual.overrides } });
  assert.equal(savedVisual.overrides.autumn, "longseason");
  assert.equal(savedVisual.overrides.custom_mod_setting, true);

  const chat = await call("/chat?shard=all&limit=20");
  assert.equal(chat.length, 2);
  await call("/server/save", { method: "POST" });
  await call("/server/announce", { method: "POST", body: { message: "Smoke test announcement" } });
  const rollback = await call("/server/rollback", { method: "POST", body: { snapshots: 1 } });
  assert.equal(rollback.snapshots, 1);

  const resetJob = await call("/server/reset-world", { method: "POST" });
  assert.equal(resetJob.type, "world-reset");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = (await call("/jobs")).find((item) => item.id === resetJob.id);
    if (job?.status === "success") break;
    if (job?.status === "failed") throw new Error(`World reset failed: ${job.error}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 29) throw new Error("World reset job did not finish");
  }
  assert.ok((await call("/backups")).some((item) => item.name.includes("before-world-reset")));

  const players = await call("/players");
  assert.equal(players.length, 1);
  assert.equal(players[0].shard, "master");
  assert.equal(players[0].admin, false);
  await call(`/players/${players[0].userId}/access`, { method: "POST", body: { type: "admin", enabled: true } });
  await call(`/players/${players[0].userId}/access`, { method: "POST", body: { type: "white", enabled: true } });
  assert.deepEqual(await call("/access/admin"), [players[0].userId]);
  assert.deepEqual(await call("/access/white"), [players[0].userId]);
  const privilegedPlayer = (await call("/players"))[0];
  assert.equal(privilegedPlayer.admin, true);
  assert.equal(privilegedPlayer.whitelisted, true);
  await call(`/players/${players[0].userId}/kick`, { method: "POST" });

  const modJob = await call("/mods/workshop/351325790/download", { method: "POST", body: { title: "Geometric Placement" } });
  assert.equal(modJob.type, "mod-download:351325790");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = (await call("/jobs")).find((item) => item.id === modJob.id);
    if (job?.status === "success") break;
    if (job?.status === "failed") throw new Error(`MOD download failed: ${job.error}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 29) throw new Error("MOD download job did not finish");
  }
  const mods = await call("/mods");
  assert.equal(mods.length, 1);
  assert.equal(mods[0].id, "351325790");
  const modConfiguration = await call("/mods/351325790/configuration");
  assert.equal(modConfiguration.installed, true);
  assert.equal(modConfiguration.options.length, 2);
  mods[0].configuration = '{ ["LANGUAGE"] = "zh", ["ENABLED"] = false }';
  await call("/mods", { method: "PUT", body: mods });
  const updatedConfiguration = await call("/mods/351325790/configuration");
  assert.equal(updatedConfiguration.values.LANGUAGE, "zh");
  assert.equal(updatedConfiguration.values.ENABLED, false);
  const invalidMods = structuredClone(mods);
  invalidMods[0].configuration = '{ ["BROKEN"] = os.execute("bad") }';
  const invalidModResponse = await fetch(`${base}/mods`, { method: "PUT", headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json" }, body: JSON.stringify(invalidMods) });
  assert.equal(invalidModResponse.ok, false);
  assert.match((await invalidModResponse.json()).error, /字符串键|Lua 配置/);

  const caveSaveFile = path.join(root, "data", "DoNotStarveTogether", "Cluster_1", "Caves", "save", "session", "smoke", "0000000001");
  fs.mkdirSync(path.dirname(caveSaveFile), { recursive: true });
  fs.writeFileSync(caveSaveFile, "cave-save-data");
  const lockedConfig = await call("/config");
  assert.equal(lockedConfig.cavesEnabledLocked, true);
  lockedConfig.cavesEnabled = false;
  const lockedResponse = await fetch(`${base}/config`, { method: "PUT", headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json" }, body: JSON.stringify(lockedConfig) });
  assert.equal(lockedResponse.ok, false);
  assert.match((await lockedResponse.json()).error, /不可关闭/);

  const deleteSaveJob = await call("/server/delete-save", { method: "POST" });
  assert.equal(deleteSaveJob.type, "save-delete");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = (await call("/jobs")).find((item) => item.id === deleteSaveJob.id);
    if (job?.status === "success") break;
    if (job?.status === "failed") throw new Error(`Save delete failed: ${job.error}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 29) throw new Error("Save delete job did not finish");
  }
  const stoppedAfterDelete = await call("/server/status");
  assert.equal(stoppedAfterDelete.master.running, false);
  assert.equal(stoppedAfterDelete.caves.running, false);
  assert.equal(fs.existsSync(path.join(root, "data", "DoNotStarveTogether", "Cluster_1", "Master", "save")), false);
  assert.equal(fs.existsSync(path.join(root, "data", "DoNotStarveTogether", "Cluster_1", "Caves", "save")), false);
  assert.ok((await call("/backups")).some((item) => item.name.includes("before-save-delete")));
  const unlockedConfig = await call("/config");
  assert.equal(unlockedConfig.cavesEnabledLocked, false);
  unlockedConfig.cavesEnabled = false;
  const disabledAfterDelete = await call("/config", { method: "PUT", body: unlockedConfig });
  assert.equal(disabledAfterDelete.cavesEnabled, false);
  assert.equal(disabledAfterDelete.cavesEnabledLocked, false);

  await call("/backups", { method: "POST", body: { label: "smoke" } });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const backups = await call("/backups");
  assert.ok(backups.length >= 1);

  const validZip = await createZip({
    "Cluster_1/cluster.ini": "[NETWORK]\ncluster_name=ZIP Test\n[GAMEPLAY]\ngame_mode=survival\n",
    "Cluster_1/Master/server.ini": "[SHARD]\nis_master=true\n[NETWORK]\nserver_port=8489\n",
    "Cluster_1/Caves/server.ini": "[SHARD]\nis_master=false\n[NETWORK]\nserver_port=8114\n",
    "Cluster_1/Master/save/session/demo/0000000001": "save-data",
    "Cluster_1/Caves/save/session/demo/0000000001": "cave-save-data"
  });
  const uploadBody = new FormData();
  uploadBody.append("file", new Blob([validZip], { type: "application/zip" }), "cluster.zip");
  const uploaded = await call("/backups/upload", { method: "POST", body: uploadBody });
  assert.match(uploaded.name, /cluster\.zip$/);
  const configAfterUpload = await call("/config");
  assert.equal(configAfterUpload.cavesEnabled, false);
  assert.equal(configAfterUpload.cavesEnabledLocked, false);

  const restoreJob = await call(`/backups/${encodeURIComponent(uploaded.name)}/restore`, { method: "POST" });
  assert.equal(restoreJob.type, "backup-restore");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = (await call("/jobs")).find((item) => item.id === restoreJob.id);
    if (job?.status === "success") break;
    if (job?.status === "failed") throw new Error(`Backup restore failed: ${job.error}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 29) throw new Error("Backup restore job did not finish");
  }
  const configAfterRestore = await call("/config");
  assert.equal(configAfterRestore.cavesEnabled, true);
  assert.equal(configAfterRestore.cavesEnabledLocked, true);
  assert.equal(configAfterRestore.masterPort, 8490);
  assert.equal(configAfterRestore.cavesPort, 8115);
  assert.equal((await call("/server/status")).caves.running, false);

  const invalidZip = await createZip({ "Cluster_1/readme.txt": "not a save" });
  const invalidBody = new FormData();
  invalidBody.append("file", new Blob([invalidZip], { type: "application/zip" }), "invalid.zip");
  const invalidResponse = await fetch(`${base}/backups/upload`, { method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrfToken }, body: invalidBody });
  assert.equal(invalidResponse.ok, false);
  assert.match((await invalidResponse.json()).error, /cluster\.ini/);

  await call("/auth/logout", { method: "POST" });
  console.log("Smoke test passed: cave lifecycle, world options, player access, MOD config, dashboard, save, rollback, backup restore, logout");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  fs.rmSync(root, { recursive: true, force: true });
}

function createZip(files) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks = [];
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
    for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), name);
    zip.end();
  });
}
