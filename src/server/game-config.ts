import fs from "node:fs";
import path from "node:path";
import ini from "ini";
import { config } from "./config.js";
import { parseConfigurationValues } from "./lua-config.js";
import type { GameConfig, ModRecord, PanelPorts, Shard } from "./types.js";
import { getPresetOverrides, playstyleFromPreset, playstylePresets, worldCatalog, worldCatalogVersion, type WorldOverrideValue } from "./world-catalog.js";

const defaultGameConfig: GameConfig = {
  clusterName: "MyServer",
  clusterDescription: "MyDST 专属饥荒联机版服务器",
  clusterPassword: "",
  clusterToken: "",
  gameMode: "survival",
  playstyle: "survival",
  clusterLanguage: "zh",
  intention: "cooperative",
  offlineCluster: false,
  lanOnlyCluster: false,
  autosaverEnabled: true,
  cavesEnabled: true,
  cavesEnabledLocked: false,
  whitelistSlots: 0,
  steamGroupOnly: false,
  steamGroupId: "",
  steamGroupAdmins: false,
  maxPlayers: 6,
  pvp: false,
  pauseWhenEmpty: true,
  voteKick: false,
  consoleEnabled: true,
  maxSnapshots: 10,
  ...config.initialPorts
};

const worldDefaults: Record<Shard, string> = {
  master: `return {\n  override_enabled = true,\n  worldgen_preset = "SURVIVAL_TOGETHER",\n  settings_preset = "SURVIVAL_TOGETHER",\n  overrides = {}\n}\n`,
  caves: `return {\n  override_enabled = true,\n  worldgen_preset = "DST_CAVE",\n  settings_preset = "DST_CAVE",\n  overrides = {}\n}\n`
};

function writeAtomic(file: string, content: string, mode = 0o640): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, { encoding: "utf8", mode });
  fs.renameSync(temp, file);
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function number(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeGameMode(value: unknown): string {
  const mode = String(value || defaultGameConfig.gameMode);
  return ["endless", "wilderness", "lights_out"].includes(mode) ? "survival" : mode;
}

export class GameConfigService {
  ensureLayout(): void {
    fs.mkdirSync(config.clusterRoot, { recursive: true, mode: 0o750 });
    fs.mkdirSync(config.backupRoot, { recursive: true, mode: 0o750 });
    const clusterFile = path.join(config.clusterRoot, "cluster.ini");
    if (!fs.existsSync(clusterFile)) this.save(defaultGameConfig);
    const cluster = ini.parse(fs.readFileSync(clusterFile, "utf8"));
    const cavesEnabled = bool(cluster.SHARD?.caves_enabled ?? cluster.SHARD?.shard_enabled, true);
    const shards: Shard[] = cavesEnabled ? ["master", "caves"] : ["master"];
    for (const shard of shards) {
      const shardDir = this.shardDir(shard);
      fs.mkdirSync(shardDir, { recursive: true, mode: 0o750 });
      const worldFile = path.join(shardDir, "worldgenoverride.lua");
      if (!fs.existsSync(worldFile)) writeAtomic(worldFile, worldDefaults[shard]);
      const modFile = path.join(shardDir, "modoverrides.lua");
      if (!fs.existsSync(modFile)) writeAtomic(modFile, "return {}\n");
    }
    if (!fs.existsSync(this.modsFile())) writeAtomic(this.modsFile(), "[]\n");
  }

  get(): GameConfig {
    this.ensureLayout();
    const cluster = ini.parse(fs.readFileSync(path.join(config.clusterRoot, "cluster.ini"), "utf8"));
    const ports = this.getPorts();
    const tokenFile = path.join(config.clusterRoot, "cluster_token.txt");
    return {
      clusterName: cluster.NETWORK?.cluster_name || defaultGameConfig.clusterName,
      clusterDescription: cluster.NETWORK?.cluster_description || "",
      clusterPassword: cluster.NETWORK?.cluster_password || "",
      clusterToken: fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8").trim() : "",
      gameMode: normalizeGameMode(cluster.GAMEPLAY?.game_mode),
      playstyle: playstyleFromPreset(this.readWorldPreset("master")),
      clusterLanguage: cluster.NETWORK?.cluster_language || defaultGameConfig.clusterLanguage,
      intention: cluster.NETWORK?.cluster_intention || defaultGameConfig.intention,
      offlineCluster: bool(cluster.NETWORK?.offline_cluster, defaultGameConfig.offlineCluster),
      lanOnlyCluster: bool(cluster.NETWORK?.lan_only_cluster, defaultGameConfig.lanOnlyCluster),
      autosaverEnabled: bool(cluster.NETWORK?.autosaver_enabled, defaultGameConfig.autosaverEnabled),
      cavesEnabled: bool(cluster.SHARD?.caves_enabled ?? cluster.SHARD?.shard_enabled, defaultGameConfig.cavesEnabled),
      cavesEnabledLocked: bool(cluster.SHARD?.caves_ever_enabled, false) || this.cavesWorldCreated(),
      whitelistSlots: number(cluster.NETWORK?.whitelist_slots, defaultGameConfig.whitelistSlots),
      steamGroupOnly: bool(cluster.STEAM?.steam_group_only, defaultGameConfig.steamGroupOnly),
      steamGroupId: String(cluster.STEAM?.steam_group_id || ""),
      steamGroupAdmins: bool(cluster.STEAM?.steam_group_admins, defaultGameConfig.steamGroupAdmins),
      maxPlayers: number(cluster.GAMEPLAY?.max_players, defaultGameConfig.maxPlayers),
      pvp: bool(cluster.GAMEPLAY?.pvp, defaultGameConfig.pvp),
      pauseWhenEmpty: bool(cluster.GAMEPLAY?.pause_when_empty, defaultGameConfig.pauseWhenEmpty),
      voteKick: bool(cluster.NETWORK?.vote_kick_enabled ?? cluster.GAMEPLAY?.vote_kick_enabled, defaultGameConfig.voteKick),
      consoleEnabled: bool(cluster.MISC?.console_enabled, true),
      maxSnapshots: number(cluster.MISC?.max_snapshots, 10),
      ...ports
    } as GameConfig;
  }

  save(value: GameConfig): void {
    fs.mkdirSync(config.clusterRoot, { recursive: true, mode: 0o750 });
    const clusterFile = path.join(config.clusterRoot, "cluster.ini");
    const existingCluster = fs.existsSync(clusterFile) ? ini.parse(fs.readFileSync(clusterFile, "utf8")) : undefined;
    const currentCavesEverEnabled = bool(existingCluster?.SHARD?.caves_ever_enabled, false) || this.cavesWorldCreated();
    if (currentCavesEverEnabled && !value.cavesEnabled) throw new Error("洞穴已经开启，不可关闭");
    const cavesEverEnabled = currentCavesEverEnabled;
    this.writePanelPorts(value);
    const currentPlaystyle = playstyleFromPreset(this.readWorldPreset("master"));
    const clusterIni = ini.stringify({
      NETWORK: {
        cluster_name: value.clusterName,
        cluster_description: value.clusterDescription,
        cluster_password: value.clusterPassword,
        cluster_intention: value.intention,
        cluster_language: value.clusterLanguage,
        offline_cluster: value.offlineCluster,
        lan_only_cluster: value.lanOnlyCluster,
        autosaver_enabled: value.autosaverEnabled,
        whitelist_slots: value.whitelistSlots,
        vote_kick_enabled: value.voteKick
      },
      GAMEPLAY: {
        game_mode: value.gameMode,
        max_players: value.maxPlayers,
        pvp: value.pvp,
        pause_when_empty: value.pauseWhenEmpty
      },
      MISC: {
        console_enabled: value.consoleEnabled,
        max_snapshots: value.maxSnapshots
      },
      STEAM: {
        steam_group_only: value.steamGroupOnly,
        steam_group_id: value.steamGroupId,
        steam_group_admins: value.steamGroupAdmins
      },
      SHARD: {
        shard_enabled: value.cavesEnabled,
        caves_enabled: value.cavesEnabled,
        caves_ever_enabled: cavesEverEnabled,
        bind_ip: "127.0.0.1",
        master_ip: "127.0.0.1",
        master_port: 10888,
        cluster_key: "mydst-cluster-key"
      }
    });
    writeAtomic(path.join(config.clusterRoot, "cluster.ini"), clusterIni);
    writeAtomic(path.join(config.clusterRoot, "cluster_token.txt"), value.clusterToken.trim(), 0o600);
    this.writeServerIni("master", value.masterPort, value.steamMasterPort, true);
    if (value.cavesEnabled) {
      this.writeServerIni("caves", value.cavesPort, value.steamCavesPort, false);
      fs.mkdirSync(this.shardDir("caves"), { recursive: true, mode: 0o750 });
      const caveWorld = path.join(this.shardDir("caves"), "worldgenoverride.lua");
      const caveMods = path.join(this.shardDir("caves"), "modoverrides.lua");
      if (!fs.existsSync(caveWorld)) writeAtomic(caveWorld, worldDefaults.caves);
      if (!fs.existsSync(caveMods)) writeAtomic(caveMods, "return {}\n");
    }
    else if (!this.cavesWorldCreated()) fs.rmSync(this.shardDir("caves"), { recursive: true, force: true });
    if (currentPlaystyle !== value.playstyle) this.applyPlaystyle(value.playstyle);
  }

  getPorts(): PanelPorts {
    this.ensureLayout();
    const file = this.portsFile();
    if (fs.existsSync(file)) {
      try {
        const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PanelPorts>;
        if (isPorts(value)) return value as PanelPorts;
      } catch {
        // Fall back to the legacy server.ini files below.
      }
    }
    const master = ini.parse(fs.readFileSync(path.join(this.shardDir("master"), "server.ini"), "utf8"));
    const cavesFile = path.join(this.shardDir("caves"), "server.ini");
    const caves = fs.existsSync(cavesFile) ? ini.parse(fs.readFileSync(cavesFile, "utf8")) : {};
    const ports: PanelPorts = {
      masterPort: number(master.NETWORK?.server_port, defaultGameConfig.masterPort),
      cavesPort: number(caves.NETWORK?.server_port, defaultGameConfig.cavesPort),
      steamMasterPort: number(master.STEAM?.master_server_port, defaultGameConfig.steamMasterPort),
      steamCavesPort: number(caves.STEAM?.master_server_port, defaultGameConfig.steamCavesPort)
    };
    this.writePanelPorts(ports);
    return ports;
  }

  restorePanelPorts(ports: PanelPorts, clusterToken?: string): void {
    this.writePanelPorts(ports);
    this.writeServerIni("master", ports.masterPort, ports.steamMasterPort, true);
    this.writeServerIni("caves", ports.cavesPort, ports.steamCavesPort, false);
    if (clusterToken !== undefined) writeAtomic(path.join(config.clusterRoot, "cluster_token.txt"), clusterToken.trim(), 0o600);
  }

  getWorld(shard: Shard): string {
    this.ensureLayout();
    const file = path.join(this.shardDir(shard), "worldgenoverride.lua");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : worldDefaults[shard];
  }

  saveWorld(shard: Shard, content: string): void {
    if (shard === "caves" && !this.get().cavesEnabled) throw new Error("洞穴世界未开启");
    if (content.length > 200_000 || !content.includes("return")) throw new Error("世界配置格式无效");
    writeAtomic(path.join(this.shardDir(shard), "worldgenoverride.lua"), content.trim() + "\n");
  }

  getWorldVisual(shard: Shard) {
    const raw = this.getWorld(shard);
    const preset = readWorldPresetValue(raw, shard);
    return {
      shard,
      preset,
      overrides: parseWorldOverrides(raw),
      definitions: worldCatalog.filter((item) => item.worlds.includes(shard)).map((item) => ({
        ...item,
        defaultValue: getPresetOverrides(shard, preset)[item.key] || item.defaultValue,
        choices: item.key === "task_set"
          ? (shard === "master" ? [{ value: "default", label: "默认" }, { value: "classic", label: "经典" }] : [{ value: "cave_default", label: "默认洞穴" }])
          : item.key === "start_location"
            ? (shard === "master" ? [{ value: "default", label: "默认" }, { value: "plus", label: "额外资源" }, { value: "darkness", label: "黑暗" }] : [{ value: "caves", label: "洞穴" }])
            : item.choices
      })),
      catalogVersion: worldCatalogVersion
    };
  }

  saveWorldVisual(shard: Shard, overrides: Record<string, WorldOverrideValue>): void {
    if (Object.keys(overrides).length > 500) throw new Error("世界设置项过多");
    for (const [key, value] of Object.entries(overrides)) {
      if (!/^[a-zA-Z0-9_]+$/.test(key)) throw new Error(`世界设置键无效: ${key}`);
      if (typeof value === "string" && value.length > 100) throw new Error(`世界设置值过长: ${key}`);
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`世界设置值无效: ${key}`);
      const definition = worldCatalog.find((item) => item.key === key && item.worlds.includes(shard));
      if (definition && typeof value === "string" && !definition.choices.some((choice) => choice.value === value)) {
        throw new Error(`${definition.label} 的选项无效`);
      }
    }
    const current = this.getWorld(shard);
    const range = findLuaTable(current, "overrides");
    const body = serializeOverrides(overrides);
    const content = range
      ? `${current.slice(0, range.start)}${body}${current.slice(range.end)}`
      : worldDefaults[shard].replace("overrides = {}", `overrides = ${body}`);
    this.saveWorld(shard, content);
  }

  resetWorldCreationState(): void {
    const clusterFile = path.join(config.clusterRoot, "cluster.ini");
    if (!fs.existsSync(clusterFile)) return;
    const cluster = ini.parse(fs.readFileSync(clusterFile, "utf8"));
    cluster.SHARD = cluster.SHARD || {};
    cluster.SHARD.caves_ever_enabled = false;
    writeAtomic(clusterFile, ini.stringify(cluster));
  }

  syncCavesFromRestoredSave(): boolean {
    if (!this.cavesWorldCreated()) return false;
    const clusterFile = path.join(config.clusterRoot, "cluster.ini");
    if (!fs.existsSync(clusterFile)) throw new Error("恢复后的存档缺少 cluster.ini");
    const cluster = ini.parse(fs.readFileSync(clusterFile, "utf8"));
    cluster.SHARD = cluster.SHARD || {};
    cluster.SHARD.shard_enabled = true;
    cluster.SHARD.caves_enabled = true;
    cluster.SHARD.caves_ever_enabled = true;
    writeAtomic(clusterFile, ini.stringify(cluster));
    this.ensureLayout();
    return true;
  }

  private applyPlaystyle(playstyle: GameConfig["playstyle"]): void {
    const target = playstylePresets[playstyle].preset;
    let content = this.getWorld("master");
    if (/\bworldgen_preset\s*=/.test(content)) content = content.replace(/\bworldgen_preset\s*=\s*["'][^"']+["']/, `worldgen_preset = "${target}"`);
    if (/\bsettings_preset\s*=/.test(content)) content = content.replace(/\bsettings_preset\s*=\s*["'][^"']+["']/, `settings_preset = "${target}"`);
    if (!/\b(worldgen_preset|settings_preset)\s*=/.test(content)) content = content.replace(/\bpreset\s*=\s*["'][^"']+["']/, `preset = "${target}"`);
    const range = findLuaTable(content, "overrides");
    if (range) content = `${content.slice(0, range.start)}{}${content.slice(range.end)}`;
    this.saveWorld("master", content);
  }

  private readWorldPreset(shard: Shard): string {
    const file = path.join(this.shardDir(shard), "worldgenoverride.lua");
    if (!fs.existsSync(file)) return shard === "master" ? "SURVIVAL_TOGETHER" : "DST_CAVE";
    return readWorldPresetValue(fs.readFileSync(file, "utf8"), shard);
  }

  getMods(): ModRecord[] {
    this.ensureLayout();
    try {
      return JSON.parse(fs.readFileSync(this.modsFile(), "utf8")) as ModRecord[];
    } catch {
      return [];
    }
  }

  saveMods(mods: ModRecord[]): void {
    for (const mod of mods) parseConfigurationValues(mod.configuration || "{}");
    writeAtomic(this.modsFile(), JSON.stringify(mods, null, 2) + "\n");
    const enabled = mods.filter((mod) => mod.enabled);
    const body = enabled.map((mod) => `  ["workshop-${mod.id}"] = { enabled = true, configuration_options = ${mod.configuration || "{}"} },`).join("\n");
    const overrides = `return {\n${body}\n}\n`;
    writeAtomic(path.join(this.shardDir("master"), "modoverrides.lua"), overrides);
    writeAtomic(path.join(this.shardDir("caves"), "modoverrides.lua"), overrides);
    const setup = enabled.map((mod) => `ServerModSetup("${mod.id}")`).join("\n") + "\n";
    writeAtomic(path.join(config.gameRoot, "mods", "dedicated_server_mods_setup.lua"), setup);
  }

  private writeServerIni(shard: Shard, serverPort: number, steamPort: number, isMaster: boolean): void {
    const value: Record<string, Record<string, string | number | boolean>> = {
      SHARD: { is_master: isMaster },
      NETWORK: { server_port: serverPort },
      STEAM: { master_server_port: steamPort, authentication_port: steamPort + 2000 },
      ACCOUNT: { encode_user_path: true }
    };
    if (!isMaster) value.SHARD!.name = "Caves";
    writeAtomic(path.join(this.shardDir(shard), "server.ini"), ini.stringify(value));
  }

  private shardDir(shard: Shard): string {
    return path.join(config.clusterRoot, shard === "master" ? "Master" : "Caves");
  }

  private cavesWorldCreated(): boolean {
    const sessionRoot = path.join(config.clusterRoot, "Caves", "save", "session");
    if (!fs.existsSync(sessionRoot)) return false;
    const pending = [sessionRoot];
    while (pending.length) {
      const current = pending.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isFile()) return true;
        if (entry.isDirectory()) pending.push(path.join(current, entry.name));
      }
    }
    return false;
  }

  private modsFile(): string {
    return path.join(config.root, "mods.json");
  }

  private portsFile(): string {
    return path.join(config.root, "panel-ports.json");
  }

  private writePanelPorts(ports: PanelPorts): void {
    const value: PanelPorts = {
      masterPort: ports.masterPort,
      cavesPort: ports.cavesPort,
      steamMasterPort: ports.steamMasterPort,
      steamCavesPort: ports.steamCavesPort
    };
    writeAtomic(this.portsFile(), JSON.stringify(value, null, 2) + "\n", 0o640);
  }
}

export const gameConfig = new GameConfigService();

function readWorldPresetValue(content: string, shard: Shard): string {
  return content.match(/\bsettings_preset\s*=\s*["']([^"']+)["']/)?.[1]
    || content.match(/\bpreset\s*=\s*["']([^"']+)["']/)?.[1]
    || content.match(/\bworldgen_preset\s*=\s*["']([^"']+)["']/)?.[1]
    || (shard === "master" ? "SURVIVAL_TOGETHER" : "DST_CAVE");
}

function parseWorldOverrides(content: string): Record<string, WorldOverrideValue> {
  const range = findLuaTable(content, "overrides");
  if (!range) return {};
  const body = content.slice(range.start + 1, range.end - 1);
  const values: Record<string, WorldOverrideValue> = {};
  const entry = /(?:\[\s*["']([a-zA-Z0-9_]+)["']\s*\]|\b([a-zA-Z0-9_]+))\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(-?\d+(?:\.\d+)?)|(true|false))/g;
  for (const match of body.matchAll(entry)) {
    const key = match[1] || match[2];
    if (!key) continue;
    if (match[3] !== undefined || match[4] !== undefined) values[key] = unescapeLua(match[3] ?? match[4] ?? "");
    else if (match[5] !== undefined) values[key] = Number(match[5]);
    else values[key] = match[6] === "true";
  }
  return values;
}

function findLuaTable(content: string, key: string): { start: number; end: number } | null {
  const match = new RegExp(`\\b${key}\\s*=\\s*\\{`).exec(content);
  if (!match) return null;
  const start = content.indexOf("{", match.index);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return { start, end: index + 1 };
  }
  return null;
}

function serializeOverrides(overrides: Record<string, WorldOverrideValue>): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "{}";
  return `{\n${entries.map(([key, value]) => `    ["${key}"] = ${serializeLuaValue(value)},`).join("\n")}\n  }`;
}

function serializeLuaValue(value: WorldOverrideValue): string {
  if (typeof value === "string") return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
  return String(value);
}

function unescapeLua(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\([\\"'])/g, "$1");
}

function isPorts(value: Partial<PanelPorts>): value is PanelPorts {
  return [value.masterPort, value.cavesPort, value.steamMasterPort, value.steamCavesPort].every((port) => Number.isInteger(port) && Number(port) >= 0 && Number(port) <= 65535);
}
