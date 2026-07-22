import os from "node:os";
import si from "systeminformation";
import { config } from "./config.js";

export async function getSystemInfo() {
  const [load, memory, disks] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize()
  ]);
  const disk = disks.find((item) => config.root.startsWith(item.mount)) || disks[0];
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptimeSeconds: os.uptime(),
    cpu: {
      model: os.cpus()[0]?.model || "Unknown CPU",
      cores: os.cpus().length,
      usage: Number(load.currentLoad.toFixed(1))
    },
    memory: {
      total: memory.total,
      used: memory.active,
      usage: Number(((memory.active / memory.total) * 100).toFixed(1))
    },
    disk: disk ? {
      total: disk.size,
      used: disk.used,
      usage: Number(disk.use.toFixed(1))
    } : null
  };
}
