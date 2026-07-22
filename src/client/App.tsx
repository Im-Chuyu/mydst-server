import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, setCsrfToken } from "./api";
import { AuthScreen } from "./AuthScreen";
import { Layout } from "./components/Layout";
import { Toast, type ToastState } from "./components/Toast";
import { BackupsPage } from "./pages/BackupsPage";
import { ConfigPage } from "./pages/ConfigPage";
import { ConsolePage } from "./pages/ConsolePage";
import { DashboardPage } from "./pages/DashboardPage";
import { ModsPage } from "./pages/ModsPage";
import { PlayersPage } from "./pages/PlayersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorldPage } from "./pages/WorldPage";
import type { PageKey, Session } from "./types";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [initialized, setInitialized] = useState(true);
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [page, setPage] = useState<PageKey>("dashboard");
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.get<{ initialized: boolean; setupTokenRequired: boolean }>("/auth/status");
        setInitialized(status.initialized);
        setSetupTokenRequired(status.setupTokenRequired);
        if (status.initialized) {
          const active = await api.get<Session>("/auth/session");
          setCsrfToken(active.csrfToken);
          setSession(active);
        }
      } catch {
        setSession(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const notify = useCallback((type: ToastState["type"], message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  if (booting) return <div className="boot-screen"><LoaderCircle className="spin" size={28} /><span>正在连接 MyDST</span></div>;
  if (!session) return <AuthScreen initialized={initialized} setupTokenRequired={setupTokenRequired} onAuthenticated={(active) => { setInitialized(true); setSession(active); }} />;

  const common = { notify };
  const pages: Record<PageKey, ReactNode> = {
    dashboard: <DashboardPage {...common} role={session.role} />,
    config: <ConfigPage {...common} />,
    world: <WorldPage {...common} />,
    mods: <ModsPage {...common} />,
    backups: <BackupsPage {...common} />,
    console: <ConsolePage {...common} />,
    players: <PlayersPage {...common} />,
    settings: <SettingsPage {...common} role={session.role} onSessionExpired={() => setSession(null)} />
  };

  return (
    <>
      <Layout session={session} page={page} onPage={setPage} onLogout={async () => { await api.post("/auth/logout"); setSession(null); }}>
        {pages[page]}
      </Layout>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
