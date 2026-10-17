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
    "3802676080": `name="Key Options" local zh=locale=="zh" local function keys() local result={{description=zh and "关闭" or "Disabled",data="DISABLED"}} for i=1,12 do result[#result+1]={description="F"..i,data="F"..i} end return result end configuration_options={{name="wheel",label=zh and "额外快捷键" or "Extra Key",options=keys(),default="F5"}}`
  };
  fs.writeFileSync(path.join(root, "mods.json"), JSON.stringify(Object.keys(sources).map((id) => ({ id, name: id === "3590648641" ? "Map Options" : "Key Options", previewUrl: "", enabled: true, configuration: "{}" }))));
  for (const [id, source] of Object.entries(sources)) {
    const directory = path.join(root, "game", "mods", `workshop-${id}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "modinfo.lua"), source);
  }
  const cachedCopies = [path.join(root, "game", "mods", "workshop-351325790"), path.join(root, "data", "ugc", "content", "322330", "351325790")];
  for (const directory of cachedCopies) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "modinfo.lua"), 'name="Geometric Placement"');
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
    await page.route("https://images.steamusercontent.com/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") }));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const setup = await page.request.post(`${base}/api/auth/setup`, { data: { username: "options-admin", password: "ModOptionsTest123!" } });
    assert.ok(setup.ok(), await setup.text());
    const chineseConfig = await (await page.request.get(`${base}/api/mods/3802676080/configuration`)).json();
    assert.equal(chineseConfig.options[0].label, "额外快捷键");
    const englishConfig = await (await page.request.get(`${base}/api/mods/3802676080/configuration?language=en`)).json();
    assert.equal(englishConfig.options[0].label, "Extra Key");
    assert.equal((await page.request.get(`${base}/api/mods/3802676080/configuration?language=invalid`)).status(), 400);
    await page.goto(base);
    await page.getByRole("button", { name: "MOD 管理", exact: true }).click();
    const cached = page.locator('.mod-library-item[data-mod-id="351325790"]');
    await cached.locator("img").waitFor();
    assert.match(await cached.locator("img").getAttribute("src"), /^https:\/\//);
    await cached.getByRole("button", { name: /删除.*缓存/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
    assert.ok(cachedCopies.every((directory) => fs.existsSync(directory)));
    const protectedItem = page.locator('.mod-library-item[data-mod-id="3590648641"]');
    assert.equal(await protectedItem.getByRole("button", { name: /删除.*缓存/ }).isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await page.setViewportSize({ width: 1440, height: 900 });
    await cached.getByRole("button", { name: /删除.*缓存/ }).click();
    const deleted = page.waitForResponse((response) => response.url().endsWith("/api/mods/library/351325790") && response.request().method() === "DELETE");
    await page.getByRole("dialog").getByRole("button", { name: "删除缓存", exact: true }).click();
    assert.equal((await deleted).status(), 204);
    await cached.waitFor({ state: "detached" });
    assert.ok(cachedCopies.every((directory) => !fs.existsSync(directory)));
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
    const language = keys.getByLabel("Key Options 配置显示语言");
    assert.equal(await language.inputValue(), "zh");
    assert.equal(await keySelect.locator("option").first().textContent(), "关闭");
    await keySelect.selectOption({ label: "F12" });
    await language.selectOption("en");
    await keySelect.waitFor();
    assert.equal(await keySelect.locator("option").first().textContent(), "Disabled");
    assert.equal(await keySelect.locator("option:checked").textContent(), "F12");
    assert.match(await keys.locator(".mod-option").innerText(), /Extra Key/);
    assert.equal(await map.getByLabel("Map Options 配置显示语言").count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await page.setViewportSize({ width: 1440, height: 900 });
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
    assert.equal(await language.inputValue(), "en");
    assert.equal(await keySelect.locator("option:checked").textContent(), "F12");
    await language.selectOption("zh");
    await keySelect.waitFor();
    assert.equal(await keySelect.locator("option").first().textContent(), "关闭");
    assert.equal(await keySelect.locator("option:checked").textContent(), "F12");
    await map.getByRole("button", { name: /配置/ }).click();
    await mapSelect.waitFor();
    assert.equal(await mapSelect.locator("option:checked").textContent(), "关闭");
    assert.deepEqual(errors, []);
    assert.equal(await map.getByLabel("Map Options 配置显示语言").inputValue(), "zh");
    console.log("MOD UI passed: library deletion/covers, default Chinese, English switching, remembered per-mod language, unsaved/saved values preserved, mobile layout and complete options");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    if (server.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
