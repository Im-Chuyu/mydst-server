import { Archive, Download, FileArchive, Plus, RefreshCw, RotateCcw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ConfirmDialog, type ConfirmState } from "../components/ConfirmDialog";
import type { BackupInfo, JobRecord } from "../types";

export function BackupsPage({ notify }: { notify: (type: "success" | "error", message: string) => void }) {
  const [items, setItems] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { try { setItems(await api.get<BackupInfo[]>("/backups")); } catch (e) { notify("error", e instanceof Error ? e.message : "加载失败"); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { void load(); }, [load]);
  async function create() { try { await api.post<JobRecord>("/backups", { label: "manual" }); notify("success", "备份任务已开始"); window.setTimeout(() => void load(), 2500); } catch (e) { notify("error", e instanceof Error ? e.message : "操作失败"); } }
  async function restore(name: string) { try { await api.post<JobRecord>(`/backups/${encodeURIComponent(name)}/restore`); notify("success", "恢复任务已开始"); } catch (e) { notify("error", e instanceof Error ? e.message : "操作失败"); } }
  async function remove(name: string) { try { await api.delete(`/backups/${encodeURIComponent(name)}`); notify("success", "备份已删除"); await load(); } catch (e) { notify("error", e instanceof Error ? e.message : "删除失败"); } }
  async function upload(file: File | undefined) { if (!file) return; try { await api.upload("/backups/upload", file); notify("success", "备份已通过结构与安全校验并上传"); await load(); } catch (e) { notify("error", e instanceof Error ? e.message : "上传失败"); } finally { if (fileInput.current) fileInput.current.value = ""; } }
  return <><section className="panel"><div className="panel-header"><div><Archive size={19} /><h2>存档备份</h2><span className="count-label">{items.length}</span></div><div className="button-row"><input ref={fileInput} hidden type="file" accept=".tar.gz,.zip,application/gzip,application/zip" onChange={(e) => void upload(e.target.files?.[0])} /><button className="button secondary" title="支持 tar.gz 与 ZIP，上传时自动校验" onClick={() => fileInput.current?.click()}><Upload size={17} />上传存档</button><button className="button primary" onClick={() => void create()}><Plus size={17} />立即备份</button></div></div>
    <div className="table-wrap"><table><thead><tr><th>文件</th><th>创建时间</th><th>大小</th><th className="actions-cell">操作</th></tr></thead><tbody>{loading ? <tr><td colSpan={4}><div className="page-loading"><RefreshCw className="spin" size={18} />读取备份</div></td></tr> : items.length === 0 ? <tr><td colSpan={4}><div className="empty-state"><FileArchive size={28} /><strong>暂无存档备份</strong></div></td></tr> : items.map((item) => <tr key={item.name}><td><div className="file-name"><FileArchive size={18} /><span>{item.name}</span></div></td><td>{new Date(item.createdAt).toLocaleString("zh-CN")}</td><td>{formatBytes(item.size)}</td><td className="actions-cell"><button className="icon-button" title="下载" onClick={() => window.open(`/api/backups/${encodeURIComponent(item.name)}/download`, "_blank")}><Download size={17} /></button><button className="icon-button" title="恢复" onClick={() => setConfirm({ title: "恢复存档", message: `当前世界会先自动备份，然后恢复 ${item.name}。`, confirmText: "开始恢复", danger: true, onConfirm: () => restore(item.name) })}><RotateCcw size={17} /></button><button className="icon-button danger-text" title="删除" onClick={() => setConfirm({ title: "删除备份", message: `将永久删除 ${item.name}。`, confirmText: "删除", danger: true, onConfirm: () => remove(item.name) })}><Trash2 size={17} /></button></td></tr>)}</tbody></table></div>
  </section><ConfirmDialog state={confirm} onClose={() => setConfirm(null)} /></>;
}
function formatBytes(value: number): string { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3); return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`; }
