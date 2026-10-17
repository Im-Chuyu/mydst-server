const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mydst-mod-options-ui-"));
  const sources = {
    "3590648641": `name="Map Options" local function option(description,data) return {description=description,data=data} end configuration_options={{name="maprevealer",label="共享地图",options={option("开启",true),option("关闭",false)},default=true}}`,
    "3802676080": `name="Key Options" local function keys() local result={{description="Disabled",data="DISABLED"}} for i=1,12 do result[#result+1]={description="F"..i,data="F"..i} end return result end configuration_options={{name="wheel",label="额外快捷键",options=keys(),default="F5"}}`
  };
  fs.writeFileSync(path.join(root, "mods.json"), JSON.stringify(Object.keys(sources).map((id) => ({ id, name: id === "3590648641" ? "Map Options" : "Key Options", previewUrl: "", enabled: true, configuration: "{}" }))));
  for (const [id, source] of Object.entries(sources)) {
    const directory = path.join(root, "game", "mods", `workshop-${id}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "modinfo.lua"), source);
  }
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["dist/server/index.js"], { env: { ...process.env, PORT: String(port), MYDST_ROOT: root, MYDST_DEMO: "true", NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  let browser;
  try {
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
      if (attempt >= 100) throw new Error(`Server failed to start: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const setup = await page.request.post(`${base}/api/auth/setup`, { data: { username: "options-admin", password: "ModOptionsTest123!" } });
    assert.ok(setup.ok(), await setup.text());
    await page.goto(base);
    await page.getByRole("button", { name: "MOD 管理", exact: true }).click();
    const map = page.locator("#server-mod-3590648641");
    await map.getByRole("button", { name: /配置/ }).click();
    const mapSelect = map.locator(".mod-option select");
    await mapSelect.waitFor();
    assert.deepEqual(await mapSelect.locator("option").allTextContents(), ["开启", "关闭"]);
    await mapSelect.selectOption("1");
    const keys = page.locator("#server-mod-3802676080");
    await keys.getByRole("button", { name: /配置/ }).click();
    const keySelect = keys.locator(".mod-option select");
    await keySelect.waitFor();
    assert.equal(await keySelect.locator("option").count(), 13);
    await keySelect.selectOption({ label: "F12" });
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/mods") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    assert.ok((await saved).ok());
    await page.getByRole("status").filter({ hasText: "MOD 配置已保存" }).waitFor();
    const mods = JSON.parse(fs.readFileSync(path.join(root, "mods.json"), "utf8"));
    assert.match(mods.find((mod) => mod.id === "3590648641").configuration, /\["maprevealer"\]\s*=\s*false/);
    assert.match(mods.find((mod) => mod.id === "3802676080").configuration, /\["wheel"\]\s*=\s*"F12"/);
    await page.reload();
    await page.getByRole("button", { name: "MOD 管理", exact: true }).click();
    await keys.getByRole("button", { name: /配置/ }).click();
    await keySelect.waitFor();
    assert.equal(await keySelect.locator("option:checked").textContent(), "F12");
    await map.getByRole("button", { name: /配置/ }).click();
    await mapSelect.waitFor();
    assert.equal(await mapSelect.locator("option:checked").textContent(), "关闭");
    assert.deepEqual(errors, []);
    console.log("MOD options UI passed: complete dropdowns, non-default selection, save and reload preserve boolean and shortcut values");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    if (server.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
