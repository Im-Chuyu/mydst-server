import path from "node:path";

const root = path.resolve(process.env.MYDST_ROOT || path.join(process.cwd(), ".runtime"));

function port(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : fallback;
}

export const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  publicHost: process.env.PUBLIC_HOST?.trim() || "",
  root,
  panelRoot: process.cwd(),
  gameRoot: path.join(root, "game"),
  gameBinary: path.join(root, "game", "bin", "dontstarve_dedicated_server_nullrenderer"),
  steamcmd: path.join(root, "steamcmd", "steamcmd.sh"),
  dataRoot: path.join(root, "data"),
  clusterRoot: path.join(root, "data", "DoNotStarveTogether", "Cluster_1"),
  backupRoot: path.join(root, "backups"),
  stateFile: path.join(root, "panel-state.json"),
  demo: process.env.MYDST_DEMO === "true" || process.platform === "win32",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  trustProxy: process.env.TRUST_PROXY === "true",
  initialPorts: {
    masterPort: port("MYDST_MASTER_PORT", 8489),
    cavesPort: port("MYDST_CAVES_PORT", 8114),
    steamMasterPort: port("MYDST_STEAM_MASTER_PORT", 12346),
    steamCavesPort: port("MYDST_STEAM_CAVES_PORT", 12347)
  },
  sessionDays: 7,
  maxUploadBytes: 2 * 1024 * 1024 * 1024,
  sessions: {
    master: "mydst-master",
    caves: "mydst-caves"
  }
} as const;
