import { Boxes, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, Code2, Download, ExternalLink, Plus, RefreshCw, Save, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import type { JobRecord, ModConfigValue, ModConfigurationInfo, ModRecord, WorkshopItem } from "../types";

type DownloadState = Pick<JobRecord, "id" | "status"> & { message: string };

export function ModsPage({ notify }: { notify: (type: "success" | "error", message: string) => void }) {
  const [mods, setMods] = useState<ModRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkshopItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const trackedJobs = useRef(new Set<string>());
  const completedJobs = useRef(new Set<string>());

  const loadMods = useCallback(async () => {
    try { setMods(await api.get<ModRecord[]>("/mods")); }
    catch (error) { notify("error", error instanceof Error ? error.message : "读取 MOD 失败"); }
  }, [notify]);

  useEffect(() => { void loadMods(); }, [loadMods]);
  useEffect(() => {
    let disposed = false;
    async function poll() {
      try {
        const jobs = (await api.get<JobRecord[]>("/jobs")).filter((job) => job.type.startsWith("mod-download:"));
        if (disposed) return;
        const next: Record<string, DownloadState> = {};
        for (const job of jobs) {
          const id = job.type.slice("mod-download:".length);
          if (job.status === "running") trackedJobs.current.add(job.id);
          if (!trackedJobs.current.has(job.id)) continue;
          next[id] = { id: job.id, status: job.status, message: cleanJobLine(job.logs.at(-1) || (job.status === "running" ? "正在准备下载..." : "")) };
          if (job.status !== "running" && !completedJobs.current.has(job.id)) {
            completedJobs.current.add(job.id);
            if (job.status === "success") {
              await loadMods();
              notify("success", `MOD ${id} 下载完成，已加入服务器列表`);
              window.setTimeout(() => document.getElementById(`server-mod-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
            } else notify("error", job.error || `MOD ${id} 下载失败`);
          }
        }
        setDownloads(next);
      } catch {
        // The regular page requests surface authentication and connectivity errors.
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 1_200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [loadMods, notify]);

  function addManual() {
    setMods((current) => [...(current || []), { id: "", name: "", enabled: true, configuration: "{}" }]);
  }

  async function download(item: WorkshopItem) {
    setDownloads((current) => ({ ...current, [item.id]: { id: "starting", status: "running", message: "正在创建下载任务..." } }));
    try {
      const job = await api.post<JobRecord>(`/mods/workshop/${item.id}/download`, { title: item.title });
      trackedJobs.current.add(job.id);
      setDownloads((current) => ({ ...current, [item.id]: { id: job.id, status: job.status, message: "正在连接 SteamCMD..." } }));
      notify("success", `${item.title} 已加入下载队列`);
    } catch (error) {
      setDownloads((current) => ({ ...current, [item.id]: { id: "failed", status: "failed", message: error instanceof Error ? error.message : "下载任务启动失败" } }));
      notify("error", error instanceof Error ? error.message : "下载任务启动失败");
    }
  }

  function update(index: number, patch: Partial<ModRecord>) {
    setMods((current) => current?.map((mod, itemIndex) => itemIndex === index ? { ...mod, ...patch } : mod) || null);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearched(true);
    try { setResults(await api.get<WorkshopItem[]>(`/mods/workshop/search?q=${encodeURIComponent(query.trim())}`)); }
    catch (error) { setResults([]); notify("error", error instanceof Error ? error.message : "Steam 创意工坊搜索失败"); }
    finally { setSearching(false); }
  }

  async function save() {
    if (!mods) return;
    setSaving(true);
    try { setMods(await api.put<ModRecord[]>("/mods", mods)); notify("success", "MOD 配置已保存，下次启动分片时加载"); }
    catch (error) { notify("error", error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  if (!mods) return <div className="page-loading"><RefreshCw className="spin" size={20} />正在读取 MOD</div>;
  return <div className="mods-page">
    <section className="panel workshop-search-panel">
      <div className="panel-header"><div><Search size={19} /><h2>搜索 Steam 创意工坊</h2></div></div>
      <form className="workshop-search-form" onSubmit={search}><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入模组名称或 Workshop ID" /></label><button className="button primary" disabled={searching || query.trim().length < 2}>{searching ? <RefreshCw className="spin" size={17} /> : <Search size={17} />}搜索</button></form>
      {(searched || results.length > 0) && <div className="workshop-results">{searching ? <div className="page-loading"><RefreshCw className="spin" size={18} />正在连接 Steam</div> : results.length === 0 ? <div className="empty-state"><Search size={25} /><strong>没有找到匹配的饥荒联机版模组</strong></div> : results.map((item) => {
        const added = mods.some((mod) => mod.id === item.id);
        const task = downloads[item.id];
        const downloading = task?.status === "running";
        return <article className="workshop-result" key={item.id}>
          <div className="workshop-preview">{item.previewUrl ? <img src={item.previewUrl} alt="" loading="lazy" /> : <Boxes size={24} />}</div>
          <div><strong title={item.title}>{item.title}</strong><span>Workshop · {item.id}</span></div>
          <button type="button" className="icon-button" title="打开创意工坊页面" onClick={() => window.open(`https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}`, "_blank", "noopener,noreferrer")}><ExternalLink size={16} /></button>
          <button type="button" className="button secondary" disabled={added || downloading} onClick={() => void download(item)}>{downloading ? <RefreshCw className="spin" size={16} /> : added ? <CheckCircle2 size={16} /> : <Download size={16} />}{downloading ? "下载中" : added ? "已添加" : task?.status === "failed" ? "重试" : "添加"}</button>
          {task && !added && <div className={`workshop-download-status ${task.status}`}><div className="download-progress"><i /></div><span>{task.message}</span></div>}
        </article>;
      })}</div>}
    </section>

    <section className="panel"><div className="panel-header"><div><Boxes size={19} /><h2>服务器 MOD</h2><span className="count-label">{mods.length}</span></div><div className="button-row"><button type="button" className="button secondary" onClick={addManual}><Plus size={17} />手动添加</button><button type="button" className="button primary" disabled={saving} onClick={() => void save()}>{saving ? <RefreshCw className="spin" size={17} /> : <Save size={17} />}保存</button></div></div>
      <div className="mod-list">{mods.length === 0 ? <div className="empty-state"><Boxes size={28} /><strong>暂无服务器 MOD</strong></div> : mods.map((mod, index) => <div className={`mod-row ${expanded === mod.id ? "expanded" : ""}`} id={mod.id ? `server-mod-${mod.id}` : undefined} key={`${index}-${mod.id}`}>
        <div className="mod-row-main">
          <div className="mod-enable-control"><button type="button" role="switch" aria-label={`${mod.name || "未命名 MOD"}启用状态`} aria-checked={mod.enabled} className={`switch ${mod.enabled ? "on" : ""}`} onClick={() => update(index, { enabled: !mod.enabled })}><i /></button><small>{mod.enabled ? "已启用" : "已停用"}</small></div>
          <div className="mod-fields"><label><span>Workshop ID</span><input value={mod.id} inputMode="numeric" onChange={(event) => update(index, { id: event.target.value.replace(/\D/g, "") })} /></label><label><span>显示名称</span><input value={mod.name} onChange={(event) => update(index, { name: event.target.value })} /></label></div>
          <button type="button" className="button small secondary" disabled={!/^\d{5,12}$/.test(mod.id)} onClick={() => setExpanded((current) => current === mod.id ? null : mod.id)}><SlidersHorizontal size={15} />配置{expanded === mod.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
          <button type="button" className="icon-button danger-text" title="移除" onClick={() => setMods((current) => current?.filter((_, itemIndex) => itemIndex !== index) || null)}><Trash2 size={17} /></button>
        </div>
        {expanded === mod.id && <ModConfigurationEditor mod={mod} onChange={(configuration) => update(index, { configuration })} notify={notify} />}
      </div>)}</div>
    </section>
  </div>;
}

function ModConfigurationEditor({ mod, onChange, notify }: { mod: ModRecord; onChange: (configuration: string) => void; notify: (type: "success" | "error", message: string) => void }) {
  const [mode, setMode] = useState<"visual" | "lua">("visual");
  const [info, setInfo] = useState<ModConfigurationInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setInfo(await api.get<ModConfigurationInfo>(`/mods/${mod.id}/configuration`)); }
    catch (error) { notify("error", error instanceof Error ? error.message : "读取 MOD 配置失败"); }
    finally { setLoading(false); }
  }, [mod.id, notify]);
  useEffect(() => { void load(); }, [load]);

  const values = parseLuaValues(mod.configuration);
  function updateVisual(name: string, value: ModConfigValue) { onChange(serializeLuaValues({ ...values, [name]: value })); }

  return <div className="mod-configuration">
    <div className="mod-config-toolbar">
      <div className="segmented"><button type="button" className={mode === "visual" ? "active" : ""} onClick={() => setMode("visual")}><SlidersHorizontal size={14} />可视化</button><button type="button" className={mode === "lua" ? "active" : ""} onClick={() => setMode("lua")}><Code2 size={14} />Lua 代码</button></div>
      <button type="button" className="icon-button" title="重新读取 modinfo.lua" onClick={() => void load()}><RefreshCw className={loading ? "spin" : ""} size={16} /></button>
    </div>
    {mode === "lua" ? <textarea className="mod-lua-editor" spellCheck={false} value={mod.configuration} onChange={(event) => onChange(event.target.value)} aria-label={`${mod.name} Lua 配置`} /> : loading ? <div className="page-loading"><RefreshCw className="spin" size={18} />正在读取 modinfo.lua</div> : !info?.options.length ? <div className="mod-config-empty"><CircleHelp size={20} /><span>{info?.warning || "该 MOD 没有可配置项"}</span></div> : <div className="mod-option-grid">{info.options.map((option) => {
      const selected = values[option.name] ?? option.defaultValue;
      const selectedIndex = Math.max(0, option.choices.findIndex((choice) => Object.is(choice.data, selected)));
      return <label className="mod-option" key={option.name} title={option.hover || undefined}><span>{option.label}{option.hover && <CircleHelp size={13} />}</span><select value={String(selectedIndex)} onChange={(event) => updateVisual(option.name, option.choices[Number(event.target.value)]!.data)}>{option.choices.map((choice, index) => <option key={`${option.name}-${index}`} value={index}>{choice.description}</option>)}</select><code>{option.name}</code></label>;
    })}</div>}
  </div>;
}

function parseLuaValues(source: string): Record<string, ModConfigValue> {
  const result: Record<string, ModConfigValue> = {};
  const entry = /(?:\[\s*["']([a-zA-Z0-9_]+)["']\s*\]|\b([a-zA-Z0-9_]+))\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(-?\d+(?:\.\d+)?)|(true|false))/g;
  for (const match of source.matchAll(entry)) {
    const key = match[1] || match[2];
    if (!key) continue;
    if (match[3] !== undefined || match[4] !== undefined) result[key] = (match[3] ?? match[4] ?? "").replace(/\\n/g, "\n").replace(/\\([\\"'])/g, "$1");
    else if (match[5] !== undefined) result[key] = Number(match[5]);
    else result[key] = match[6] === "true";
  }
  return result;
}

function serializeLuaValues(values: Record<string, ModConfigValue>): string {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "{}";
  return `{\n${entries.map(([key, value]) => `  ["${key}"] = ${serializeLuaValue(value)},`).join("\n")}\n}`;
}

function serializeLuaValue(value: ModConfigValue): string {
  return typeof value === "string" ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"` : String(value);
}

function cleanJobLine(value: string): string { return value.replace(/\x1b\[[0-9;]*m/g, "").trim(); }
