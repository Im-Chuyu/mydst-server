import { backups } from "./backup-service.js";
import { game } from "./game-service.js";
import { jobs } from "./jobs.js";
import { store } from "./store.js";

const lastRun = new Map<string, string>();

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    const now = new Date();
    const date = localDate(now);
    const time = now.toTimeString().slice(0, 5);
    const schedules = store.snapshot().schedules;
    if (schedules.backupEnabled && time === schedules.backupTime) {
      runOnce(`backup:${date}`, () => {
        jobs.run("scheduled-backup", async (log) => {
          try {
            await game.console("master", "c_save()");
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } catch {
            log("地面未运行，直接备份现有存档");
          }
          await backups.create("scheduled", log);
          backups.prune(schedules.retentionCount);
        });
      });
    }
    if (schedules.updateEnabled && time === schedules.updateTime) {
      runOnce(`update:${date}`, () => {
        jobs.run("scheduled-update", (log) => game.update(log, schedules.restartAfterUpdate));
      });
    }
  }, 30_000);
}

function runOnce(key: string, task: () => void): void {
  if (lastRun.get(key) === key) return;
  if (jobs.active()) return;
  lastRun.set(key, key);
  task();
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
