import crypto from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { audit, clientIp, hashPassword, requireAdmin, requireAuth, requireCsrf, sessionCookie, sessionOptions, verifyPassword } from "./auth.js";
import { backups } from "./backup-service.js";
import { searchWorkshop } from "./workshop-service.js";
import { config } from "./config.js";
import { gameConfig } from "./game-config.js";
import { game } from "./game-service.js";
import { jobs } from "./jobs.js";
import { downloadAndAddMod, getModConfiguration, installRestoredMods } from "./mod-workshop-service.js";
import { store } from "./store.js";
import { getSystemInfo } from "./system-service.js";
import { consoleSchema, credentialsSchema, gameConfigSchema, modSchema, panelPortsSchema, schedulesSchema, shardActionSchema } from "./validation.js";

export const api = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "登录尝试过于频繁，请稍后再试" }
});

api.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "0.1.0", time: new Date().toISOString() });
});

api.get("/auth/status", (_req, res) => {
  res.json({ initialized: store.hasAdmin(), setupTokenRequired: Boolean(process.env.MYDST_SETUP_TOKEN) });
});

api.post("/auth/setup", loginLimiter, async (req, res) => {
  if (store.hasAdmin()) {
    res.status(409).json({ error: "后台已经初始化" });
    return;
  }
  const body = credentialsSchema.extend({ setupToken: z.string().optional() }).parse(req.body);
  const expected = process.env.MYDST_SETUP_TOKEN;
  if (expected && (!body.setupToken || !safeEqual(body.setupToken, expected))) {
    res.status(403).json({ error: "安装验证码不正确" });
    return;
  }
  store.setAdmin(body.username, await hashPassword(body.password));
  const { token, record } = store.createSession(body.username, "admin");
  store.addAudit({ username: body.username, action: "auth.setup", detail: "初始化管理后台", ip: clientIp(req) });
  res.cookie(sessionCookie, token, sessionOptions());
  res.status(201).json({ user: { username: body.username }, role: "admin", csrfToken: record.csrfToken });
});

api.post("/auth/login", loginLimiter, async (req, res) => {
  const body = credentialsSchema.pick({ username: true }).extend({ password: z.string().min(1).max(128) }).parse(req.body);
  const account = store.getUser(body.username);
  if (!account || !(await verifyPassword(body.password, account.passwordHash))) {
    res.status(401).json({ error: "用户名或密码错误" });
    return;
  }
  const { token, record } = store.createSession(body.username, account.role);
  store.addAudit({ username: body.username, action: "auth.login", detail: "登录后台", ip: clientIp(req) });
  res.cookie(sessionCookie, token, sessionOptions());
  res.json({ user: { username: body.username }, role: account.role, csrfToken: record.csrfToken });
});

api.post("/auth/register", loginLimiter, async (req, res) => {
  if (!store.hasAdmin()) {
    res.status(409).json({ error: "请先初始化管理员账号" });
    return;
  }
  const body = credentialsSchema.parse(req.body);
  const user = store.addUser(body.username, await hashPassword(body.password));
  const { token, record } = store.createSession(user.username, "user");
  store.addAudit({ username: user.username, action: "auth.register", detail: "注册普通用户", ip: clientIp(req) });
  res.cookie(sessionCookie, token, sessionOptions());
  res.status(201).json({ user: { username: user.username }, role: "user", csrfToken: record.csrfToken });
});

api.use(requireAuth);

api.get("/auth/session", (_req, res) => {
  res.json({ user: { username: res.locals.session.username }, role: res.locals.session.role, csrfToken: res.locals.session.csrfToken });
});

api.use(requireCsrf);

api.post("/auth/logout", (req, res) => {
  audit(req, "auth.logout", "退出后台");
  store.deleteSession(req.cookies?.[sessionCookie]);
  res.clearCookie(sessionCookie, { ...sessionOptions(), maxAge: undefined });
  res.status(204).end();
});

api.put("/auth/password", requireAdmin, async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(128) }).parse(req.body);
  const admin = store.snapshot().admin;
  if (!admin || !(await verifyPassword(body.currentPassword, admin.passwordHash))) {
    res.status(400).json({ error: "当前密码不正确" });
    return;
  }
  store.updatePassword(await hashPassword(body.newPassword));
  res.clearCookie(sessionCookie, { ...sessionOptions(), maxAge: undefined });
  res.status(204).end();
});

api.get("/admin/ports", requireAdmin, (_req, res) => {
  res.json(gameConfig.getPorts());
});

api.put("/admin/ports", requireAdmin, (req, res) => {
  const ports = panelPortsSchema.parse(req.body);
  const current = gameConfig.get();
  gameConfig.save({ ...current, ...ports });
  audit(req, "admin.ports.save", JSON.stringify(ports));
  res.json(gameConfig.getPorts());
});

api.get("/dashboard", async (req, res) => {
  const roomConfig = gameConfig.get();
  const publicHost = resolvePublicHost(req);
  const [system, server, world, players] = await Promise.all([
    getSystemInfo(),
    game.status(),
    game.worldState(),
    game.players()
  ]);
  res.json({
    system,
    server,
    room: {
      name: roomConfig.clusterName,
      description: roomConfig.clusterDescription,
      gameMode: roomConfig.gameMode,
      playstyle: roomConfig.playstyle,
      cavesEnabled: roomConfig.cavesEnabled,
      maxPlayers: roomConfig.maxPlayers,
      directConnect: roomConfig.masterPort >= 1024 ? `c_connect('${publicHost}',${roomConfig.masterPort})` : ""
    },
    world,
    onlinePlayers: new Set(players.map((player) => player.userId)).size,
    snapshotCount: game.snapshotCount(),
    backups: backups.list().slice(0, 5),
    activeJob: jobs.active() || null
  });
});

function resolvePublicHost(req: Request): string {
  return normalizePublicHost(config.publicHost) || normalizePublicHost(req.hostname) || "127.0.0.1";
}

function normalizePublicHost(value: string | undefined): string | null {
  const candidate = (value || "").trim().replace(/^\[|\]$/g, "");
  if (!candidate || candidate.length > 253) return null;
  if (isIP(candidate)) return candidate;
  if (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(candidate)) return null;
  return candidate;
}

api.get("/server/status", async (_req, res) => {
  res.json(await game.status());
});

api.post("/server/action", async (req, res) => {
  const body = shardActionSchema.parse(req.body);
  await game.action(body.action, body.shard);
  audit(req, `server.${body.action}`, body.shard);
  res.json(await game.status());
});

api.post("/server/console", async (req, res) => {
  const body = consoleSchema.parse(req.body);
  await game.console(body.shard, body.command);
  audit(req, "server.console", `${body.shard}: ${body.command}`);
  res.status(204).end();
});

api.post("/server/save", async (req, res) => {
  await game.save();
  audit(req, "server.save", "manual snapshot");
  res.status(204).end();
});

api.post("/server/rollback", async (req, res) => {
  const snapshots = z.object({ snapshots: z.number().int().min(1).max(5) }).parse(req.body).snapshots;
  await game.rollback(snapshots);
  audit(req, "server.rollback", `${snapshots} snapshot(s)`);
  res.status(202).json({ snapshots });
});

api.post("/server/reset-world", async (req, res) => {
  const status = await game.status();
  if (!status.master.running || !status.caves.running) throw new Error("重置世界前必须同时启动地面和洞穴");
  const job = jobs.run("world-reset", async (log) => {
    log("正在保存当前世界...");
    await game.save();
    log("正在生成重置前备份...");
    const backup = await backups.create("before-world-reset", log);
    log(`备份已保存：${backup.name}`);
    log("正在向游戏发送 c_regenerateworld()...");
    await game.regenerateWorld();
    log("世界重置命令已发送，地面与洞穴正在重新生成");
  });
  audit(req, "server.reset-world", "c_regenerateworld() with automatic backup");
  res.status(202).json(job);
});

api.post("/server/delete-save", (req, res) => {
  const job = jobs.run("save-delete", async (log) => {
    const status = await game.status();
    if (status.master.running || status.caves.running) {
      log("正在安全停止地面和洞穴...");
      await game.action("stop", "all");
    }
    log("正在生成删除前备份...");
    const backup = await backups.create("before-save-delete", log);
    log(`备份已保存：${backup.name}`);
    await game.deleteSaveData(log);
    gameConfig.resetWorldCreationState();
    log("当前存档已删除，洞穴生成选项已解锁");
  });
  audit(req, "server.delete-save", "stop, backup and delete Master/Caves saves");
  res.status(202).json(job);
});

api.post("/server/announce", async (req, res) => {
  const message = z.object({ message: z.string().trim().min(1).max(200).refine((value) => !/[\r\n\0]/.test(value)) }).parse(req.body).message;
  await game.announce(message);
  audit(req, "server.announce", message);
  res.status(204).end();
});

api.get("/chat", async (req, res) => {
  const shard = z.enum(["master", "caves", "all"]).default("all").parse(req.query.shard);
  const limit = z.coerce.number().int().min(10).max(300).default(80).parse(req.query.limit);
  res.json(await game.chat(shard, limit));
});

api.post("/server/update", (req, res) => {
  const restartAfter = z.object({ restartAfter: z.boolean().default(true) }).parse(req.body).restartAfter;
  const job = jobs.run("game-update", (log) => game.update(log, restartAfter));
  audit(req, "server.update", `restartAfter=${restartAfter}`);
  res.status(202).json(job);
});

api.get("/config", (_req, res) => {
  res.json(gameConfig.get());
});

api.put("/config", (req, res) => {
  const value = gameConfigSchema.parse(req.body);
  const currentPorts = gameConfig.getPorts();
  gameConfig.save({ ...value, ...currentPorts });
  audit(req, "config.save", value.clusterName);
  res.json(gameConfig.get());
});

api.get("/world/:shard", (req, res) => {
  const shard = z.enum(["master", "caves"]).parse(req.params.shard);
  res.type("text/plain").send(gameConfig.getWorld(shard));
});

api.put("/world/:shard", (req, res) => {
  const shard = z.enum(["master", "caves"]).parse(req.params.shard);
  const content = z.object({ content: z.string().min(10).max(200_000) }).parse(req.body).content;
  gameConfig.saveWorld(shard, content);
  audit(req, "world.save", shard);
  res.status(204).end();
});

api.get("/world/:shard/visual", (req, res) => {
  const shard = z.enum(["master", "caves"]).parse(req.params.shard);
  res.json(gameConfig.getWorldVisual(shard));
});

api.put("/world/:shard/visual", (req, res) => {
  const shard = z.enum(["master", "caves"]).parse(req.params.shard);
  const overrides = z.record(z.string(), z.union([z.string().max(100), z.number().finite(), z.boolean()])).parse(req.body.overrides);
  gameConfig.saveWorldVisual(shard, overrides);
  audit(req, "world.visual.save", `${shard}: ${Object.keys(overrides).length} overrides`);
  res.json(gameConfig.getWorldVisual(shard));
});

api.get("/mods", (_req, res) => {
  res.json(gameConfig.getMods());
});

api.get("/mods/workshop/search", async (req, res) => {
  const query = z.string().trim().min(2).max(80).parse(req.query.q);
  res.json(await searchWorkshop(query));
});

api.post("/mods/workshop/:id/download", (req, res) => {
  const id = z.string().regex(/^\d{5,12}$/).parse(req.params.id);
  const title = z.object({ title: z.string().trim().min(1).max(160) }).parse(req.body).title;
  if (gameConfig.getMods().some((mod) => mod.id === id)) throw new Error("这个 MOD 已在服务器列表中");
  const job = jobs.run(`mod-download:${id}`, (log) => downloadAndAddMod(id, title, log));
  audit(req, "mods.download", `${id}: ${title}`);
  res.status(202).json(job);
});

api.get("/mods/:id/configuration", (req, res) => {
  const id = z.string().regex(/^\d{5,12}$/).parse(req.params.id);
  res.json(getModConfiguration(id));
});

api.put("/mods", (req, res) => {
  const mods = z.array(modSchema).max(200).parse(req.body);
  if (new Set(mods.map((mod) => mod.id)).size !== mods.length) throw new Error("MOD ID 不能重复");
  gameConfig.saveMods(mods);
  audit(req, "mods.save", `${mods.length} mods`);
  res.json(mods);
});

api.get("/logs/:shard", async (req, res) => {
  const shard = z.enum(["master", "caves"]).parse(req.params.shard);
  const lines = z.coerce.number().int().min(20).max(2000).default(300).parse(req.query.lines);
  res.json({ lines: await game.logs(shard, lines) });
});

api.get("/players", async (_req, res) => {
  const players = await game.players();
  const admins = game.getAccessList("admin");
  const blocked = game.getAccessList("block");
  const whitelist = game.getAccessList("white");
  res.json(players.map((player) => ({
    ...player,
    admin: admins.includes(player.userId),
    blocked: blocked.includes(player.userId),
    whitelisted: whitelist.includes(player.userId)
  })));
});

api.post("/players/:userId/kick", async (req, res) => {
  const userId = z.string().regex(/^KU_[A-Za-z0-9_-]+$/).parse(req.params.userId);
  await game.kick(userId);
  audit(req, "player.kick", userId);
  res.status(204).end();
});

api.post("/players/:userId/access", async (req, res) => {
  const userId = z.string().regex(/^KU_[A-Za-z0-9_-]+$/).parse(req.params.userId);
  const body = z.object({ type: z.enum(["admin", "block", "white"]), enabled: z.boolean() }).parse(req.body);
  const values = new Set(game.getAccessList(body.type));
  if (body.enabled) values.add(userId); else values.delete(userId);
  game.saveAccessList(body.type, [...values]);
  if (body.type === "block" && body.enabled) {
    try { await game.kick(userId); } catch { /* The player may have already left. */ }
  }
  audit(req, `player.${body.type}.${body.enabled ? "add" : "remove"}`, userId);
  res.json({ userId, type: body.type, enabled: body.enabled });
});

api.get("/access/:type", (req, res) => {
  const type = z.enum(["admin", "block", "white"]).parse(req.params.type);
  res.json(game.getAccessList(type));
});

api.put("/access/:type", (req, res) => {
  const type = z.enum(["admin", "block", "white"]).parse(req.params.type);
  const values = z.array(z.string()).max(500).parse(req.body);
  game.saveAccessList(type, values);
  audit(req, "access.save", `${type}: ${values.length}`);
  res.json(game.getAccessList(type));
});

api.get("/backups", (_req, res) => {
  res.json(backups.list());
});

api.post("/backups", (req, res) => {
  const label = z.object({ label: z.string().max(40).optional() }).parse(req.body).label;
  const job = jobs.run("backup-create", async (log) => {
    try {
      await game.console("master", "c_save()");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      log("地面未运行，备份磁盘上的现有存档");
    }
    await backups.create(label, log);
    backups.prune(store.snapshot().schedules.retentionCount);
  });
  audit(req, "backup.create", label || "manual");
  res.status(202).json(job);
});

api.post("/backups/:name/restore", async (req, res) => {
  const name = z.string().parse(req.params.name);
  backups.resolve(name);
  const before = await game.status();
  const panelConfig = gameConfig.get();
  const panelPorts = {
    masterPort: panelConfig.masterPort,
    cavesPort: panelConfig.cavesPort,
    steamMasterPort: panelConfig.steamMasterPort,
    steamCavesPort: panelConfig.steamCavesPort
  };
  const job = jobs.run("backup-restore", async (log) => {
    await game.action("stop", "all");
    await backups.create("before-restore", log);
    await backups.restore(name, log);
    if (gameConfig.syncCavesFromRestoredSave()) log("检测到洞穴存档，已自动开启并锁定洞穴世界");
    gameConfig.restorePanelPorts(panelPorts, panelConfig.clusterToken.length >= 10 ? panelConfig.clusterToken : undefined);
    log("已用面板端口覆盖恢复存档中的 Master/Caves 端口");
    const restoredMods = gameConfig.importRestoredMods();
    if (restoredMods.length) {
      log(`从存档中识别到 ${restoredMods.length} 个 MOD，正在检查并下载启用项`);
      await installRestoredMods(restoredMods, log);
      log("存档 MOD 已同步到服务器 MOD 列表和游戏目录");
    } else {
      log("存档中没有启用的 Workshop MOD，服务器 MOD 列表已同步为空");
    }
    if (before.master.running) await game.start("master");
    if (before.caves.running && gameConfig.get().cavesEnabled) await game.start("caves");
  });
  audit(req, "backup.restore", name);
  res.status(202).json(job);
});

api.delete("/backups/:name", (req, res) => {
  const name = z.string().parse(req.params.name);
  backups.delete(name);
  audit(req, "backup.delete", name);
  res.status(204).end();
});

api.get("/backups/:name/download", (req, res) => {
  const file = backups.resolve(z.string().parse(req.params.name));
  res.download(file);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.backupRoot),
    filename: (_req, file, callback) => {
      const base = path.basename(file.originalname).replace(/[^a-zA-Z0-9_.-]/g, "-");
      callback(null, `${Date.now()}_${base}`);
    }
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase();
    callback(null, name.endsWith(".tar.gz") || name.endsWith(".zip"));
  }
});

api.post("/backups/upload", upload.single("file"), async (req, res) => {
  if (!req.file) throw new Error("请选择 .tar.gz 或 .zip 存档文件");
  try {
    await backups.validate(req.file.path);
    audit(req, "backup.upload", `${req.file.filename} (validated)`);
    res.status(201).json({ name: req.file.filename, size: req.file.size, createdAt: new Date().toISOString() });
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    throw error;
  }
});

api.get("/jobs", (_req, res) => {
  res.json(jobs.list());
});

api.get("/schedules", (_req, res) => {
  res.json(store.snapshot().schedules);
});

api.put("/schedules", (req, res) => {
  const schedules = schedulesSchema.parse(req.body);
  store.setSchedules(schedules);
  backups.prune(schedules.retentionCount);
  audit(req, "schedules.save", JSON.stringify(schedules));
  res.json(schedules);
});

api.get("/audit", (_req, res) => {
  res.json(store.snapshot().audit.slice(0, 200));
});

function safeEqual(left: string, right: string): boolean {
  const a = crypto.createHash("sha256").update(left).digest();
  const b = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(a, b);
}
