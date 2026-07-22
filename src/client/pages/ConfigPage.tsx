import { Eye, EyeOff, RefreshCw, Save } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api";
import type { GameConfig } from "../types";

export function ConfigPage({ notify }: { notify: (type: "success" | "error", message: string) => void }) {
  const [model, setModel] = useState<GameConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  useEffect(() => { void api.get<GameConfig>("/config").then(setModel).catch((error) => notify("error", error.message)); }, [notify]);

  function set<K extends keyof GameConfig>(key: K, value: GameConfig[K]) { setModel((current) => current ? { ...current, [key]: value } : current); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!model) return;
    setSaving(true);
    try { setModel(await api.put<GameConfig>("/config", model)); notify("success", "房间配置已保存"); }
    catch (error) { notify("error", error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }
  if (!model) return <div className="page-loading"><RefreshCw className="spin" size={20} />正在读取房间配置</div>;

  return <form className="settings-form" onSubmit={save}>
    <section className="form-section"><div className="section-heading"><h2>房间信息</h2><p>Cluster_1</p></div><div className="form-grid">
      <Field label="房间名称"><input value={model.clusterName} onChange={(e) => set("clusterName", e.target.value)} /></Field>
      <Field label="玩法模式"><select value={model.playstyle} onChange={(e) => set("playstyle", e.target.value as GameConfig["playstyle"])}><option value="relaxed">轻松</option><option value="endless">无尽</option><option value="survival">生存</option><option value="wilderness">荒野</option><option value="lightsout">暗无天日</option></select></Field>
      <Field label="房间描述" wide><textarea rows={3} value={model.clusterDescription} onChange={(e) => set("clusterDescription", e.target.value)} /></Field>
      <Field label="房间密码"><div className="secret-input"><input type={showSecrets ? "text" : "password"} value={model.clusterPassword} onChange={(e) => set("clusterPassword", e.target.value)} /><button type="button" className="icon-button" onClick={() => setShowSecrets((v) => !v)} aria-label="显示或隐藏密码">{showSecrets ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field>
      <Field label="房间意向"><select value={model.intention} onChange={(e) => set("intention", e.target.value as GameConfig["intention"])}><option value="cooperative">合作</option><option value="social">社交</option><option value="competitive">竞争</option><option value="madness">疯狂</option></select></Field>
      <Field label="游戏语言"><select value={model.clusterLanguage} onChange={(e) => set("clusterLanguage", e.target.value)}><option value="zh">简体中文</option><option value="zht">繁体中文</option><option value="en">English</option><option value="ko">한국어</option><option value="ru">Русский</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="es">Español</option><option value="it">Italiano</option><option value="pt">Português</option><option value="pl">Polski</option></select></Field>
      <Field label="Cluster Token" wide><div className="secret-input"><input type={showSecrets ? "text" : "password"} value={model.clusterToken} onChange={(e) => set("clusterToken", e.target.value)} /><button type="button" className="icon-button" onClick={() => setShowSecrets((v) => !v)} aria-label="显示或隐藏 Token">{showSecrets ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field>
    </div></section>
    <section className="form-section"><div className="section-heading"><h2>游戏规则</h2><p>Gameplay</p></div><div className="form-grid">
      <Field label="最大玩家数"><input type="number" min="1" max="64" value={model.maxPlayers} onChange={(e) => set("maxPlayers", Number(e.target.value))} /></Field>
      <Field label="快照数量"><input type="number" min="1" max="20" value={model.maxSnapshots} onChange={(e) => set("maxSnapshots", Number(e.target.value))} /></Field>
      <Toggle label="空服暂停" checked={model.pauseWhenEmpty} onChange={(value) => set("pauseWhenEmpty", value)} />
      <Toggle label="允许 PVP" checked={model.pvp} onChange={(value) => set("pvp", value)} />
      <Toggle label="投票踢人" checked={model.voteKick} onChange={(value) => set("voteKick", value)} />
      <Toggle label="启用控制台" checked={model.consoleEnabled} onChange={(value) => set("consoleEnabled", value)} />
      <Toggle label="自动存档" checked={model.autosaverEnabled} onChange={(value) => set("autosaverEnabled", value)} />
      <Toggle label={`开启洞穴世界${model.cavesEnabledLocked ? "（已开启，不可关闭）" : ""}`} checked={model.cavesEnabled} disabled={model.cavesEnabledLocked} onChange={(value) => set("cavesEnabled", value)} />
      <Field label="白名单预留位"><input type="number" min="0" max={model.maxPlayers} value={model.whitelistSlots} onChange={(e) => set("whitelistSlots", Number(e.target.value))} /></Field>
    </div></section>
    <section className="form-section"><div className="section-heading"><h2>访问与 Steam 群组</h2><p>Network</p></div><div className="form-grid">
      <Toggle label="离线集群" checked={model.offlineCluster} onChange={(value) => set("offlineCluster", value)} />
      <Toggle label="仅局域网可见" checked={model.lanOnlyCluster} onChange={(value) => set("lanOnlyCluster", value)} />
      <Toggle label="仅 Steam 群组成员" checked={model.steamGroupOnly} onChange={(value) => set("steamGroupOnly", value)} />
      <Toggle label="群组管理员拥有管理权" checked={model.steamGroupAdmins} onChange={(value) => set("steamGroupAdmins", value)} />
      <Field label="Steam 群组 ID" wide><input inputMode="numeric" placeholder="留空表示不绑定群组" value={model.steamGroupId} onChange={(e) => set("steamGroupId", e.target.value.replace(/\D/g, ""))} /></Field>
    </div></section>
    <div className="notice info">游戏端口由管理员统一配置，恢复存档时会自动使用面板端口。</div>
    <div className="sticky-actions"><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={17} /> : <Save size={17} />}保存配置</button></div>
  </form>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) { return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>; }
function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-field"><span>{label}</span><button type="button" role="switch" aria-checked={checked} disabled={disabled} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><i /></button></label>; }
