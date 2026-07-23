import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { gameConfig } from "./game-config.js";
import { runCommand } from "./process-runner.js";
import type { ChatMessage, Shard, WorldState } from "./types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GameService {
  private demoStatus: Record<Shard, boolean> = { master: true, caves: true };
  private consoleQueues: Record<Shard, Promise<void>> = { master: Promise.resolve(), caves: Promise.resolve() };
  private worldCache?: { at: number; value: WorldState | null };
  private shardPlayerCache: Partial<Record<Shard, { at: number; value: Array<{ userId: string; name: string; prefab: string }> }>> = {};
  private lastKnownPlayerShard = new Map<string, Shard>();

  async status() {
    const [master, caves] = await Promise.all([this.isRunning("master"), this.isRunning("caves")]);
    const currentConfig = gameConfig.get();
    return {
      installed: config.demo || fs.existsSync(config.gameBinary64) || fs.existsSync(config.gameBinary32),
      configured: currentConfig.clusterToken.length >= 10 && currentConfig.masterPort >= 1024 && (!currentConfig.cavesEnabled || currentConfig.cavesPort >= 1024),
      master: { running: master, session: config.sessions.master },
      caves: { running: caves, session: config.sessions.caves }
    };
  }

  async isRunning(shard: Shard): Promise<boolean> {
    if (config.demo) return this.demoStatus[shard];
    const result = await runCommand("tmux", ["has-session", "-t", this.session(shard)], { timeoutMs: 3000 });
    return result.code === 0;
  }

  async start(shard: Shard): Promise<void> {
    const currentConfig = gameConfig.get();
    if (shard === "caves" && !currentConfig.cavesEnabled) throw new Error("洞穴世界未开启，请先在房间设置中开启");
    if (shard === "master" && currentConfig.masterPort < 1024) throw new Error("请先在系统设置中配置地面端口");
    if (shard === "caves" && currentConfig.cavesPort < 1024) throw new Error("请先在系统设置中配置洞穴端口");
    if (currentConfig.clusterToken.length < 10) throw new Error("请先配置 Cluster Token");
    if (config.demo) {
      this.demoStatus[shard] = true;
      return;
    }
    if (!fs.existsSync(config.gameBinary64) && !fs.existsSync(config.gameBinary32)) throw new Error("尚未安装 DST 服务端");
    if (await this.isRunning(shard)) return;
    const runner = path.join(config.panelRoot, "deployment", "run-shard.sh");
    const result = await runCommand("tmux", ["new-session", "-d", "-s", this.session(shard), runner, shard === "master" ? "Master" : "Caves"], { timeoutMs: 5000 });
    if (result.code !== 0) throw new Error(result.stderr || "分片启动失败");
    await this.waitForReady(shard);
  }

  async stop(shard: Shard): Promise<void> {
    if (config.demo) {
      this.demoStatus[shard] = false;
      return;
    }
    if (!(await this.isRunning(shard))) return;
    await this.console(shard, "c_save()");
    await delay(500);
    await this.console(shard, "c_shutdown(false)");
    for (let index = 0; index < 30; index += 1) {
      await delay(1000);
      if (!(await this.isRunning(shard))) return;
    }
    await runCommand("tmux", ["kill-session", "-t", this.session(shard)], { timeoutMs: 5000 });
  }

  async action(action: "start" | "stop" | "restart", target: Shard | "all"): Promise<void> {
    const cavesEnabled = gameConfig.get().cavesEnabled;
    if (target === "caves" && !cavesEnabled && action !== "stop") throw new Error("洞穴世界未开启，请先在房间设置中开启");
    const stopShards: Shard[] = target === "all" ? ["master", "caves"] : [target];
    const startShards: Shard[] = target === "all" ? (cavesEnabled ? ["master", "caves"] : ["master"]) : [target];
    if (action === "stop" || action === "restart") {
      await Promise.all([...stopShards].reverse().map((shard) => this.stop(shard)));
    }
    if (action === "start" || action === "restart") {
      for (const shard of startShards) {
        await this.start(shard);
      }
    }
  }

  private async waitForReady(shard: Shard, timeoutMs = 120_000): Promise<void> {
    if (config.demo) return;
    const startedAt = Date.now();
    const readyPattern = shard === "master"
      ? /Sim paused|Server registered via geo DNS|Shard server started on port/i
      : /secondary shard LUA is now ready|Sim paused|secondary shard is now ready/i;
    while (Date.now() - startedAt < timeoutMs) {
      if (!(await this.isRunning(shard))) throw new Error(`${shard === "master" ? "地面" : "洞穴"}分片进程已退出`);
      if ((await this.logs(shard, 300)).some((line) => readyPattern.test(line))) return;
      await delay(1000);
    }
    throw new Error(`${shard === "master" ? "地面" : "洞穴"}分片启动超时，请检查 server_log.txt`);
  }

  async console(shard: Shard, command: string): Promise<void> {
    const operation = this.consoleQueues[shard].then(() => this.sendConsole(shard, command));
    this.consoleQueues[shard] = operation.catch(() => undefined);
    return operation;
  }

  private async sendConsole(shard: Shard, command: string): Promise<void> {
    if (config.demo) return;
    if (!(await this.isRunning(shard))) throw new Error(`${shard === "master" ? "地面" : "洞穴"}未运行`);
    const literal = await runCommand("tmux", ["send-keys", "-t", this.session(shard), "-l", command], { timeoutMs: 3000 });
    if (literal.code !== 0) throw new Error(literal.stderr || "控制台命令发送失败");
    await runCommand("tmux", ["send-keys", "-t", this.session(shard), "Enter"], { timeoutMs: 3000 });
  }

  async update(onLine: (line: string) => void, restartAfter: boolean): Promise<void> {
    const previous = await this.status();
    if (previous.master.running || previous.caves.running) {
      onLine("正在安全停止游戏分片...");
      await this.action("stop", "all");
    }
    if (config.demo) {
      onLine("[演示模式] SteamCMD 校验完成，服务端已是最新版本");
      await delay(1200);
    } else {
      if (!fs.existsSync(config.steamcmd)) throw new Error("SteamCMD 未安装");
      const result = await runCommand(config.steamcmd, [
        "+force_install_dir", config.gameRoot,
        "+login", "anonymous",
        "+app_update", "343050", "validate",
        "+quit"
      ], { timeoutMs: 30 * 60_000, onLine });
      if (result.code !== 0) throw new Error(result.stderr || "SteamCMD 更新失败");
    }
    if (restartAfter && (previous.master.running || previous.caves.running)) {
      onLine("更新完成，正在恢复先前运行的分片...");
      if (previous.master.running) await this.start("master");
      if (previous.caves.running) await this.start("caves");
    }
  }

  async logs(shard: Shard, lines = 300): Promise<string[]> {
    if (config.demo) {
      const label = shard === "master" ? "Master" : "Caves";
      return [
        `[14:32:08] [MyDST] ${label} shard is running`,
        "[14:32:10] Sim paused",
        "[14:34:25] Client authenticated: KU_demo001",
        "[14:34:26] MyServer ready for connections"
      ];
    }
    const file = path.join(config.clusterRoot, shard === "master" ? "Master" : "Caves", "server_log.txt");
    return tailFile(file, Math.min(Math.max(lines, 20), 2000));
  }

  async players(): Promise<Array<{ userId: string; name: string; prefab: string; shard: Shard }>> {
    if (config.demo) return [{ userId: "KU_demo001", name: "测试玩家", prefab: "wilson", shard: "master" }];
    const [master, caves] = await Promise.all([this.playersOnShard("master"), this.playersOnShard("caves")]);
    const players = new Map<string, { userId: string; name: string; prefab: string; shard: Shard }>();
    for (const [shard, shardPlayers] of [["master", master], ["caves", caves]] as const) {
      for (const player of shardPlayers) {
        if (isHostPlayer(player)) continue;
        const current = players.get(player.userId);
        if (!current || current.name === "[Host]") players.set(player.userId, { ...player, shard });
      }
    }
    return [...players.values()];
  }

  async kick(userId: string): Promise<void> {
    const players = await this.players();
    const shard = players.find((player) => player.userId === userId)?.shard || this.lastKnownPlayerShard.get(userId) || "master";
    await this.console(shard, `TheNet:Kick(${JSON.stringify(userId)})`);
    this.shardPlayerCache = {};
  }

  private async playersOnShard(shard: Shard): Promise<Array<{ userId: string; name: string; prefab: string }>> {
    const cached = this.shardPlayerCache[shard];
    if (cached && Date.now() - cached.at < 5_000) return cached.value;
    if (!(await this.isRunning(shard))) {
      this.shardPlayerCache[shard] = { at: Date.now(), value: [] };
      return [];
    }
    const marker = `MYDST_${Date.now()}`;
    const command = `for _,v in ipairs(TheNet:GetClientTable()) do print("${marker}|"..tostring(v.userid).."|"..string.gsub(tostring(v.name), "|", " ").."|"..tostring(v.prefab)) end`;
    await this.console(shard, command);
    await delay(750);
    const lines = await this.logs(shard, 500);
    const players = lines.flatMap((line) => {
      const output = line.match(new RegExp(`\\]:\\s*${marker}\\|(.+)$`));
      if (!output?.[1]) return [];
      const [userId, name, prefab] = output[1].split("|");
      return userId && name ? [{ userId, name, prefab: prefab || "unknown" }] : [];
    });
    for (const player of players) {
      if (!isHostPlayer(player)) this.lastKnownPlayerShard.set(player.userId, shard);
    }
    this.shardPlayerCache[shard] = { at: Date.now(), value: players };
    return players;
  }

  async worldState(): Promise<WorldState | null> {
    if (config.demo) return { day: 23, season: "autumn", seasonRemainingDays: 8, phase: "day", moonPhase: "full", temperature: 18.5 };
    if (this.worldCache && Date.now() - this.worldCache.at < 10_000) return this.worldCache.value;
    if (!(await this.isRunning("master"))) return null;
    const marker = `MYDST_WORLD_${Date.now()}`;
    const command = `local s=TheWorld.state; print("${marker}|"..tostring((s.cycles or 0)+1).."|"..tostring(s.season or "unknown").."|"..tostring(s.remainingdaysinseason or "").."|"..tostring(s.phase or "unknown").."|"..tostring(s.moonphase or "unknown").."|"..tostring(s.temperature or ""))`;
    await this.console("master", command);
    await delay(750);
    const line = [...(await this.logs("master", 800))].reverse().find((entry) => !entry.includes("RemoteCommandInput") && entry.includes(`${marker}|`));
    let value: WorldState | null = null;
    if (line) {
      const payload = line.slice(line.indexOf(`${marker}|`) + marker.length + 1).split("|");
      value = {
        day: Number(payload[0]) || 1,
        season: payload[1] || "unknown",
        seasonRemainingDays: nullableNumber(payload[2]),
        phase: payload[3] || "unknown",
        moonPhase: payload[4] || "unknown",
        temperature: nullableNumber(payload[5])
      };
    }
    this.worldCache = { at: Date.now(), value };
    return value;
  }

  async chat(shard: Shard | "all", limit = 80): Promise<ChatMessage[]> {
    if (config.demo) {
      const demo: ChatMessage[] = [
        { id: "demo-1", shard: "master", time: "14:34:26", channel: "Say", userId: "KU_demo001", player: "测试玩家", message: "有人一起下洞穴吗？" },
        { id: "demo-2", shard: "caves", time: "14:35:03", channel: "Say", userId: "KU_demo002", player: "洞穴探险家", message: "我在远古入口等你。" }
      ];
      return shard === "all" ? demo : demo.filter((item) => item.shard === shard);
    }
    const [masterPlayers, cavePlayers] = await Promise.all([this.playersOnShard("master"), this.playersOnShard("caves")]);
    const liveMaster = new Set(masterPlayers.filter((player) => !isHostPlayer(player)).map((player) => player.userId));
    const liveCaves = new Set(cavePlayers.filter((player) => !isHostPlayer(player)).map((player) => player.userId));
    const records = ["master", "caves"].flatMap((current) => this.readChat(current as Shard, limit));
    const grouped = new Map<string, ChatMessage[]>();
    for (const message of records) {
      const key = `${message.time}|${message.channel}|${message.userId}|${message.player}|${message.message}`;
      grouped.set(key, [...(grouped.get(key) || []), message]);
    }
    const messages = [...grouped.values()].map((copies) => {
      if (copies.length === 1) return copies[0]!;
      const userId = copies[0]!.userId;
      const origin = liveMaster.has(userId) && !liveCaves.has(userId)
        ? "master"
        : liveCaves.has(userId) && !liveMaster.has(userId)
          ? "caves"
          : this.lastKnownPlayerShard.get(userId) || "master";
      return { ...copies[0]!, shard: origin };
    });
    return messages.filter((message) => shard === "all" || message.shard === shard)
      .sort((left, right) => left.time.localeCompare(right.time))
      .slice(-limit);
  }

  async save(): Promise<void> {
    if (!(await this.isRunning("master"))) throw new Error("地面世界未运行");
    await this.console("master", "c_save()");
    await delay(500);
  }

  async rollback(snapshots: number): Promise<void> {
    if (!Number.isInteger(snapshots) || snapshots < 1 || snapshots > 5) throw new Error("回档快照必须在 1 到 5 之间");
    if (!(await this.isRunning("master"))) throw new Error("地面世界未运行");
    await this.console("master", `c_rollback(${snapshots})`);
    this.worldCache = undefined;
    this.shardPlayerCache = {};
  }

  async regenerateWorld(): Promise<void> {
    const status = await this.status();
    if (!status.master.running || !status.caves.running) throw new Error("重置世界前必须同时启动地面和洞穴");
    await this.console("master", "c_regenerateworld()");
    this.worldCache = undefined;
    this.shardPlayerCache = {};
    this.lastKnownPlayerShard.clear();
  }

  async deleteSaveData(onLine: (line: string) => void): Promise<void> {
    const status = await this.status();
    if (status.master.running || status.caves.running) throw new Error("删除存档前必须先停止所有游戏分片");
    for (const shard of ["Master", "Caves"] as const) {
      const saveRoot = path.join(config.clusterRoot, shard, "save");
      if (fs.existsSync(saveRoot)) {
        onLine(`正在删除 ${shard} 世界存档...`);
        fs.rmSync(saveRoot, { recursive: true, force: true });
      }
    }
    this.worldCache = undefined;
    this.shardPlayerCache = {};
    this.lastKnownPlayerShard.clear();
  }

  async announce(message: string): Promise<void> {
    if (!(await this.isRunning("master"))) throw new Error("地面世界未运行");
    await this.console("master", `c_announce(${JSON.stringify(message)})`);
  }

  snapshotCount(): number {
    const sessionRoot = path.join(config.clusterRoot, "Master", "save", "session");
    if (!fs.existsSync(sessionRoot)) return 0;
    const sessions = fs.readdirSync(sessionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(sessionRoot, entry.name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    if (!sessions[0]) return 0;
    const saves = fs.readdirSync(sessions[0], { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d+$/.test(entry.name));
    return Math.max(0, Math.min(5, saves.length - 1));
  }

  private readChat(shard: Shard, limit: number): ChatMessage[] {
    const file = path.join(config.clusterRoot, shard === "master" ? "Master" : "Caves", "server_chat_log.txt");
    return tailFile(file, Math.min(limit * 4, 1000)).flatMap((line, index) => {
      const structured = line.match(/^\[([^\]]+)\]:\s*\[(Say|Whisper)\]\s*\((KU_[^)]+)\)\s*([^:]{1,80}):\s*(.+)$/i);
      if (!structured) return [];
      const time = structured[1]!.trim();
      const channel = structured[2]!.toLowerCase() === "whisper" ? "Whisper" : "Say";
      const userId = structured[3]!.trim();
      const player = structured[4]!.trim();
      const message = structured[5]!.trim();
      if (!message || player === "[Host]") return [];
      return [{
        id: crypto.createHash("sha1").update(`${shard}|${line}|${index}`).digest("hex").slice(0, 16),
        shard,
        time,
        channel,
        userId,
        player,
        message
      }];
    });
  }

  getAccessList(type: "admin" | "block" | "white"): string[] {
    const file = this.accessFile(type);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  saveAccessList(type: "admin" | "block" | "white", values: string[]): void {
    const unique = [...new Set(values.map((value) => value.trim()).filter((value) => /^KU_[A-Za-z0-9_-]+$/.test(value)))];
    fs.writeFileSync(this.accessFile(type), unique.join("\n") + (unique.length ? "\n" : ""), { encoding: "utf8", mode: 0o640 });
  }

  private accessFile(type: "admin" | "block" | "white"): string {
    const names = { admin: "adminlist.txt", block: "blocklist.txt", white: "whitelist.txt" };
    return path.join(config.clusterRoot, names[type]);
  }

  private session(shard: Shard): string {
    return shard === "master" ? config.sessions.master : config.sessions.caves;
  }
}

function tailFile(file: string, count: number): string[] {
  if (!fs.existsSync(file)) return [];
  const stat = fs.statSync(file);
  const readSize = Math.min(stat.size, Math.max(64 * 1024, count * 300));
  const buffer = Buffer.alloc(readSize);
  const handle = fs.openSync(file, "r");
  fs.readSync(handle, buffer, 0, readSize, stat.size - readSize);
  fs.closeSync(handle);
  return buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-count);
}

export const game = new GameService();

function nullableNumber(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHostPlayer(player: { userId: string; name: string; prefab: string }): boolean {
  return player.name.trim().toLowerCase() === "[host]" || player.userId.trim() === "";
}
