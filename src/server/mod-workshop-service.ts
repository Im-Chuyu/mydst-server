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
  const existing = findModInfo(id);
  if (existing) {
    onLine("MOD 已存在于服务器缓存，正在读取配置...");
  } else if (config.demo) {
    onLine("[演示模式] 正在下载 MOD...");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const demoFile = path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", id, "modinfo.lua");
    fs.mkdirSync(path.dirname(demoFile), { recursive: true });
    fs.writeFileSync(demoFile, `configuration_options = {
  { name = "LANGUAGE", label = "显示语言", options = { { description = "自动", data = "auto" }, { description = "简体中文", data = "zh" }, { description = "English", data = "en" } }, default = "auto", hover = "选择模组界面使用的语言。" },
  { name = "ENABLED", label = "启用扩展功能", options = { { description = "开启", data = true }, { description = "关闭", data = false } }, default = true },
}
`, "utf8");
  } else {
    onLine(`正在通过 SteamCMD 下载 ${item.title}...`);
    const result = await runCommand(config.steamcmd, [
      "+force_install_dir", config.gameRoot,
      "+login", "anonymous",
      "+workshop_download_item", "322330", id, "validate",
      "+quit"
    ], { timeoutMs: 20 * 60_000, onLine });
    if (result.code !== 0) throw new Error(result.stderr || "SteamCMD 下载 MOD 失败");
    if (!findModInfo(id)) throw new Error("SteamCMD 已结束，但没有找到下载后的 modinfo.lua");
  }
  const current = gameConfig.getMods();
  if (!current.some((mod) => mod.id === id)) {
    gameConfig.saveMods([...current, { id, name: item.title.slice(0, 160), enabled: true, configuration: "{}" }]);
  }
  onLine("MOD 下载完成并已加入服务器列表");
}

export function getModConfiguration(id: string): ModConfigurationInfo {
  const mod = gameConfig.getMods().find((item) => item.id === id);
  const values = mod ? parseConfigurationValues(mod.configuration || "{}") : {};
  const file = findModInfo(id);
  if (!file) return { installed: false, options: [], values, warning: "服务器中尚未找到该 MOD 的 modinfo.lua" };
  try {
    const options = parseModInfoOptions(fs.readFileSync(file, "utf8"));
    return { installed: true, options, values, warning: options.length ? undefined : "该 MOD 没有可静态读取的配置项，可使用 Lua 模式配置" };
  } catch (error) {
    return { installed: true, options: [], values, warning: error instanceof Error ? `modinfo.lua 解析失败：${error.message}` : "modinfo.lua 解析失败" };
  }
}

function findModInfo(id: string): string | null {
  const candidates = [
    path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", id, "modinfo.lua"),
    path.join(config.gameRoot, "mods", `workshop-${id}`, "modinfo.lua"),
    path.join(config.dataRoot, "ugc", "mods", `workshop-${id}`, "modinfo.lua"),
    path.join(config.dataRoot, "ugc", "322330", id, "modinfo.lua")
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
}
