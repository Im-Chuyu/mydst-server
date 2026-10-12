import type { AnnouncementRuntime, AnnouncementSettings } from "./types.js";

interface AnnouncementDependencies {
  snapshot: () => { announcements: AnnouncementSettings; announcementRuntime: AnnouncementRuntime };
  saveRuntime: (runtime: AnnouncementRuntime) => void;
  isRunning: () => Promise<boolean>;
  players: () => Promise<unknown[]>;
  announce: (message: string) => Promise<void>;
  isBusy: () => boolean;
  reportError: (error: unknown) => void;
}

const shanghaiClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export function announcementSlot(now: number): string {
  return shanghaiClock.format(new Date(now));
}

export class AnnouncementService {
  private sending = false;
  private retryAfter = 0;

  constructor(private readonly dependencies: AnnouncementDependencies) {}

  async tick(now = Date.now()): Promise<void> {
    if (this.sending || now < this.retryAfter) return;
    const { announcements: settings, announcementRuntime: runtime } = this.dependencies.snapshot();
    if (!settings.enabled || !settings.messages.length || this.dependencies.isBusy()) return;
    const slot = announcementSlot(now);
    if (settings.mode === "daily") {
      if (!settings.times.includes(slot.slice(-5)) || (runtime.lastScheduledSlot && slot <= runtime.lastScheduledSlot)) return;
    } else if (now - runtime.lastSentAt < settings.intervalMinutes * 60_000) return;

    this.sending = true;
    try {
      if (!(await this.dependencies.isRunning())) return;
      if (settings.onlyWhenPlayersOnline && !(await this.dependencies.players()).length) return;
      // Settings can change while querying both shards. Discard the stale send.
      if (this.dependencies.snapshot().announcementRuntime.revision !== runtime.revision || this.dependencies.isBusy()) return;
      const index = runtime.nextMessageIndex % settings.messages.length;
      await this.dependencies.announce(settings.messages[index]!);
      this.dependencies.saveRuntime({
        ...runtime,
        lastSentAt: now,
        nextMessageIndex: (index + 1) % settings.messages.length,
        lastScheduledSlot: settings.mode === "daily" ? slot : runtime.lastScheduledSlot
      });
      this.retryAfter = 0;
    } catch (error) {
      this.retryAfter = now + 30_000;
      this.dependencies.reportError(error);
    } finally {
      this.sending = false;
    }
  }
}
