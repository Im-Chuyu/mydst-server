export type PageKey = "dashboard" | "config" | "world" | "mods" | "backups" | "console" | "players" | "settings";
export type Shard = "master" | "caves";

export interface PanelPorts {
  masterPort: number;
  cavesPort: number;
  steamMasterPort: number;
  steamCavesPort: number;
}

export interface Session {
  user: { username: string };
  role: "admin" | "user";
  csrfToken: string;
}

export interface ServerStatus {
  installed: boolean;
  configured: boolean;
  master: { running: boolean; session: string };
  caves: { running: boolean; session: string };
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  uptimeSeconds: number;
  cpu: { model: string; cores: number; usage: number };
  memory: { total: number; used: number; usage: number };
  disk: { total: number; used: number; usage: number } | null;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
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

export interface DashboardData {
  system: SystemInfo;
  server: ServerStatus;
  room: {
    name: string;
    description: string;
    gameMode: string;
    playstyle: GameConfig["playstyle"];
    cavesEnabled: boolean;
    maxPlayers: number;
    directConnect: string;
  };
  world: WorldState | null;
  onlinePlayers: number;
  snapshotCount: number;
  backups: BackupInfo[];
  activeJob: JobRecord | null;
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

export type WorldOverrideValue = string | number | boolean;
export interface WorldChoice { value: string; label: string }
export interface WorldSettingDefinition {
  key: string;
  label: string;
  category: "worldgen" | "settings";
  group: string;
  groupLabel: string;
  worlds: Shard[];
  defaultValue: string;
  choices: WorldChoice[];
  icon?: { atlas: "worldgen" | "worldsettings"; x: number; y: number };
}
export interface WorldVisualConfig {
  shard: Shard;
  preset: string;
  overrides: Record<string, WorldOverrideValue>;
  definitions: WorldSettingDefinition[];
  catalogVersion: string;
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
  previewUrl?: string;
  enabled: boolean;
  configuration: string;
}

export interface WorkshopItem {
  id: string;
  title: string;
  previewUrl: string;
  author?: string;
}

export type ModConfigValue = string | number | boolean;
export interface ModConfigChoice { description: string; data: ModConfigValue }
export interface ModConfigOption {
  name: string;
  label: string;
  hover: string;
  defaultValue: ModConfigValue;
  choices: ModConfigChoice[];
}
export interface ModConfigurationInfo {
  installed: boolean;
  options: ModConfigOption[];
  values: Record<string, ModConfigValue>;
  warning?: string;
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
