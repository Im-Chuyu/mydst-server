import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { gameConfig } from "./game-config.js";
import { parseConfigurationValueSubset, parseModInfoMetadata, parseModInfoOptions, type ModConfigOption, type ModConfigValue } from "./lua-config.js";
import { runCommand } from "./process-runner.js";
import type { ModLibraryRecord, ModRecord } from "./types.js";
import { resolveWorkshopDetails } from "./workshop-service.js";

export interface ModConfigurationInfo {
  installed: boolean;
  options: ModConfigOption[];
  values: Record<string, ModConfigValue>;
  warning?: string;
  sourcePath?: string;
}

export async function downloadAndAddMod(id: string, requestedTitle: string, requestedPreviewUrl: string, onLine: (line: string) => void): Promise<void> {
  if (gameConfig.getMods().some((mod) => mod.id === id)) throw new Error("这个 MOD 已在服务器列表中");
  const item = { title: requestedTitle || `Workshop ${id}` };
  await ensureWorkshopMod(id, item.title, onLine);
  const current = gameConfig.getMods();
  if (!current.some((mod) => mod.id === id)) {
    gameConfig.saveMods([...current, { id, name: item.title.slice(0, 160), previewUrl: requestedPreviewUrl, enabled: true, configuration: "{}" }]);
  }
  await enrichModMetadata(gameConfig.getMods(), onLine);
  onLine("MOD 下载完成并已加入服务器列表");
}

export async function downloadModToCache(id: string, requestedTitle: string, onLine: (line: string) => void): Promise<void> {
  await ensureWorkshopMod(id, requestedTitle || `Workshop ${id}`, onLine);
  await enrichModMetadata(gameConfig.getMods(), onLine);
  onLine("MOD 已下载到服务器缓存，可以读取配置");
}

export function addCachedMod(id: string, requestedName = "", requestedPreviewUrl = ""): ModRecord {
  if (gameConfig.getMods().some((mod) => mod.id === id)) throw new Error("这个 MOD 已在服务器列表中");
  const directory = findModDirectory(id);
  if (!directory) throw new Error("模组库中没有找到这个 MOD，请先下载");
  const metadata = readInstalledModName(id);
  const current = gameConfig.getMods();
  const mod: ModRecord = {
    id,
    name: requestedName || metadata || `Workshop ${id}`,
    previewUrl: requestedPreviewUrl,
    enabled: true,
    configuration: "{}"
  };
  installCachedMod(id, directory);
  gameConfig.saveMods([...current, mod]);
  return mod;
}

export function listModLibrary(): ModLibraryRecord[] {
  const current = new Map(gameConfig.getMods().map((mod) => [mod.id, mod]));
  const roots = [
    { root: path.join(config.gameRoot, "mods"), label: "游戏 MOD 目录" },
    { root: path.join(config.root, "Steam", "steamapps", "workshop", "content", "322330"), label: "Steam Workshop 缓存" },
    { root: path.join(config.root, "steamapps", "workshop", "content", "322330"), label: "Steam Workshop 缓存" },
    { root: path.join(path.dirname(config.steamcmd), "steamapps", "workshop", "content", "322330"), label: "Steam Workshop 缓存" },
    { root: path.join(config.gameRoot, "steamapps", "workshop", "content", "322330"), label: "游戏 Workshop 缓存" },
    { root: path.join(config.dataRoot, "ugc", "mods"), label: "UGC 缓存" },
    { root: path.join(config.dataRoot, "ugc", "322330"), label: "UGC 缓存" }
  ];
  const library = new Map<string, ModLibraryRecord>();
  for (const { root, label } of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const id = entry.name.match(/^(?:workshop-)?(\d{5,12})$/)?.[1];
      if (!entry.isDirectory() || !id || library.has(id)) continue;
      const directory = path.join(root, entry.name);
      const modInfo = path.join(directory, "modinfo.lua");
      if (!fs.existsSync(modInfo)) continue;
      const known = current.get(id);
      const name = known && !isPlaceholderName(known.name, id) ? known.name : readInstalledModName(id);
      const modifiedAt = fs.statSync(modInfo).mtime.toISOString();
      library.set(id, {
        id,
        name: name || `Workshop ${id}`,
        previewUrl: known?.previewUrl || "",
        inServer: Boolean(known),
        path: label,
        modifiedAt
      });
    }
  }
  return [...library.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function updateEnabledMods(onLine: (line: string) => void): Promise<void> {
  const enabled = gameConfig.getMods().filter((mod) => mod.enabled);
  for (let index = 0; index < enabled.length; index += 1) {
    const mod = enabled[index]!;
    onLine(`正在检查 MOD 更新 (${index + 1}/${enabled.length})：${mod.name || mod.id}`);
    try {
      await ensureWorkshopMod(mod.id, mod.name || `Workshop ${mod.id}`, onLine, 2, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      onLine(`MOD ${mod.id} 更新失败，继续使用本地版本：${detail}`);
    }
  }
}

export async function enrichModMetadata(mods: readonly ModRecord[], onLine?: (line: string) => void, force = false): Promise<ModRecord[]> {
  const targets = mods.filter((mod) => /^\d{5,12}$/.test(mod.id) && (force || isPlaceholderName(mod.name, mod.id) || !mod.previewUrl));
  if (!targets.length) return [...mods];
  const targetIds = new Set(targets.map((mod) => mod.id));
  const details = await resolveWorkshopDetails(targets.map((mod) => mod.id));
  const detailsById = new Map(details.map((item) => [item.id, item]));
  let changed = false;
  const enriched = mods.map((mod) => {
    if (!targetIds.has(mod.id)) return mod;
    const detail = detailsById.get(mod.id);
    const localName = readInstalledModName(mod.id);
    const name = isPlaceholderName(mod.name, mod.id) ? (detail?.title || localName || mod.name) : mod.name;
    const previewUrl = detail?.previewUrl || mod.previewUrl || "";
    if (name !== mod.name || previewUrl !== (mod.previewUrl || "")) changed = true;
    return { ...mod, name: name.slice(0, 160), previewUrl };
  });
  if (changed) {
    gameConfig.saveMods(enriched);
    onLine?.("已根据 Workshop ID 更新 MOD 名称和封面");
  }
  return enriched;
}

export async function installRestoredMods(mods: readonly { id: string; name: string; enabled: boolean }[], onLine: (line: string) => void): Promise<void> {
  const enabled = mods.filter((mod) => mod.enabled);
  for (let index = 0; index < enabled.length; index += 1) {
    const mod = enabled[index]!;
    onLine(`正在处理存档 MOD (${index + 1}/${enabled.length})：${mod.name || mod.id}`);
    try {
      await ensureWorkshopMod(mod.id, mod.name || `Workshop ${mod.id}`, onLine);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      onLine(`SteamCMD 预下载 ${mod.id} 未完成：${detail}`);
      onLine("已保留该 MOD 的服务器下载配置，DST 分片启动时会继续自动下载");
    }
  }
}

async function ensureWorkshopMod(id: string, title: string, onLine: (line: string) => void, maxAttempts = 3, refreshExisting = false): Promise<void> {
  const existing = findModDirectory(id);
  if (existing && !refreshExisting) {
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
      let result: { code: number; stdout: string; stderr: string };
      try {
        const steamTempRoot = prepareSteamTempRoot(onLine);
        result = await runCommand(config.steamcmd, [
          "+@ShutdownOnFailedCommand", "1",
          "+@NoPromptForPassword", "1",
          "+force_install_dir", config.gameRoot,
          "+login", "anonymous",
          "+workshop_download_item", "322330", id, "validate",
          "+quit"
        ], {
          cwd: path.dirname(config.steamcmd),
          env: { TMPDIR: steamTempRoot, TEMP: steamTempRoot, TMP: steamTempRoot },
          timeoutMs: 60 * 60_000,
          onLine
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        onLine(`SteamCMD 执行异常：${lastError}`);
        if (attempt < maxAttempts) {
          onLine("SteamCMD 将重试下载");
          continue;
        }
        break;
      }
      const downloaded = findModDirectory(id, true);
      const output = `${result.stdout}\n${result.stderr}`;
      const steamcmdFailed = /ERROR!\s+(?:Failed to install workshop item|Download item .* failed)|Missing configuration/i.test(output);
      if (result.code === 0 && !steamcmdFailed && downloaded) {
        installCachedMod(id, downloaded);
        return;
      }
      const diagnostic = `${result.stderr}\n${result.stdout}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-12).join(" | ");
      lastError = diagnostic || (steamcmdFailed ? "SteamCMD 报告 Workshop 下载失败" : "SteamCMD 已结束，但没有找到下载后的 modinfo.lua");
      onLine(`本次 MOD 下载未完成：${lastError}`);
      if (attempt < maxAttempts) onLine("SteamCMD 将继续已有进度重试");
    }
    throw new Error(`MOD ${id} 下载失败：${lastError}`);
  }
}

function prepareSteamTempRoot(onLine: (line: string) => void): string {
  const tempRoot = path.join(config.root, "tmp");
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    try {
      for (const entry of fs.readdirSync("/tmp", { withFileTypes: true })) {
        if (!/^dumps/.test(entry.name) || (uid !== undefined && fs.statSync(path.join("/tmp", entry.name)).uid !== uid)) continue;
        fs.rmSync(path.join("/tmp", entry.name), { recursive: true, force: true });
        onLine(`已清理当前用户遗留的 Steam 临时目录：${entry.name}`);
      }
    } catch {
      // The installer performs the privileged cleanup for root-owned dumps.
    }
  }
  return tempRoot;
}

export function getModConfiguration(id: string): ModConfigurationInfo {
  const mod = gameConfig.getMods().find((item) => item.id === id);
  let values: Record<string, ModConfigValue> = {};
  let configurationWarning = "";
  try {
    const parsed = mod ? parseConfigurationValueSubset(mod.configuration || "{}") : { values: {}, hasNested: false };
    values = parsed.values;
    if (parsed.hasNested) configurationWarning = "该 MOD 含有嵌套 Lua 配置";
  }
  catch { configurationWarning = "该 MOD 使用嵌套 Lua 配置，请使用 Lua 模式编辑"; }
  const file = findModInfo(id);
  if (!file) return { installed: false, options: [], values, warning: configurationWarning || "服务器中尚未找到该 MOD 的 modinfo.lua" };
  try {
    const options = parseModInfoOptions(fs.readFileSync(file, "utf8"));
    return { installed: true, options, values, sourcePath: file, warning: configurationWarning || (options.length ? undefined : "该 MOD 没有可静态读取的配置项，可使用 Lua 模式配置") };
  } catch (error) {
    return { installed: true, options: [], values, sourcePath: file, warning: error instanceof Error ? `modinfo.lua 解析失败：${error.message}` : "modinfo.lua 解析失败" };
  }
}

function findModInfo(id: string): string | null {
  const directory = findModDirectory(id);
  return directory ? path.join(directory, "modinfo.lua") : null;
}

function readInstalledModName(id: string): string {
  const file = findModInfo(id);
  if (!file) return "";
  try { return parseModInfoMetadata(fs.readFileSync(file, "utf8")).name; }
  catch { return ""; }
}

function isPlaceholderName(name: string, id: string): boolean {
  const value = name.trim();
  return !value || value === id || new RegExp(`^(?:Workshop|MOD)\\s+${id}$`, "i").test(value);
}

function findModDirectory(id: string, preferCache = false): string | null {
  const target = path.join(config.gameRoot, "mods", `workshop-${id}`);
  const caches = [
    path.join(config.root, "Steam", "steamapps", "workshop", "content", "322330", id),
    path.join(config.root, "steamapps", "workshop", "content", "322330", id),
    path.join(path.dirname(config.steamcmd), "steamapps", "workshop", "content", "322330", id),
    path.join(config.gameRoot, "steamapps", "workshop", "content", "322330", id),
    path.join(config.dataRoot, "ugc", "mods", `workshop-${id}`),
    path.join(config.dataRoot, "ugc", "322330", id)
  ];
  const candidates = preferCache ? [...caches, target] : [target, ...caches];
  const direct = candidates.find((directory) => fs.existsSync(path.join(directory, "modinfo.lua")));
  if (direct) return direct;

  const roots = [
    path.join(config.gameRoot, "mods"),
    path.join(config.root, "Steam", "steamapps", "workshop", "content", "322330"),
    path.join(config.root, "steamapps", "workshop", "content", "322330"),
    path.join(path.dirname(config.steamcmd), "steamapps", "workshop", "content", "322330"),
    path.join(config.gameRoot, "steamapps", "workshop", "content", "322330"),
    path.join(config.dataRoot, "ugc", "mods"),
    path.join(config.dataRoot, "ugc", "322330")
  ];
  for (const root of roots) {
    const found = findModDirectoryRecursively(root, id);
    if (found) return found;
  }
  return null;
}

function findModDirectoryRecursively(root: string, id: string): string | null {
  if (!fs.existsSync(root)) return null;
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  const idPattern = new RegExp(`^(?:workshop-)?${id}$`);
  while (pending.length) {
    const current = pending.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); }
    catch { continue; }
    const hasModInfo = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "modinfo.lua");
    if (hasModInfo && current.depth > 0) {
      const parts = path.normalize(current.directory).split(path.sep);
      if (parts.some((part) => idPattern.test(part))) return current.directory;
    }
    if (current.depth >= 5) continue;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function installCachedMod(id: string, source: string): void {
  const target = path.join(config.gameRoot, "mods", `workshop-${id}`);
  if (path.resolve(source) === path.resolve(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}
