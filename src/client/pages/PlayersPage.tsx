import { Ban, RefreshCw, Save, ShieldCheck, UserMinus, Users, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface Player {
  userId: string;
  name: string;
  prefab: string;
  shard: "master" | "caves";
  admin: boolean;
  blocked: boolean;
  whitelisted: boolean;
}

type AccessType = "admin" | "block" | "white";
type PlayerFlag = "admin" | "blocked" | "whitelisted";

const accessMeta = {
  admin: { icon: ShieldCheck, label: "管理员名单", action: "管理员", flag: "admin" },
  block: { icon: Ban, label: "黑名单", action: "黑名单", flag: "blocked" },
  white: { icon: UserRoundCheck, label: "白名单", action: "白名单", flag: "whitelisted" }
} as const satisfies Record<AccessType, { icon: typeof ShieldCheck; label: string; action: string; flag: PlayerFlag }>;

export function PlayersPage({ notify }: { notify: (type: "success" | "error", message: string) => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [type, setType] = useState<AccessType>("admin");
  const [list, setList] = useState("");

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    try {
      setPlayers(await api.get<Player[]>("/players"));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadAccessList = useCallback(async (accessType: AccessType) => {
    try {
      setList((await api.get<string[]>(`/access/${accessType}`)).join("\n"));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "读取名单失败");
    }
  }, [notify]);

  useEffect(() => { void loadPlayers(); }, [loadPlayers]);
  useEffect(() => { void loadAccessList(type); }, [loadAccessList, type]);

  async function saveList() {
    try {
      const values = list.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      await api.put(`/access/${type}`, values);
      await loadPlayers();
      notify("success", `${accessMeta[type].label}已保存`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "保存失败");
    }
  }

  async function kick(player: Player) {
    const operation = `${player.userId}:kick`;
    setPending(operation);
    try {
      await api.post(`/players/${encodeURIComponent(player.userId)}/kick`);
      notify("success", `已踢出 ${player.name}`);
      window.setTimeout(() => void loadPlayers(), 500);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(null);
    }
  }

  async function toggleAccess(player: Player, accessType: AccessType) {
    const meta = accessMeta[accessType];
    const enabled = !player[meta.flag];
    const operation = `${player.userId}:${accessType}`;
    setPending(operation);
    try {
      await api.post(`/players/${encodeURIComponent(player.userId)}/access`, { type: accessType, enabled });
      setPlayers((current) => current.map((item) => item.userId === player.userId ? { ...item, [meta.flag]: enabled } : item));
      if (type === accessType) await loadAccessList(type);
      notify("success", `${enabled ? "已添加到" : "已移出"}${meta.label}`);
      if (accessType === "block" && enabled) window.setTimeout(() => void loadPlayers(), 500);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(null);
    }
  }

  const AccessIcon = accessMeta[type].icon;

  return <div className="two-column players-layout">
    <section className="panel">
      <div className="panel-header">
        <div><Users size={19} /><h2>在线玩家</h2><span className="count-label">{players.length}</span></div>
        <button className="button secondary" onClick={() => void loadPlayers()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={17} />刷新</button>
      </div>
      <div className="player-list">
        {!loading && players.length === 0 ? <div className="empty-state"><Users size={28} /><strong>当前没有在线玩家</strong></div> : players.map((player) => <div className="player-row" key={player.userId}>
          <div className="avatar-letter">{player.name.slice(0, 1).toUpperCase()}</div>
          <div className="player-identity">
            <strong>{player.name}</strong>
            <span>{player.userId} · {player.prefab}</span>
          </div>
          <div className="player-row-actions">
            <button className="button small danger-outline" disabled={pending !== null} onClick={() => void kick(player)}><UserMinus size={15} />踢出</button>
            {(["admin", "white", "block"] as AccessType[]).map((accessType) => {
              const meta = accessMeta[accessType];
              const Icon = meta.icon;
              const active = player[meta.flag];
              return <button key={accessType} className={`button small access-toggle ${accessType} ${active ? "active" : ""}`} disabled={pending !== null} aria-pressed={active} onClick={() => void toggleAccess(player, accessType)}><Icon size={15} />{meta.action}</button>;
            })}
          </div>
        </div>)}
      </div>
    </section>
    <section className="panel">
      <div className="panel-header">
        <div><AccessIcon size={19} /><h2>{accessMeta[type].label}</h2></div>
        <button className="button primary" onClick={() => void saveList()}><Save size={17} />保存</button>
      </div>
      <div className="segmented full"><button className={type === "admin" ? "active" : ""} onClick={() => setType("admin")}>管理员</button><button className={type === "block" ? "active" : ""} onClick={() => setType("block")}>黑名单</button><button className={type === "white" ? "active" : ""} onClick={() => setType("white")}>白名单</button></div>
      <textarea className="list-editor" spellCheck={false} value={list} onChange={(event) => setList(event.target.value)} placeholder="每行一个 KU_xxxxxxxx" />
    </section>
  </div>;
}
