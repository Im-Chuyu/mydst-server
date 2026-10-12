import { ArrowDown, ArrowUp, Megaphone, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AnnouncementSettings } from "../types";

export function AnnouncementSettingsSection({ notify }: { notify: (type: "success" | "error", message: string) => void }) {
  const [settings, setSettings] = useState<AnnouncementSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  useEffect(() => {
    void api.get<AnnouncementSettings>("/announcements").then(setSettings).catch((error) => notify("error", error.message));
  }, [notify]);

  function set<K extends keyof AnnouncementSettings>(key: K, value: AnnouncementSettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(await api.put<AnnouncementSettings>("/announcements", { ...settings, messages: settings.messages.filter((message) => message.trim()) }));
      notify("success", "公告设置已保存");
    } catch (error) { notify("error", error instanceof Error ? error.message : "公告保存失败"); }
    finally { setSaving(false); }
  }

  async function send(index: number) {
    if (!settings) return;
    setSending(index);
    try {
      await api.post("/server/announce", { message: settings.messages[index] });
      notify("success", "公告已发送");
    } catch (error) { notify("error", error instanceof Error ? error.message : "公告发送失败"); }
    finally { setSending(null); }
  }

  function move(index: number, offset: number) {
    if (!settings) return;
    const messages = [...settings.messages];
    [messages[index], messages[index + offset]] = [messages[index + offset]!, messages[index]!];
    set("messages", messages);
  }

  return <section className="form-section announcement-section">
    <div className="section-heading"><h2><Megaphone size={19} />公告发送</h2><p>Asia/Shanghai</p></div>
    {!settings ? <p className="announcement-hint">正在读取公告设置…</p> : <>
      <fieldset className="announcement-fields" disabled={saving}>
        <label className="check-field"><input type="checkbox" checked={settings.enabled} onChange={(e) => set("enabled", e.target.checked)} /><span>启用自动公告</span></label>
        <div className="form-grid">
          <label className="field"><span>发送方式</span><select value={settings.mode} onChange={(e) => set("mode", e.target.value as AnnouncementSettings["mode"])}><option value="interval">按时间间隔</option><option value="daily">每天定时</option></select></label>
          {settings.mode === "interval" ? <label className="field"><span>发送间隔（分钟）</span><input type="number" min="1" max="10080" value={settings.intervalMinutes || ""} onChange={(e) => set("intervalMinutes", Number(e.target.value))} /></label> : <div className="announcement-times">
            <span className="announcement-label">每日发送时间（北京时间）</span>
            {settings.times.map((time, index) => <div className="announcement-time" key={index}>
              <label className="field"><span>发送时间 {index + 1}</span><input type="time" value={time} onChange={(e) => set("times", settings.times.map((value, i) => i === index ? e.target.value : value))} /></label>
              <button type="button" className="icon-button danger-text" aria-label={`删除时间 ${index + 1}`} onClick={() => set("times", settings.times.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
            </div>)}
            <button type="button" className="button secondary" disabled={settings.times.length >= 24} onClick={() => { const available = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`).find((time) => !settings.times.includes(time)); if (available) set("times", [...settings.times, available]); }}><Plus size={16} />添加时间</button>
          </div>}
        </div>
        <label className="check-field"><input type="checkbox" checked={settings.onlyWhenPlayersOnline} onChange={(e) => set("onlyWhenPlayersOnline", e.target.checked)} /><span>仅房间有在线玩家时发送（包括洞穴玩家）</span></label>
        <p className="announcement-hint">每次发送一段，按下方顺序循环；只有一段时重复发送同一段。{settings.mode === "interval" ? "保存修改后开始计时，达到间隔时发送；空房间跳过发送，有人后继续，不补发累计公告。" : "每天在指定时间发送；空房间或服务器未运行时跳过该时段，不补发。"}</p>
        <div className="announcement-messages">
          {settings.messages.map((message, index) => <div className="announcement-message" key={index}>
            <label className="field"><span>公告 {index + 1} <small>{message.length}/500</small></span><textarea rows={3} maxLength={500} placeholder="输入要发送到游戏房间的公告内容" value={message} onChange={(e) => set("messages", settings.messages.map((value, i) => i === index ? e.target.value : value))} /></label>
            <div className="announcement-message-actions">
              <button type="button" className="icon-button" aria-label={`上移公告 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
              <button type="button" className="icon-button" aria-label={`下移公告 ${index + 1}`} disabled={index === settings.messages.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
              <button type="button" className="icon-button danger-text" aria-label={`删除公告 ${index + 1}`} onClick={() => set("messages", settings.messages.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
              <button type="button" className="button secondary" disabled={!message.trim() || sending !== null} onClick={() => void send(index)}><Send size={15} />{sending === index ? "发送中…" : "立即发送"}</button>
            </div>
          </div>)}
        </div>
        <button type="button" className="button secondary" disabled={settings.messages.length >= 50} onClick={() => set("messages", [...settings.messages, ""])}><Plus size={16} />添加公告</button>
      </fieldset>
      <div className="section-actions"><button type="button" className="button primary" disabled={saving} onClick={() => void save()}><Save size={17} />{saving ? "保存中…" : "保存公告"}</button></div>
    </>}
  </section>;
}
