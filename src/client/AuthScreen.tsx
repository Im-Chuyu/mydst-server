import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, setCsrfToken } from "./api";
import type { Session } from "./types";

export function AuthScreen({ initialized, setupTokenRequired, onAuthenticated }: {
  initialized: boolean;
  setupTokenRequired: boolean;
  onAuthenticated: (session: Session) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [registering, setRegistering] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const session = initialized && !registering
        ? await api.post<Session>("/auth/login", { username, password })
        : initialized
          ? await api.post<Session>("/auth/register", { username, password })
        : await api.post<Session>("/auth/setup", { username, password, setupToken });
      setCsrfToken(session.csrfToken);
      onAuthenticated(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-media" />
      <section className="auth-panel">
        <div className="auth-brand"><img src="/favicon.ico" alt="" /><span>MyDST</span></div>
        <form onSubmit={submit}>
          <div className="auth-heading">
            <span className="eyebrow">SERVER CONTROL</span>
          <h1>{initialized ? registering ? "注册账号" : "管理后台" : "初始化后台"}</h1>
          </div>
          <label>
            <span>管理员账号</span>
            <div className="input-with-icon"><UserRound size={18} /><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></div>
          </label>
          <label>
            <span>管理员密码</span>
            <div className="input-with-icon"><LockKeyhole size={18} /><input type={visible ? "text" : "password"} autoComplete={initialized ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
              <button type="button" className="password-toggle" onClick={() => setVisible((value) => !value)} aria-label={visible ? "隐藏密码" : "显示密码"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
          </label>
          {!initialized && setupTokenRequired && (
            <label>
              <span>安装验证码</span>
              <div className="input-with-icon"><KeyRound size={18} /><input autoComplete="one-time-code" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} /></div>
            </label>
          )}
          {error && <div className="form-error">{error}</div>}
          <button className="button primary auth-submit" disabled={loading}>
            {loading && <LoaderCircle className="spin" size={18} />}{initialized ? registering ? "注册并进入" : "登录" : "创建管理员"}
          </button>
          {initialized && <button type="button" className="auth-switch" onClick={() => { setRegistering((value) => !value); setError(""); }}>{registering ? "已有账号？返回登录" : "注册普通用户账号"}</button>}
        </form>
        <footer>MyDST / 山东测试节点</footer>
      </section>
    </main>
  );
}
