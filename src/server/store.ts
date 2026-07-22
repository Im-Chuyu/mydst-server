import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { AuditRecord, PanelState, ScheduleSettings, SessionRecord, UserRecord, UserRole } from "./types.js";

const defaultSchedules: ScheduleSettings = {
  backupEnabled: true,
  backupTime: "06:00",
  updateEnabled: false,
  updateTime: "05:30",
  restartAfterUpdate: true,
  retentionCount: 14
};

function defaultState(): PanelState {
  return { users: [], sessions: [], schedules: defaultSchedules, audit: [] };
}

export class StateStore {
  private state: PanelState;

  constructor() {
    fs.mkdirSync(config.root, { recursive: true, mode: 0o750 });
    this.state = this.read();
    this.pruneSessions();
  }

  private read(): PanelState {
    try {
      const parsed = JSON.parse(fs.readFileSync(config.stateFile, "utf8")) as PanelState;
      return {
        ...defaultState(),
        ...parsed,
        users: parsed.users || [],
        schedules: { ...defaultSchedules, ...parsed.schedules },
        sessions: (parsed.sessions || []).map((session) => ({
          ...session,
          role: session.role || (parsed.admin?.username === session.username ? "admin" : "user")
        })),
        audit: parsed.audit || []
      };
    } catch {
      return defaultState();
    }
  }

  private persist(): void {
    const temp = `${config.stateFile}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true, mode: 0o750 });
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, config.stateFile);
  }

  snapshot(): PanelState {
    return structuredClone(this.state);
  }

  hasAdmin(): boolean {
    return Boolean(this.state.admin);
  }

  setAdmin(username: string, passwordHash: string): void {
    this.state.admin = { username, passwordHash, role: "admin", createdAt: new Date().toISOString() };
    this.state.sessions = [];
    this.persist();
  }

  updatePassword(passwordHash: string): void {
    if (!this.state.admin) throw new Error("管理员尚未初始化");
    this.state.admin.passwordHash = passwordHash;
    this.state.sessions = [];
    this.persist();
  }

  createSession(username: string, role: UserRole): { token: string; record: SessionRecord } {
    const token = crypto.randomBytes(32).toString("base64url");
    const record: SessionRecord = {
      tokenHash: this.hashToken(token),
      csrfToken: crypto.randomBytes(24).toString("base64url"),
      username,
      role,
      expiresAt: new Date(Date.now() + config.sessionDays * 86400_000).toISOString()
    };
    this.pruneSessions(false);
    this.state.sessions.push(record);
    this.persist();
    return { token, record };
  }

  getUser(username: string): { passwordHash: string; role: UserRole } | undefined {
    const admin = this.state.admin;
    if (admin?.username === username) return { passwordHash: admin.passwordHash, role: "admin" };
    const user = this.state.users.find((item) => item.username === username);
    return user ? { passwordHash: user.passwordHash, role: "user" } : undefined;
  }

  addUser(username: string, passwordHash: string): UserRecord {
    if (this.state.admin?.username === username || this.state.users.some((item) => item.username === username)) throw new Error("账号已经存在");
    const user: UserRecord = { username, passwordHash, role: "user", createdAt: new Date().toISOString() };
    this.state.users.push(user);
    this.persist();
    return user;
  }

  getSession(token: string | undefined): SessionRecord | undefined {
    if (!token) return undefined;
    this.pruneSessions();
    const tokenHash = this.hashToken(token);
    return this.state.sessions.find((session) => session.tokenHash === tokenHash);
  }

  deleteSession(token: string | undefined): void {
    if (!token) return;
    const tokenHash = this.hashToken(token);
    this.state.sessions = this.state.sessions.filter((session) => session.tokenHash !== tokenHash);
    this.persist();
  }

  setSchedules(schedules: ScheduleSettings): void {
    this.state.schedules = schedules;
    this.persist();
  }

  addAudit(record: Omit<AuditRecord, "id" | "at">): void {
    this.state.audit.unshift({
      ...record,
      id: crypto.randomUUID(),
      at: new Date().toISOString()
    });
    this.state.audit = this.state.audit.slice(0, 500);
    this.persist();
  }

  private pruneSessions(persist = true): void {
    const now = Date.now();
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((session) => Date.parse(session.expiresAt) > now);
    if (persist && before !== this.state.sessions.length) this.persist();
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}

export const store = new StateStore();
