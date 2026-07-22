import crypto from "node:crypto";
import type { JobRecord } from "./types.js";

export class JobManager {
  private jobs = new Map<string, JobRecord>();

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30);
  }

  active(): JobRecord | undefined {
    return this.list().find((job) => job.status === "running");
  }

  run(type: string, task: (log: (line: string) => void) => Promise<void>): JobRecord {
    const active = this.active();
    if (active) throw new Error(`已有任务正在执行：${active.type}`);
    const job: JobRecord = {
      id: crypto.randomUUID(),
      type,
      status: "running",
      startedAt: new Date().toISOString(),
      logs: []
    };
    this.jobs.set(job.id, job);
    const log = (line: string) => {
      job.logs.push(line.slice(0, 1000));
      job.logs = job.logs.slice(-500);
    };
    void task(log).then(() => {
      job.status = "success";
      job.finishedAt = new Date().toISOString();
    }).catch((error: unknown) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.logs.push(job.error);
      job.finishedAt = new Date().toISOString();
    });
    return job;
  }
}

export const jobs = new JobManager();
