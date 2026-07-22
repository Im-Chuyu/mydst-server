import { Eraser, RefreshCw, Send, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import type { Shard } from "../types";

export function ConsolePage({ notify }: { notify: (type: "success" | "error", message: string) => void }) {
  const [shard, setShard] = useState<Shard>("master");
  const [lines, setLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const terminal = useRef<HTMLDivElement>(null);
  const load = useCallback(async (quiet = false) => { if (!quiet) setLoading(true); try { const data = await api.get<{ lines: string[] }>(`/logs/${shard}?lines=500`); setLines(data.lines); requestAnimationFrame(() => { if (terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight; }); } catch (e) { if (!quiet) notify("error", e instanceof Error ? e.message : "读取失败"); } finally { setLoading(false); } }, [shard, notify]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 5000); return () => window.clearInterval(timer); }, [load]);
  async function send(event: FormEvent) { event.preventDefault(); if (!command.trim()) return; try { await api.post("/server/console", { shard, command }); setCommand(""); notify("success", "命令已发送"); window.setTimeout(() => void load(true), 500); } catch (e) { notify("error", e instanceof Error ? e.message : "发送失败"); } }
  return <section className="console-layout"><div className="console-toolbar"><div className="segmented"><button className={shard === "master" ? "active" : ""} onClick={() => setShard("master")}>地面</button><button className={shard === "caves" ? "active" : ""} onClick={() => setShard("caves")}>洞穴</button></div><div className="button-row"><button className="icon-button" title="清空显示" onClick={() => setLines([])}><Eraser size={17} /></button><button className="button secondary" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? "spin" : ""} size={17} />刷新</button></div></div><div className="terminal" ref={terminal}><div className="terminal-title"><TerminalSquare size={16} /><span>{shard === "master" ? "MASTER" : "CAVES"} / server_log.txt</span></div><pre>{lines.length ? lines.join("\n") : "等待日志输出..."}</pre></div><form className="console-input" onSubmit={send}><span>&gt;</span><input value={command} onChange={(e) => setCommand(e.target.value)} autoComplete="off" spellCheck={false} placeholder="输入 DST Lua 控制台命令" /><button className="button primary"><Send size={17} />发送</button></form></section>;
}
