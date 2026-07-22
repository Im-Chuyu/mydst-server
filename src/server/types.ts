export type Shard = "master" | "caves";
export type ServerAction = "start" | "stop" | "restart";
export type UserRole = "admin" | "user";

export interface PanelPorts {
  masterPort: number;
  cavesPort: number;
  steamMasterPort: number;
  steamCavesPort: number;
}

export interface AdminRecord {
  username: string;
  passwordHash: string;
  createdAt: string;
  role?: "admin";
}

export interface UserRecord {
  username: string;
  passwordHash: string;
  createdAt: string;
  role: "user";
}

export interface SessionRecord {
  tokenHash: string;
  csrfToken: string;
  username: string;
  role: UserRole;
  expiresAt: string;
}

export interface ScheduleSettings {
  backupEnabled: boolean;
  backupTime: string;
  updateEnabled: boolean;
  updateTime: string;
  restartAfterUpdate: boolean;
  retentionCount: number;
}

export interface AuditRecord {
  id: string;
  at: string;
  username: string;
  action: string;
  detail: string;
  ip: string;
}

export interface PanelState {
  admin?: AdminRecord;
  users: UserRecord[];
  sessions: SessionRecord[];
  schedules: ScheduleSettings;
  audit: AuditRecord[];
}

export interface GameConfig {
  clusterName: string;
  clusterDescription: string;
  clusterPassword: string;
  clusterToken: string;
  gameMode: string;
  playstyle: "relaxed" | "endless" | "survival" | "wilderness" | "lightsout";
  clusterLanguage: string;
  intention: "social" | "cooperative" | "competitive" | "madness";
  offlineCluster: boolean;
  lanOnlyCluster: boolean;
  autosaverEnabled: boolean;
  cavesEnabled: boolean;
  cavesEnabledLocked?: boolean;
  whitelistSlots: number;
  steamGroupOnly: boolean;
  steamGroupId: string;
  steamGroupAdmins: boolean;
  maxPlayers: number;
  pvp: boolean;
  pauseWhenEmpty: boolean;
  voteKick: boolean;
  consoleEnabled: boolean;
  maxSnapshots: number;
  masterPort: number;
  cavesPort: number;
  steamMasterPort: number;
  steamCavesPort: number;
}

export interface ModRecord {
  id: string;
  name: string;
  enabled: boolean;
  configuration: string;
}

export interface JobRecord {
  id: string;
  type: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  error?: string;
}

export interface WorldState {
  day: number;
  season: string;
  seasonRemainingDays: number | null;
  phase: string;
  moonPhase: string;
  temperature: number | null;
}

export interface ChatMessage {
  id: string;
  shard: Shard;
  time: string;
  channel: string;
  userId: string;
  player: string;
  message: string;
}
