const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(".runtime-visual");
const results = path.resolve("test-results");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(results, { recursive: true });
const port = 3200;
const server = spawn(process.execPath, ["dist/server/index.js"], {
  env: { ...process.env, PORT: String(port), MYDST_ROOT: root, MYDST_DEMO: "true", NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Visual test server did not start:\n${output}`);
}

async function assertViewport(page, name) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  assert.ok(sizes.scroll <= sizes.viewport + 1, `${name} has horizontal overflow: ${JSON.stringify(sizes)}`);
}

(async () => {
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined
    });
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await desktop.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => errors.push(`${request.url()} ${request.failure()?.errorText}`));
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(results, "login-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop login");
    await page.getByLabel("管理员账号").fill("admin");
    await page.getByLabel("管理员密码").fill("StrongPass123!");
    await page.getByRole("button", { name: "创建管理员" }).click();
    await page.getByText("MyServer", { exact: true }).waitFor();
    await page.getByText("直连代码", { exact: true }).waitFor();
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
    await page.getByRole("button", { name: "复制直连代码" }).click();
    await page.getByRole("status").filter({ hasText: "直连命令已复制" }).waitFor();
    await page.screenshot({ path: path.join(results, "dashboard-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop dashboard");
    await page.getByRole("button", { name: "重置世界" }).waitFor();
    await page.getByRole("button", { name: "删除存档", exact: true }).click();
    await page.getByRole("dialog").getByText("删除当前存档", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(results, "delete-save-confirm-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop delete-save confirmation");
    await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "房间配置" }).click();
    await page.getByText("房间信息").waitFor();
    const playstyle = page.locator("label.field").filter({ hasText: "玩法模式" }).locator("select");
    const cavesToggle = page.getByRole("switch", { name: /开启洞穴世界/ });
    await cavesToggle.waitFor();
    assert.equal(await cavesToggle.getAttribute("aria-checked"), "true");
    await playstyle.selectOption("endless");
    const clusterToken = page.locator("label.field").filter({ hasText: "Cluster Token" }).locator("input");
    await clusterToken.fill("");
    await clusterToken.pressSequentially("pds-g^visual-test-token", { delay: 5 });
    await clusterToken.press("Tab");
    assert.equal(await clusterToken.inputValue(), "pds-g^visual-test-token");
    const configResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/config") && response.request().method() === "PUT");
    await page.getByRole("button", { name: "保存配置" }).click();
    const configResponse = await configResponsePromise;
    assert.ok(configResponse.ok(), `Config save failed: ${await configResponse.text()}\nRequest: ${configResponse.request().postData()}`);
    const configToast = page.getByRole("status").filter({ hasText: "房间配置已保存" });
    await configToast.waitFor();
    assert.match(await configToast.innerText(), /房间配置已保存/);
    await assertViewport(page, "desktop config after playstyle save");
    assert.equal(await playstyle.inputValue(), "endless");
    await page.screenshot({ path: path.join(results, "config-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop config");
    await page.getByRole("button", { name: "玩家与名单" }).click();
    await page.getByText("测试玩家", { exact: true }).waitFor();
    await page.getByRole("button", { name: "管理员", exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(results, "players-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop players");
    await page.getByRole("button", { name: "世界设置" }).click();
    await page.getByPlaceholder("搜索设置名称或键名").waitFor();
    await page.screenshot({ path: path.join(results, "world-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop world settings");
    await page.getByRole("button", { name: "MOD 管理" }).click();
    await page.getByPlaceholder("输入模组名称或 Workshop ID").waitFor();
    await page.route("**/api/mods/workshop/search?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "351325790", title: "Geometric Placement", previewUrl: "" }]) }));
    await page.getByPlaceholder("输入模组名称或 Workshop ID").fill("Geometric Placement");
    await page.getByPlaceholder("输入模组名称或 Workshop ID").press("Enter");
    await page.getByText("Geometric Placement", { exact: true }).waitFor();
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.getByRole("button", { name: "下载中", exact: true }).waitFor();
    await page.screenshot({ path: path.join(results, "mods-downloading-desktop.png"), fullPage: true });
    const modRow = page.locator("#server-mod-351325790");
    await modRow.waitFor({ timeout: 10_000 });
    await modRow.getByRole("button", { name: /配置/ }).click();
    await modRow.getByText("显示语言", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(results, "mods-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop mods");
    await page.getByRole("button", { name: "存档备份" }).click();
    await page.getByRole("button", { name: "上传存档" }).waitFor();
    await page.screenshot({ path: path.join(results, "backups-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop backups");
    await page.getByRole("button", { name: "系统设置" }).click();
    await page.getByText("管理员端口", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(results, "admin-settings-desktop.png"), fullPage: true });
    await assertViewport(page, "desktop admin settings");
    assert.deepEqual(errors, [], `Browser errors: ${errors.join("\n")}`);
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
    await mobilePage.getByLabel("管理员账号").fill("admin");
    await mobilePage.getByLabel("管理员密码").fill("StrongPass123!");
    await mobilePage.getByRole("button", { name: "登录", exact: true }).click();
    await mobilePage.getByText("MyServer", { exact: true }).waitFor();
    await mobilePage.getByText("直连代码", { exact: true }).waitFor();
    await mobilePage.screenshot({ path: path.join(results, "dashboard-mobile.png"), fullPage: true });
    await assertViewport(mobilePage, "mobile dashboard");
    await mobilePage.getByRole("button", { name: "删除存档", exact: true }).click();
    await mobilePage.getByRole("dialog").getByText("删除当前存档", { exact: true }).waitFor();
    await mobilePage.screenshot({ path: path.join(results, "delete-save-confirm-mobile.png"), fullPage: true });
    await assertViewport(mobilePage, "mobile delete-save confirmation");
    await mobilePage.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
    await mobilePage.getByRole("button", { name: "打开导航" }).click();
    await mobilePage.screenshot({ path: path.join(results, "navigation-mobile.png"), fullPage: true });
    await assertViewport(mobilePage, "mobile navigation");
    await mobilePage.getByRole("button", { name: "世界设置" }).click();
    await mobilePage.getByPlaceholder("搜索设置名称或键名").waitFor();
    await mobilePage.waitForFunction(() => !document.querySelector(".sidebar")?.classList.contains("mobile-open"));
    await mobilePage.waitForTimeout(220);
    await mobilePage.screenshot({ path: path.join(results, "world-mobile.png"), fullPage: true });
    await assertViewport(mobilePage, "mobile world settings");
    await mobilePage.getByRole("button", { name: "打开导航" }).click();
    await mobilePage.getByRole("button", { name: "玩家与名单" }).click();
    await mobilePage.getByText("测试玩家", { exact: true }).waitFor();
    await mobilePage.waitForTimeout(220);
    await mobilePage.screenshot({ path: path.join(results, "players-mobile.png"), fullPage: true });
    await assertViewport(mobilePage, "mobile players");
    await mobilePage.getByRole("button", { name: "打开导航" }).click();
    await mobilePage.getByRole("button", { name: "MOD 管理" }).click();
    await mobilePage.waitForFunction(() => !document.querySelector(".sidebar")?.classList.contains("mobile-open"));
    await mobilePage.waitForTimeout(220);
    const mobileModRow = mobilePage.locator("#server-mod-351325790");
    await mobileModRow.waitFor();
    await mobileModRow.getByRole("button", { name: /配置/ }).click();
    await mobileModRow.getByText("显示语言", { exact: true }).waitFor();
    await mobilePage.screenshot({ path: path.join(results, "mods-mobile.png"), fullPage: true });
    await assertViewport(mobilePage, "mobile mods");
    await mobilePage.getByRole("button", { name: "打开导航" }).click();
    await mobilePage.getByRole("button", { name: "系统设置" }).click();
    await mobilePage.getByText("管理员端口", { exact: true }).waitFor();
    await assertViewport(mobilePage, "mobile admin settings");
    await mobile.close();
    console.log("Visual test passed: desktop/mobile dashboard and delete confirmation, config, world, players, mods, backups, no browser errors or horizontal overflow");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
