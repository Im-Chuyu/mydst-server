import {
  Archive,
  BookOpenText,
  Boxes,
  ChevronLeft,
  CircleGauge,
  LogOut,
  Menu,
  ScrollText,
  ServerCog,
  Settings,
  TerminalSquare,
  Users,
  X
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { PageKey, Session } from "../types";

const navigation: Array<{ key: PageKey; label: string; icon: typeof CircleGauge }> = [
  { key: "dashboard", label: "运行概览", icon: CircleGauge },
  { key: "config", label: "房间配置", icon: ServerCog },
  { key: "world", label: "世界设置", icon: BookOpenText },
  { key: "mods", label: "MOD 管理", icon: Boxes },
  { key: "backups", label: "存档备份", icon: Archive },
  { key: "console", label: "日志与控制台", icon: TerminalSquare },
  { key: "players", label: "玩家与名单", icon: Users },
  { key: "settings", label: "系统设置", icon: Settings }
];

export function Layout({ session, page, onPage, onLogout, children }: {
  session: Session;
  page: PageKey;
  onPage: (page: PageKey) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setMobileOpen(false), [page]);
  const current = navigation.find((item) => item.key === page)!;
  const CurrentIcon = current.icon;
  const title = current.label;

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="关闭导航" />}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <img src="/favicon.ico" alt="" />
          <div className="brand-copy"><strong>MyDST</strong><span>SERVER CONTROL</span></div>
          <button className="icon-button sidebar-mobile-close" onClick={() => setMobileOpen(false)} aria-label="关闭导航"><X size={18} /></button>
        </div>
        <nav>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => onPage(item.key)} title={collapsed ? item.label : undefined}>
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => setCollapsed((value) => !value)} title={collapsed ? "展开导航" : "收起导航"}>
            <ChevronLeft size={18} className="collapse-icon" /><span>收起导航</span>
          </button>
          <button onClick={onLogout} title={collapsed ? "退出登录" : undefined}>
            <LogOut size={18} /><span>退出登录</span>
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={20} /></button>
            <CurrentIcon size={20} />
            <h1>{title}</h1>
          </div>
          <div className="account"><span className="status-dot" />{session.user.username}</div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
