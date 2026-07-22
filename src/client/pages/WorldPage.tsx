import { Code2, RefreshCw, RotateCcw, Save, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Shard, WorldOverrideValue, WorldSettingDefinition, WorldVisualConfig } from "../types";

type Notify = (type: "success" | "error", message: string) => void;

export function WorldPage({ notify }: { notify: Notify }) {
  const [shard, setShard] = useState<Shard>("master");
  const [mode, setMode] = useState<"visual" | "raw">("visual");
  const [category, setCategory] = useState<"worldgen" | "settings">("settings");
  const [group, setGroup] = useState("global");
  const [search, setSearch] = useState("");
  const [visual, setVisual] = useState<WorldVisualConfig | null>(null);
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextVisual, nextRaw] = await Promise.all([
        api.get<WorldVisualConfig>(`/world/${shard}/visual`),
        api.get<string>(`/world/${shard}`)
      ]);
      setVisual(nextVisual);
      setRaw(nextRaw);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "读取世界配置失败");
    } finally {
      setLoading(false);
    }
  }, [notify, shard]);

  useEffect(() => { void load(); }, [load]);

  const definitions = useMemo(() => visual?.definitions.filter((item) => item.category === category) || [], [visual, category]);
  const groups = useMemo(() => [...new Map(definitions.map((item) => [item.group, item.groupLabel])).entries()], [definitions]);
  useEffect(() => { if (visual?.worldCreated && category === "worldgen") setCategory("settings"); }, [visual?.worldCreated, category]);
  useEffect(() => { if (groups.length && !groups.some(([key]) => key === group)) setGroup(groups[0]![0]); }, [group, groups]);
  const visible = definitions.filter((item) => (search.trim() ? `${item.label} ${item.key} ${item.groupLabel}`.toLowerCase().includes(search.trim().toLowerCase()) : item.group === group));
  const knownKeys = new Set(visual?.definitions.map((item) => item.key) || []);
  const unknownCount = Object.keys(visual?.overrides || {}).filter((key) => !knownKeys.has(key)).length;
  const modifiedCount = Object.keys(visual?.overrides || {}).filter((key) => knownKeys.has(key)).length;

  function update(definition: WorldSettingDefinition, value: string) {
    setVisual((current) => {
      if (!current) return current;
      const overrides = { ...current.overrides };
      if (value === definition.defaultValue) delete overrides[definition.key];
      else overrides[definition.key] = value;
      return { ...current, overrides };
    });
  }

  function resetVisible() {
    setVisual((current) => {
      if (!current) return current;
      const overrides = { ...current.overrides };
      for (const definition of visible) delete overrides[definition.key];
      return { ...current, overrides };
    });
  }

  async function save() {
    if (!visual) return;
    setSaving(true);
    try {
      if (mode === "visual") {
        const next = await api.put<WorldVisualConfig>(`/world/${shard}/visual`, { overrides: visual.overrides });
        setVisual(next);
        setRaw(await api.get<string>(`/world/${shard}`));
      } else {
        await api.put(`/world/${shard}`, { content: raw });
        setVisual(await api.get<WorldVisualConfig>(`/world/${shard}/visual`));
      }
      notify("success", visual.worldCreated ? `${shard === "master" ? "地面" : "洞穴"}世界规则已保存` : `${shard === "master" ? "地面" : "洞穴"}世界配置已保存，下次生成世界时生效`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel world-editor">
    <div className="panel-header world-editor-header">
      <div className="world-editor-switches">
        <div className="segmented"><button className={shard === "master" ? "active" : ""} onClick={() => setShard("master")}>地面世界</button><button className={shard === "caves" ? "active" : ""} onClick={() => setShard("caves")}>洞穴世界</button></div>
        <div className="segmented"><button className={mode === "visual" ? "active" : ""} onClick={() => setMode("visual")}><SlidersHorizontal size={14} />可视化</button><button className={mode === "raw" ? "active" : ""} onClick={() => setMode("raw")}><Code2 size={14} />高级 Lua</button></div>
      </div>
      <div className="button-row"><button className="button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={17} />重新读取</button><button className="button primary" disabled={saving || loading} onClick={() => void save()}>{saving ? <RefreshCw className="spin" size={17} /> : <Save size={17} />}保存</button></div>
    </div>
    {loading || !visual ? <div className="page-loading"><RefreshCw className="spin" size={20} />读取配置</div> : mode === "raw" ? <div>{visual.worldCreated && <div className="notice warning">世界已经生成，保存 Lua 时不能修改世界生成设置，只能修改世界规则。</div>}<textarea className="code-editor" spellCheck={false} value={raw} onChange={(event) => setRaw(event.target.value)} /></div> : <div className="world-visual-layout">
      <aside className="world-sidebar">
        <div className="world-category-tabs"><button className={category === "settings" ? "active" : ""} onClick={() => setCategory("settings")}>世界设置</button><button className={category === "worldgen" ? "active" : ""} disabled={visual.worldCreated} title={visual.worldCreated ? "世界已经生成，不能修改世界生成设置" : ""} onClick={() => setCategory("worldgen")}>世界生成</button></div>
        <nav>{groups.map(([key, label]) => <button key={key} className={group === key && !search ? "active" : ""} onClick={() => { setSearch(""); setGroup(key); }}><span>{label}</span><small>{definitions.filter((item) => item.group === key).length}</small></button>)}</nav>
        <div className="world-version">{visual.catalogVersion}<br />{modifiedCount} 项已修改{unknownCount ? ` · ${unknownCount} 项高级配置` : ""}</div>
      </aside>
      <div className="world-settings-pane">
        {visual.worldCreated && <div className="notice warning">世界已经生成，世界生成设置已锁定；当前页面只允许修改世界规则。</div>}
        <div className="world-settings-toolbar"><label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索设置名称或键名" /></label><button className="button secondary" disabled={!visible.some((item) => item.key in visual.overrides)} onClick={resetVisible}><RotateCcw size={16} />重置当前</button></div>
        {unknownCount > 0 && <div className="world-advanced-note">检测到 {unknownCount} 个 MOD 或高级设置项，可视化保存会原样保留。</div>}
        <div className="world-setting-list">{visible.length === 0 ? <div className="empty-state"><Search size={26} /><strong>没有匹配的设置</strong></div> : visible.map((definition) => <WorldSetting key={definition.key} definition={definition} value={visual.overrides[definition.key]} onChange={(value) => update(definition, value)} />)}</div>
      </div>
    </div>}
  </section>;
}

function WorldSetting({ definition, value, onChange }: { definition: WorldSettingDefinition; value: WorldOverrideValue | undefined; onChange: (value: string) => void }) {
  const selected = typeof value === "string" ? value : definition.defaultValue;
  const modified = value !== undefined;
  const iconSize = 42;
  const iconStyle = definition.icon ? {
    backgroundImage: `url(/${definition.icon.atlas === "worldgen" ? "worldgen-customization.png" : "worldsettings-customization.png"})`,
    backgroundSize: `${16 * iconSize}px ${(definition.icon.atlas === "worldgen" ? 8 : 16) * iconSize}px`,
    backgroundPosition: `${-definition.icon.x * iconSize}px ${-definition.icon.y * iconSize}px`
  } : undefined;
  return <div className={`world-setting-row ${modified ? "modified" : ""}`}>
    <div className={`world-setting-symbol ${definition.icon ? "game-icon" : ""}`} style={iconStyle}>{definition.icon ? "" : definition.label.slice(0, 1)}</div>
    <div className="world-setting-copy"><strong>{definition.label}</strong><code>{definition.key}</code></div>
    {modified && <span className="changed-dot" title="已修改" />}
    <select aria-label={definition.label} value={selected} onChange={(event) => onChange(event.target.value)}>{definition.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
  </div>;
}
