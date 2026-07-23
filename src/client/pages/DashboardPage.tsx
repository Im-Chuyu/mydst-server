import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CircleStop,
  Check,
  CloudDownload,
  Copy,
  Cpu,
  Database,
  Gamepad2,
  GitBranch,
  HardDrive,
  History,
  MemoryStick,
  MessageSquareText,
  Moon,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Server,
  SunMedium,
  TimerReset,
  Trash2,
  Users
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { ConfirmDialog, type ConfirmState } from "../components/ConfirmDialog";
import type { ChatMessage, DashboardData, PanelUpdateState, PanelVersion, ServerStatus, Shard } from "../types";

type Notify = (type: "success" | "error", message: string) => void;

export function DashboardPage({ notify, role }: { notify: Notify; role: "admin" | "user" }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState("");
  const [starting, setStarting] = useState<Shard | "all" | "">("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [copied, setCopied] = useState(false);
  const [panelVersion, setPanelVersion] = useState<PanelVersion | null>(null);
  const [checkingVersion, setCheckingVersion] = useState(false);

  const load = useCallback(async (quiet = false) => {
    try {
      setData(await api.get<DashboardData>("/dashboard"));
    } catch (error) {
      if (!quiet) notify("error", error instanceof Error ? error.message : "加载失败");
    }
  }, [notify]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function action(actionName: "start" | "stop" | "restart", shard: Shard | "all") {
    const waitingForStart = actionName === "start";
    setBusy(`${actionName}-${shard}`);
    if (waitingForStart) setStarting(shard);
    try {
      const status = await api.post<ServerStatus>("/server/action", { action: actionName, shard });
      setData((current) => current ? { ...current, server: status } : current);
      if (waitingForStart) {
        await waitForStart(shard);
        return;
      }
      notify("success", actionName === "start" ? "分片已启动" : actionName === "stop" ? "分片已停止" : "分片已重启");
    } catch (error) {
      if (waitingForStart) setStarting("");
      notify("error", error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy("");
      void load(true);
    }
  }

  async function waitForStart(target: Shard | "all") {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const next = await api.get<DashboardData>(`/dashboard?startup=${Date.now()}`);
      setData(next);
      const masterReady = next.server.master.running && next.world !== null;
      const cavesReady = !next.room.cavesEnabled || next.server.caves.running;
      const ready = target === "master" ? masterReady : target === "caves" ? next.server.caves.running : masterReady && cavesReady;
      if (ready) {
        setStarting("");
        notify("success", "世界已启动完毕");
        return;
      }
    }
    setStarting("");
    notify("error", "世界启动超时，请检查游戏日志");
  }

  async function saveWorld() {
    setBusy("save");
    try {
      await api.post("/server/save");
      notify("success", "世界已立即存档");
      window.setTimeout(() => void load(true), 1200);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "存档失败");
    } finally {
      setBusy("");
    }
  }

  async function createBackup() {
    try {
      await api.post("/backups", { label: "dashboard" });
      notify("success", "存档备份任务已开始");
      void load(true);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "备份任务启动失败");
    }
  }

  async function rollback(snapshots: number) {
    setBusy(`rollback-${snapshots}`);
    try {
      await api.post("/server/rollback", { snapshots });
      notify("success", `正在回退 ${snapshots} 个快照`);
      window.setTimeout(() => void load(true), 2500);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "回档失败");
    } finally {
      setBusy("");
    }
  }

  async function updateGame() {
    try {
      await api.post("/server/update", { restartAfter: true });
      notify("success", "更新游戏服务端任务已开始");
      void load(true);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "任务启动失败");
    }
  }

  async function updatePanel() {
    setBusy("panel-update");
    try {
      await api.post<PanelUpdateState>("/panel/update");
      notify("success", "管理后台更新已提交，面板将短暂重启");
      void waitForPanelUpdate();
    } catch (error) {
      setBusy("");
      notify("error", error instanceof Error ? error.message : "管理后台更新启动失败");
    }
  }

  async function checkPanelVersion() {
    setCheckingVersion(true);
    try {
      const version = await api.get<PanelVersion>("/panel/version");
      setPanelVersion(version);
      notify("success", version.updateAvailable ? `发现新版本：${version.latestShortCommit}` : `当前已是最新版本：${version.currentShortCommit}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "后台版本检查失败");
    } finally {
      setCheckingVersion(false);
    }
  }

  async function waitForPanelUpdate() {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      try {
        const health = await fetch(`/api/health?refresh=${Date.now()}`, { cache: "no-store" });
        if (!health.ok) continue;
        const state = await api.get<PanelUpdateState>("/panel/update");
        if (state.status === "failed") {
          setBusy("");
          notify("error", state.message || "管理后台更新失败");
          return;
        }
        if (state.status === "success") {
          notify("success", "管理后台更新完成");
          window.location.reload();
          return;
        }
      } catch {
        // The panel is expected to be unavailable while update.sh rebuilds it.
      }
    }
    setBusy("");
    notify("error", "管理后台更新等待超时，请检查面板日志");
  }

  async function resetWorld() {
    try {
      await api.post("/server/reset-world");
      notify("success", "重置任务已开始，正在备份并重新生成地面与洞穴");
      void load(true);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "世界重置失败");
    }
  }

  async function deleteSave() {
    try {
      await api.post("/server/delete-save");
      notify("success", "删除存档任务已开始，完成后服务器会保持停止");
      void load(true);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "删除存档失败");
    }
  }

  if (!data) return <div className="page-loading"><RefreshCw className="spin" size={20} />正在读取房间状态</div>;
  const { system, server, room, world } = data;
  const online = server.master.running || server.caves.running;

  async function copyDirectConnect() {
    try {
      let copiedToClipboard = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(room.directConnect);
          copiedToClipboard = true;
        } catch {
          // Plain HTTP pages usually cannot use the modern Clipboard API.
        }
      }
      if (!copiedToClipboard) copiedToClipboard = copyTextFallback(room.directConnect);
      if (!copiedToClipboard) throw new Error("copy failed");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      notify("success", "直连命令已复制");
    } catch {
      notify("error", "浏览器未允许访问剪贴板");
    }
  }

  return (
    <>
      <section className="room-status-banner">
        <div className="room-identity">
          <span className={`large-status-dot ${online ? "online" : "offline"}`} />
          <div>
            <div className="room-title-line"><h2>{room.name}</h2><span>{online ? "运行中" : "已停止"}</span></div>
            <p>{room.description || "暂无房间描述"}</p>
            <div className="direct-connect-block"><span>直连代码</span><div className="direct-connect"><code>{room.directConnect || "请先配置地面端口"}</code><button className="icon-button" type="button" title="复制直连代码" aria-label="复制直连代码" disabled={!room.directConnect} onClick={() => void copyDirectConnect()}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div></div>
          </div>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={() => void load()}><RefreshCw size={17} />刷新</button>
          <button className="button primary" disabled={Boolean(busy)} onClick={() => void action("start", "all")}><Play size={17} />全部启动</button>
          <button className="button secondary" disabled={Boolean(busy) || !online} onClick={() => setConfirm({ title: "停止全部分片", message: "地面和洞穴会先保存当前世界，然后安全停止，不会创建存档备份。", confirmText: "保存并停止", onConfirm: () => action("stop", "all") })}><CircleStop size={17} />全部停止</button>
        </div>
      </section>

      {!server.configured && <div className="notice warning"><Server size={18} /><span>Cluster Token 尚未配置，游戏分片无法启动。</span></div>}
      {data.activeJob && <div className="notice job"><RefreshCw className="spin" size={18} /><span>正在执行 {jobName(data.activeJob.type)}</span><code>{data.activeJob.logs.at(-1) || "准备中"}</code></div>}

      {starting && <div className="notice job"><RefreshCw className="spin" size={18} /><span>世界启动中，请稍候...</span><code>{starting === "all" ? "地面与洞穴分片正在启动" : `${starting === "master" ? "地面" : "洞穴"}世界正在启动`}</code></div>}
      {panelVersion && <div className={`notice ${panelVersion.updateAvailable ? "warning" : "info"}`}><GitBranch size={18} /><span>后台版本：当前 {panelVersion.currentShortCommit} · GitHub 最新 {panelVersion.latestShortCommit} · {panelVersion.updateAvailable ? "有新版本可更新" : "已是最新"}</span><code>{new Date(panelVersion.checkedAt).toLocaleString("zh-CN")}</code></div>}
      <section className="world-summary-grid">
        <Summary icon={Gamepad2} label="玩法模式" value={playstyleName(room.playstyle)} detail={`${system.hostname} · ${system.platform}`} />
        <Summary icon={CalendarDays} label="世界进度" value={world ? `第 ${world.day} 天` : "未运行"} detail={world ? `${seasonName(world.season)}${world.seasonRemainingDays === null ? "" : ` · 剩余 ${world.seasonRemainingDays} 天`}` : "等待地面世界启动"} />
        <Summary icon={Users} label="在线玩家" value={`${data.onlinePlayers} / ${room.maxPlayers}`} detail={data.onlinePlayers ? "当前房间在线人数" : "当前没有在线玩家"} />
        <Summary icon={world?.phase === "night" ? Moon : SunMedium} label="时间与气温" value={world ? phaseName(world.phase) : "-"} detail={world ? `${moonName(world.moonPhase)}${world.temperature === null ? "" : ` · ${world.temperature.toFixed(1)}°C`}` : "暂无实时世界状态"} />
      </section>

      <div className="dashboard-operations">
        <div className="dashboard-left-column">
          <section className="panel">
            <div className="panel-header"><div><Server size={19} /><h2>游戏分片</h2></div></div>
            <div className="shard-list">
              <ShardRow name="地面世界" code={`MASTER · UDP ${room.masterPort || "未设置"}`} running={server.master.running} onStart={() => action("start", "master")} onStop={() => setConfirm({ title: "停止地面世界", message: "地面世界将保存并安全停止。", onConfirm: () => action("stop", "master") })} onRestart={() => action("restart", "master")} busy={Boolean(busy)} />
              <ShardRow name="洞穴世界" code={`CAVES · UDP ${room.cavesPort || "未设置"}`} enabled={room.cavesEnabled} running={server.caves.running} onStart={() => action("start", "caves")} onStop={() => setConfirm({ title: "停止洞穴世界", message: "洞穴世界将保存并安全停止。", onConfirm: () => action("stop", "caves") })} onRestart={() => action("restart", "caves")} busy={Boolean(busy)} />
            </div>
          </section>

          <section className="panel archive-panel">
            <div className="panel-header"><div><Database size={19} /><h2>存档与回档</h2><span className="count-label">{data.snapshotCount}</span></div></div>
            <div className="archive-primary-actions">
              <button className="button primary" disabled={!server.master.running || Boolean(busy)} onClick={() => void saveWorld()}><Save size={17} />立即存档</button>
              <button className="button secondary" disabled={Boolean(data.activeJob)} onClick={() => void createBackup()}><Archive size={17} />生成备份</button>
              <button className="button secondary" disabled={Boolean(data.activeJob)} onClick={() => setConfirm({ title: "更新游戏服务端", message: "此操作通过 SteamCMD 更新 DST 游戏文件，期间会安全停止游戏，完成后恢复当前运行状态。", confirmText: "开始更新游戏", onConfirm: updateGame })}><CloudDownload size={17} />更新游戏服务端</button>
              <button className="button secondary" disabled={Boolean(data.activeJob) || busy === "panel-update" || data.panelUpdate.status === "pending" || data.panelUpdate.status === "running"} onClick={() => setConfirm({ title: "更新管理后台", message: "后台会从 GitHub 拉取最新源码、重新构建并重启面板。游戏分片和存档不会被更新操作删除，面板会短暂无法访问。", confirmText: "开始更新后台", onConfirm: updatePanel })}><RefreshCw size={17} />更新管理后台</button>
              <button className="button secondary" disabled={checkingVersion} onClick={() => void checkPanelVersion()}>{checkingVersion ? <RefreshCw className="spin" size={17} /> : <GitBranch size={17} />}检查后台版本</button>
              <button className="button danger-outline" disabled={!room.cavesEnabled || !server.master.running || !server.caves.running || Boolean(data.activeJob) || Boolean(busy)} onClick={() => void resetWorld()}><RotateCcw size={17} />重置世界</button>
              <button className="button danger-outline" disabled={Boolean(data.activeJob) || Boolean(busy)} onClick={() => setConfirm({ title: "删除当前存档", message: "服务器会安全停止并自动备份，然后彻底清理地面与洞穴存档及游戏面板配置。地面和洞穴端口、Cluster Token、面板账号与备份会保留，完成后服务器不会自动启动。", confirmText: "备份并删除", danger: true, onConfirm: deleteSave })}><Trash2 size={17} />删除存档</button>
            </div>
            <div className="rollback-section">
              <div className="rollback-heading"><div><History size={17} /><strong>快照回档</strong></div><span>最多显示最近 5 个</span></div>
              <div className="rollback-grid">
                {[1, 2, 3, 4, 5].map((snapshots) => (
                  <button key={snapshots} className="rollback-button" disabled={!server.master.running || Boolean(busy)} onClick={() => setConfirm({
                    title: `回档 ${snapshots} 个快照`,
                    message: `当前世界进度将丢失，并回退到之前第 ${snapshots} 个快照。地面与洞穴会同步处理。`,
                    confirmText: "确认回档",
                    danger: true,
                    onConfirm: () => rollback(snapshots)
                  })}>
                    <ArchiveRestore size={17} /><span>{snapshots}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="latest-backup">
              <span>最近备份</span>
              <strong>{data.backups[0]?.name || "暂无备份"}</strong>
            </div>
          </section>
        </div>

        <ChatCard notify={notify} masterRunning={server.master.running} />
      </div>

      <section className="metric-grid resource-metrics">
        <Metric icon={Cpu} label="CPU" value={`${system.cpu.usage}%`} detail={`${system.cpu.cores} vCPU`} percent={system.cpu.usage} />
        <Metric icon={MemoryStick} label="内存" value={`${system.memory.usage}%`} detail={`${formatBytes(system.memory.used)} / ${formatBytes(system.memory.total)}`} percent={system.memory.usage} />
        <Metric icon={HardDrive} label="磁盘" value={system.disk ? `${system.disk.usage}%` : "-"} detail={system.disk ? `${formatBytes(system.disk.used)} / ${formatBytes(system.disk.total)}` : "未检测"} percent={system.disk?.usage || 0} />
        <Metric icon={TimerReset} label="系统运行时间" value={formatUptime(system.uptimeSeconds)} detail={system.cpu.model} />
      </section>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function ChatCard({ notify, masterRunning }: { notify: Notify; masterRunning: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (quiet = false) => {
    try {
      const value = await api.get<ChatMessage[]>("/chat?limit=100");
      setMessages(value);
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
    } catch (error) {
      if (!quiet) notify("error", error instanceof Error ? error.message : "聊天记录读取失败");
    }
  }, [notify]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function announce(event: FormEvent) {
    event.preventDefault();
    if (!announcement.trim()) return;
    setSending(true);
    try {
      await api.post("/server/announce", { message: announcement });
      setAnnouncement("");
      notify("success", "公告已发送");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "公告发送失败");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <div><MessageSquareText size={19} /><h2>玩家聊天</h2><span className="count-label">{messages.length}</span></div>
        <button className="icon-button" title="刷新聊天" onClick={() => void load()}><RefreshCw size={16} /></button>
      </div>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 ? <div className="chat-empty"><MessageSquareText size={26} /><span>暂无玩家聊天记录</span></div> : messages.map((item) => (
          <article className="chat-message" key={item.id}>
            <div className="chat-avatar">{item.player.slice(0, 1).toUpperCase()}</div>
            <div className="chat-content">
              <div className="chat-meta"><strong>{item.player}</strong><time>{item.time}</time></div>
              <p>{item.message}</p>
            </div>
          </article>
        ))}
      </div>
      <form className="announce-form" onSubmit={announce}>
        <input maxLength={200} disabled={!masterRunning || sending} value={announcement} onChange={(event) => setAnnouncement(event.target.value)} placeholder={masterRunning ? "发送服务器公告" : "地面世界未运行"} />
        <button className="icon-button" disabled={!masterRunning || sending || !announcement.trim()} title="发送公告"><Send size={17} /></button>
      </form>
    </section>
  );
}

function Summary({ icon: Icon, label, value, detail }: { icon: typeof Gamepad2; label: string; value: string; detail: string }) {
  return <article className="summary-tile"><div className="summary-icon"><Icon size={20} /></div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function Metric({ icon: Icon, label, value, detail, percent }: { icon: typeof Cpu; label: string; value: string; detail: string; percent?: number }) {
  return <article className="metric"><div className="metric-icon"><Icon size={20} /></div><div className="metric-main"><span>{label}</span><strong>{value}</strong><small title={detail}>{detail}</small>{percent !== undefined && <div className="progress"><i style={{ width: `${Math.min(percent, 100)}%` }} /></div>}</div></article>;
}

function ShardRow({ name, code, enabled = true, running, onStart, onStop, onRestart, busy }: { name: string; code: string; enabled?: boolean; running: boolean; onStart: () => void; onStop: () => void; onRestart: () => void; busy: boolean }) {
  return <div className="shard-row"><div className={`shard-emblem ${running ? "running" : ""}`}><Server size={20} /></div><div className="shard-copy"><strong>{name}</strong><span>{code}</span></div><span className={`status-badge ${running ? "success" : "neutral"}`}><i />{running ? "运行中" : enabled ? "已停止" : "未开启"}</span><div className="row-actions">{!enabled ? null : running ? <><button className="icon-button" title="重启" disabled={busy} onClick={onRestart}><RotateCcw size={17} /></button><button className="icon-button" title="停止" disabled={busy} onClick={onStop}><CircleStop size={17} /></button></> : <button className="icon-button" title="启动" disabled={busy} onClick={onStart}><Play size={17} /></button>}</div></div>;
}

function formatBytes(value: number): string { const units = ["B", "KB", "MB", "GB", "TB"]; const index = value ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0; return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`; }
function formatUptime(seconds: number): string { const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); return days ? `${days}天 ${hours}小时` : `${hours}小时`; }
function playstyleName(value: string): string { return ({ relaxed: "轻松", endless: "无尽", survival: "生存", wilderness: "荒野", lightsout: "暗无天日" } as Record<string, string>)[value] || value; }
function seasonName(value: string): string { return ({ autumn: "秋季", winter: "冬季", spring: "春季", summer: "夏季" } as Record<string, string>)[value] || "未知季节"; }
function phaseName(value: string): string { return ({ day: "白天", dusk: "黄昏", night: "夜晚" } as Record<string, string>)[value] || value; }
function moonName(value: string): string { return ({ new: "新月", quarter: "弦月", half: "半月", threequarter: "凸月", full: "满月" } as Record<string, string>)[value] || value; }
function jobName(type: string): string { if (type.startsWith("mod-download:")) return "MOD 下载"; return ({ "game-update": "游戏更新", "world-reset": "世界重置", "save-delete": "删除存档", "backup-create": "存档备份", "backup-restore": "存档恢复", "scheduled-backup": "定时备份", "scheduled-update": "定时更新" } as Record<string, string>)[type] || type; }

function copyTextFallback(value: string): boolean {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const text = document.createElement("span");
  text.textContent = value;
  text.style.position = "fixed";
  text.style.left = "-9999px";
  text.style.opacity = "0";
  document.body.appendChild(text);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(text);
  selection?.removeAllRanges();
  selection?.addRange(range);
  try {
    return document.execCommand("copy");
  } finally {
    selection?.removeAllRanges();
    text.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}
