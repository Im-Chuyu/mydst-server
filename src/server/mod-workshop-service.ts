import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { gameConfig } from "./game-config.js";
import { parseConfigurationValues, parseModInfoOptions, type ModConfigOption, type ModConfigValue } from "./lua-config.js";
import { runCommand } from "./process-runner.js";

export interface ModConfigurationInfo {
  installed: boolean;
  options: ModConfigOption[];
  values: Record<string, ModConfigValue>;
  warning?: string;
}

export async function downloadAndAddMod(id: string, requestedTitle: string, onLine: (line: string) => void): Promise<void> {
  if (gameConfig.getMods().some((mod) => mod.id === id)) throw new Error("这个 MOD 已在服务器列表中");
  const item = { title: requestedTitle || `Workshop ${id}` };
  await ensureWorkshopMod(id, item.title, onLine);
  const current = gameConfig.getMods();
  if (!current.some((mod) => mod.id === id)) {
    gameConfig.saveMods([...current, { id, name: item.title.slice(0, 160), enabled: true, configuration: "{}" }]);
  }
  onLine("MOD 下载完成并已加入服务器列表");
}

export async function installRestoredMods(mods: readonly { id: string; name: string; enabled: boolean }[], onLine: (line: string) => void): Promise<void> {
  const enabled = mods.filter((mod) => mod.enabled);
  for (let index = 0; index < enabled.length; index += 1) {
    const mod = enabled[index]!;
    onLine(`正在处理存档 MOD (${index + 1}/${enabled.length})：${mod.name || mod.id}`);
    try {
      await ensureWorkshopMod(mod.id, mod.name || `Workshop ${mod.id}`, onLine, 1);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      onLine(`SteamCMD 预下载 ${mod.id} 未完成：${detail}`);
      onLine("已保留该 MOD 的服务器下载配置，DST 分片启动时会继续自动下载");
    }
  }
}

async function ensureWorkshopMod(id: string, title: string, onLine: (line: string) => void, maxAttempts = 3): Promise<void> {
  const existing = findModDirectory(id);
  if (existing) {
    installCachedMod(id, existing);
    onLine(`MOD ${id} 已存在于服务器缓存，已同步到游戏目录`);
    return;
  }
  if (config.demo) {
    onLine("[演示模式] 正在下载 MOD...");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const demoDirectory = path.join(config.root, "Steam", "steamapps", "workshop", "content", "322330", id);
    fs.mkdirSync(demoDirectory, { recursive: true });
    fs.writeFileSync(path.join(demoDirectory, "modinfo.lua"), `configuration_options = {
  { name = "LANGUAGE", label = "显示语言", options = { { description = "自动", data = "auto" }, { description = "简体中文", data = "zh" }, { description = "English", data = "en" } }, default = "auto", hover = "选择模组界面使用的语言。" },
  { name = "ENABLED", label = "启用扩展功能", options = { { description = "开启", data = true }, { description = "关闭", data = false } }, default = true },
}
`, "utf8");
    installCachedMod(id, demoDirectory);
  } else {
    let lastError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      onLine(`正在通过 SteamCMD 下载 ${title}（尝试 ${attempt}/${maxAttempts}）...`);
      const result = await runCommand(config.steamcmd, [
        "+force_install_dir", config.gameRoot,
        "+login", "anonymous",
        "+workshop_download_item", "322330", id, "validate",
        "+quit"
      ], { timeoutMs: 20 * 60_000, onLine });
      const downloaded = findModDirectory(id);
      if (result.code === 0 && downloaded) {
        installCachedMod(id, downloaded);
        return;
      }
      lastError = result.stderr.trim() || "SteamCMD 已结束，但没有找到下载后的 modinfo.lua";
      if (attempt < maxAttempts) onLine("本次 MOD 下载未完成，SteamCMD 将继续已有进度重试");
    }
    throw new Error(`MOD ${id} 下载失败：${lastError}`);
  }
}

export function getModConfiguration(id: string): ModConfigurationInfo {
  const mod = gameConfig.getMods().find((item) => item.id === id);
  let values: Record<string, ModConfigValue> = {};
  let configurationWarning = "";
  try { values = mod ? parseConfigurationValues(mod.configuration || "{}") : {}; }
  catch { configurationWarning = "该 MOD 使用嵌套 Lua 配置，请使用 Lua 模式编辑"; }
  const file = findModInfo(id);
  if (!file) return { installed: false, options: [], values, warning: configurationWarning || "服务器中尚未找到该 MOD 的 modinfo.lua" };
  try {
    const options = parseModInfoOptions(fs.readFileSync(file, "utf8"));
    return { installed: true, options, values, warning: configurationWarning || (options.length ? undefined : "该 MOD 没有可静态读取的配置项，可使用 Lua 模式配置") };
  } catch (error) {
    return { installed: true, options: [], values, warning: error instanceof Error ? `modinfo.lua 解析失败：${error.message}` : "modinfo.lua 解析失败" };
  }
}

function findModInfo(id: string): string | null {
  const directory = findModDirectory(id);
  return directory ? path.join(directory, "modinfo.lua") : null;
}

function findModDirectory(id: string): string | null {
  const candidates = [
    path.join(config.gameRoot, "mods", `workshop-${id}`),
    path.join(config.root, "Steam", "steamapps", "workshop", "content", "322330", id),
    path.join(config.root, "steamapps", "workshop", "content", "322330", id),
    path.join(path.dirname(config.steamcmd), "steamapps", "workshop", "content", "322330", id),
    path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", id),
    path.join(config.dataRoot, "ugc", "mods", `workshop-${id}`),
    path.join(config.dataRoot, "ugc", "322330", id)
  ];
  return candidates.find((directory) => fs.existsSync(path.join(directory, "modinfo.lua"))) || null;
}

function installCachedMod(id: string, source: string): void {
  const target = path.join(config.gameRoot, "mods", `workshop-${id}`);
  if (path.resolve(source) === path.resolve(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}
