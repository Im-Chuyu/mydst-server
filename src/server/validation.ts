import { z } from "zod";

export const credentialsSchema = z.object({
  username: z.string().trim().min(3, "用户名至少 3 位").max(32).regex(/^[a-zA-Z0-9_-]+$/, "用户名只能包含字母、数字、下划线和短横线"),
  password: z.string().min(10, "密码至少 10 位").max(128)
});

export const gameConfigSchema = z.object({
  clusterName: z.string().trim().min(1).max(80),
  clusterDescription: z.string().trim().max(200),
  clusterPassword: z.string().max(64),
  clusterToken: z.string().trim().max(512).refine((value) => value.length === 0 || value.length >= 10, "Cluster Token 至少 10 位，或留空"),
  gameMode: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "游戏模式格式无效"),
  playstyle: z.enum(["relaxed", "endless", "survival", "wilderness", "lightsout"]),
  clusterLanguage: z.enum(["zh", "zht", "en", "fr", "de", "es", "it", "pt", "pl", "ru", "ko"]),
  intention: z.enum(["social", "cooperative", "competitive", "madness"]),
  offlineCluster: z.boolean(),
  lanOnlyCluster: z.boolean(),
  autosaverEnabled: z.boolean(),
  cavesEnabled: z.boolean(),
  whitelistSlots: z.number().int().min(0).max(64),
  steamGroupOnly: z.boolean(),
  steamGroupId: z.string().trim().max(20).regex(/^\d*$/, "Steam 群组 ID 只能包含数字"),
  steamGroupAdmins: z.boolean(),
  maxPlayers: z.number().int().min(1).max(64),
  pvp: z.boolean(),
  pauseWhenEmpty: z.boolean(),
  voteKick: z.boolean(),
  consoleEnabled: z.boolean(),
  maxSnapshots: z.number().int().min(1).max(20),
  masterPort: z.number().int().min(0).max(65535),
  cavesPort: z.number().int().min(0).max(65535),
  steamMasterPort: z.number().int().min(1024).max(65535),
  steamCavesPort: z.number().int().min(1024).max(65535)
}).superRefine((value, ctx) => {
  const ports = [value.masterPort, value.cavesPort, value.steamMasterPort, value.steamCavesPort].filter((port) => port > 0);
  if (new Set(ports).size !== ports.length) {
    ctx.addIssue({ code: "custom", message: "游戏端口不能重复", path: ["masterPort"] });
  }
});

export const panelPortsSchema = z.object({
  masterPort: z.number().int().min(0).max(65535),
  cavesPort: z.number().int().min(0).max(65535),
  steamMasterPort: z.number().int().min(1024).max(65535),
  steamCavesPort: z.number().int().min(1024).max(65535)
}).superRefine((value, ctx) => {
  const ports = Object.values(value).filter((port) => port > 0);
  if (new Set(ports).size !== ports.length) ctx.addIssue({ code: "custom", message: "游戏端口不能重复", path: ["masterPort"] });
});

export const modSchema = z.object({
  id: z.string().regex(/^\d{5,12}$/, "请输入有效的 Steam Workshop ID"),
  name: z.string().trim().max(160),
  previewUrl: z.string().trim().url("MOD 封面地址格式无效").max(1000).refine((value) => /^https:\/\//i.test(value), "MOD 封面必须使用 HTTPS 地址").or(z.literal("")).optional(),
  enabled: z.boolean(),
  configuration: z.string().trim().max(20_000).default("{}")
});

export const schedulesSchema = z.object({
  backupEnabled: z.boolean(),
  backupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  updateEnabled: z.boolean(),
  updateTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  restartAfterUpdate: z.boolean(),
  retentionCount: z.number().int().min(1).max(100)
});

export const consoleSchema = z.object({
  shard: z.enum(["master", "caves"]),
  command: z.string().trim().min(1).max(1000).refine((value) => !/[\r\n\0]/.test(value), "命令不能包含换行或控制字符")
});

export const shardActionSchema = z.object({
  shard: z.enum(["master", "caves", "all"]),
  action: z.enum(["start", "stop", "restart"])
});
