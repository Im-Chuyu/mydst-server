import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { compare, hash } from "bcryptjs";
import { config } from "./config.js";
import { store } from "./store.js";
import type { SessionRecord } from "./types.js";

export const sessionCookie = "mydst_session";

export function sessionOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.cookieSecure,
    path: "/",
    maxAge: config.sessionDays * 86400_000
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = store.getSession(req.cookies?.[sessionCookie]);
  if (!session) {
    res.status(401).json({ error: "登录状态已失效" });
    return;
  }
  res.locals.session = session;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = res.locals.session as SessionRecord | undefined;
  if (!session || session.role !== "admin") {
    res.status(403).json({ error: "仅管理员可以执行此操作" });
    return;
  }
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const session = res.locals.session as SessionRecord | undefined;
  const token = req.header("x-csrf-token");
  if (!session || !token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken))) {
    res.status(403).json({ error: "请求校验失败，请刷新页面后重试" });
    return;
  }
  next();
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function audit(req: Request, action: string, detail: string): void {
  const session = resSession(req);
  store.addAudit({
    username: session?.username || "system",
    action,
    detail: detail.slice(0, 300),
    ip: clientIp(req)
  });
}

function resSession(req: Request): SessionRecord | undefined {
  return store.getSession(req.cookies?.[sessionCookie]);
}
