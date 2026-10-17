import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { gameConfig } from "./game-config.js";
import { parseConfigurationValueSubset, parseModInfoMetadata, parseModInfoOptions, type ModConfigLanguage, type ModConfigOption, type ModConfigValue } from "./lua-config.js";
import { runCommand } from "./process-runner.js";
import { repairWorkshopManifest } from "./steam-workshop-manifest.js";
import type { ModLibraryRecord, ModRecord } from "./types.js";
import { resolveWorkshopDetails, type WorkshopItem } from "./workshop-service.js";

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

function modLibraryRoots(): Array<{ root: string; label: string }> {
  return [
    { root: path.join(config.gameRoot, "mods"), label: "游戏 MOD 目录" },
    { root: path.join(config.root, "Steam", "steamapps", "workshop", "content", "322330"), label: "Steam Workshop 缓存" },
    { root: path.join(config.root, "steamapps", "workshop", "content", "322330"), label: "Steam Workshop 缓存" },
    { root: path.join(path.dirname(config.steamcmd), "steamapps", "workshop", "content", "322330"), label: "Steam Workshop 缓存" },
    { root: path.join(config.gameRoot, "steamapps", "workshop", "content", "322330"), label: "游戏 Workshop 缓存" },
    { root: path.join(config.dataRoot, "ugc"), label: "UGC 缓存" }
  ];
}

function cachedModDirectories(): Array<{ id: string; directory: string; root: string; label: string }> {
  const found: Array<{ id: string; directory: string; root: string; label: string }> = [];
  for (const { root, label } of modLibraryRoots()) {
    const pending = [{ directory: root, depth: 0 }];
    while (pending.length) {
      const current = pending.shift()!;
      if (!fs.existsSync(current.directory) || fs.lstatSync(current.directory).isSymbolicLink()) continue;
      for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const directory = path.join(current.directory, entry.name);
        const id = entry.name.match(/^(?:workshop-)?(\d{5,12})$/)?.[1];
        // An app ID such as 322330 is a container, rather than a mod directory.
        if (id && (entry.name !== "322330" || fs.existsSync(path.join(directory, "modinfo.lua")))) {
          found.push({ id, directory, root, label });
        } else if (current.depth < 5) pending.push({ directory, depth: current.depth + 1 });
      }
    }
  }
  return found;
}

interface LibraryMetadata { name: string; previewUrl: string }
function readLibraryMetadata(): Record<string, LibraryMetadata> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(config.root, "mod-library-metadata.json"), "utf8"));
    const metadata: Record<string, LibraryMetadata> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (/^\d{5,12}$/.test(id) && value && typeof value === "object" &&
        typeof (value as LibraryMetadata).name === "string" && typeof (value as LibraryMetadata).previewUrl === "string") metadata[id] = value as LibraryMetadata;
    }
    return metadata;
  } catch { return {}; }
}

function saveLibraryMetadata(metadata: Record<string, LibraryMetadata>): void {
  const file = path.join(config.root, "mod-library-metadata.json");
  const content = JSON.stringify(metadata, null, 2) + "\n";
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return;
  fs.mkdirSync(config.root, { recursive: true, mode: 0o750 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o640 });
  fs.renameSync(temporary, file);
}

export async function listModLibrary(resolveDetails: (ids: readonly string[]) => Promise<WorkshopItem[]> = resolveWorkshopDetails): Promise<ModLibraryRecord[]> {
  const current = new Map(gameConfig.getMods().map((mod) => [mod.id, mod]));
  const metadata = readLibraryMetadata();
  const library = new Map<string, ModLibraryRecord>();
  for (const { id, directory, label } of cachedModDirectories()) {
    if (library.has(id)) continue;
    const modInfo = path.join(directory, "modinfo.lua");
    if (!fs.existsSync(modInfo)) continue;
    const known = current.get(id);
    const name = known && !isPlaceholderName(known.name, id) ? known.name : metadata[id]?.name || readInstalledModName(id);
    const modifiedAt = fs.statSync(modInfo).mtime.toISOString();
    library.set(id, {
      id,
      name: name || `Workshop ${id}`,
      previewUrl: known?.previewUrl || metadata[id]?.previewUrl || "",
      inServer: Boolean(known),
      path: label,
      modifiedAt
    });
  }
  const missing = [...library.values()].filter((item) => !item.previewUrl);
  const details = missing.length ? await resolveDetails(missing.map((item) => item.id)).catch(() => []) : [];
  for (const detail of details) {
    const item = library.get(detail.id);
    if (!item) continue;
    item.previewUrl = detail.previewUrl || item.previewUrl;
    if (isPlaceholderName(item.name, item.id)) item.name = detail.title;
  }
  for (const item of library.values()) metadata[item.id] = { name: item.name, previewUrl: item.previewUrl || "" };
  saveLibraryMetadata(metadata);
  return [...library.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function deleteCachedMod(id: string): void {
  if (!/^\d{5,12}$/.test(id)) throw new Error("无效的 Workshop ID");
  if (gameConfig.getMods().some((mod) => mod.id === id)) throw new Error("请先从服务器 MOD 列表移除该模组并保存，再删除缓存");
  const directories = cachedModDirectories().filter((item) => item.id === id);
  if (!directories.length) throw new Error("模组库中没有找到这个 MOD");
  // Validate all targets before deleting any copy. Never follow cache symlinks.
  const dataRoot = fs.realpathSync(config.root);
  const within = (parent: string, child: string) => { const relative = path.relative(parent, child); return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  for (const { root, directory } of directories) {
    const resolved = fs.realpathSync(directory);
    if (!within(dataRoot, resolved) || !within(fs.realpathSync(root), resolved)) throw new Error("模组缓存路径越界，无法删除");
  }
  repairWorkshopIndexes(() => undefined, [id]);
  for (const { directory } of directories) fs.rmSync(directory, { recursive: true, force: true });
  const metadata = readLibraryMetadata();
  delete metadata[id];
  saveLibraryMetadata(metadata);
}

export function repairWorkshopIndexes(onLine: (line: string) => void, removeIds: readonly string[] = []): void {
  const roots = [
    path.join(config.root, "Steam", "steamapps", "workshop"), path.join(config.root, "steamapps", "workshop"),
    path.join(path.dirname(config.steamcmd), "steamapps", "workshop"), path.join(config.gameRoot, "steamapps", "workshop"),
    path.join(config.dataRoot, "ugc")
  ];
  for (const root of roots) {
    const removed = repairWorkshopManifest(root, removeIds);
    if (removed.length) onLine(`已修复失效的 Workshop 缓存索引：${removed.join(", ")}`);
  }
}

export async function updateEnabledMods(onLine: (line: string) => void, command: typeof runCommand = runCommand): Promise<void> {
  const enabled = gameConfig.getMods().filter((mod) => mod.enabled);
  if (!enabled.length) return;
  if (config.demo) { onLine("[演示模式] 已完成启用模组更新检查"); return; }
  if (!fs.existsSync(config.steamcmd)) throw new Error("SteamCMD 未安装，无法在启动前更新模组");
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) { onLine("5 秒后重试模组更新，保留已有下载进度"); await new Promise((resolve) => setTimeout(resolve, 5000)); }
    repairWorkshopIndexes(onLine);
    const temp = prepareSteamTempRoot(onLine);
    onLine(`正在更新 ${enabled.length} 个启用模组（${attempt}/2），只登录 Steam 一次`);
    const args = ["+@ShutdownOnFailedCommand", "1", "+@NoPromptForPassword", "1", "+force_install_dir", config.gameRoot, "+login", "anonymous",
      ...enabled.flatMap((mod) => ["+workshop_download_item", "322330", mod.id, "validate"]), "+quit"];
    try {
      const result = await command(config.steamcmd, args, {
        cwd: path.dirname(config.steamcmd), env: { TMPDIR: temp, TEMP: temp, TMP: temp }, timeoutMs: 60 * 60_000, onLine
      });
      const output = `${result.stdout}\n${result.stderr}`;
      const downloaded = new Map([...output.matchAll(/Success\. Downloaded item (\d+) to "([^"\r\n]+)"/g)].map((match) => [match[1]!, match[2]!]));
      const missing = enabled.filter((mod) => !downloaded.has(mod.id));
      if (result.code !== 0 || /ERROR!|Missing configuration/i.test(output) || missing.length) {
        throw new Error(`模组更新没有全部成功${missing.length ? `：${missing.map((mod) => mod.name || mod.id).join("、")}` : ""}。${output.split(/\r?\n/).filter(Boolean).slice(-5).join(" | ")}`);
      }
      for (const mod of enabled) {
        const directory = downloaded.get(mod.id)!;
        if (!fs.existsSync(path.join(directory, "modinfo.lua"))) throw new Error(`更新后未找到 MOD ${mod.id} 的 modinfo.lua`);
        installCachedMod(mod.id, directory);
        // Both locations can be selected by DST. Sync while all shards are stopped.
        const ugc = path.join(config.dataRoot, "ugc", "content", "322330", mod.id);
        const target = path.join(config.gameRoot, "mods", `workshop-${mod.id}`);
        fs.mkdirSync(path.dirname(ugc), { recursive: true, mode: 0o750 });
        fs.rmSync(ugc, { recursive: true, force: true });
        fs.cpSync(target, ugc, { recursive: true, force: true });
        onLine(`已更新并同步模组：${mod.name || mod.id}`);
      }
      onLine("所有启用模组已更新，开始启动世界");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      onLine(lastError);
    }
  }
  throw new Error(`启动已取消，防止加载未更新的模组：${lastError}`);
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
      if (attempt > 1) {
        const seconds = Math.min(30, 5 * (attempt - 1));
        onLine(`将在 ${seconds} 秒后继续已有进度重试下载`);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      }
      onLine(`正在通过 SteamCMD 下载 ${title}（尝试 ${attempt}/${maxAttempts}）...`);
      let result: { code: number; stdout: string; stderr: string };
      const workshopLog = path.join(config.root, "Steam", "logs", "workshop_log.txt");
      const logOffset = fs.existsSync(workshopLog) ? fs.statSync(workshopLog).size : 0;
      try {
        repairWorkshopIndexes(onLine);
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
      let steamDiagnostic = "";
      if (fs.existsSync(workshopLog)) {
        const handle = fs.openSync(workshopLog, "r");
        try {
          const size = fs.fstatSync(handle).size;
          const tail = Buffer.alloc(Math.min(size < logOffset ? size : size - logOffset, 32 * 1024));
          fs.readSync(handle, tail, 0, tail.length, size - tail.length);
          steamDiagnostic = tail.toString("utf8").split(/\r?\n/).filter((line) => /Update canceled|Missing game files|Access Denied|Timeout|No Connection|Disk write|Not enough disk|Failure/i.test(line)).slice(-3).join(" | ");
        } finally { fs.closeSync(handle); }
      }
      const diagnostic = steamDiagnostic || `${result.stderr}\n${result.stdout}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-12).join(" | ");
      const brokenIds = [...steamDiagnostic.matchAll(/[\\/]content[\\/]322330[\\/](\d{5,12})[\\/]/g)].map((match) => match[1]!);
      if (brokenIds.length) repairWorkshopIndexes(onLine, brokenIds);
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

export function getModConfiguration(id: string, language: ModConfigLanguage = "zh"): ModConfigurationInfo {
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
    const options = parseModInfoOptions(fs.readFileSync(file, "utf8"), language);
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
