import { JobPriority } from "../jobs/types.js";
import type { JobQueue } from "../jobs/jobQueue.js";

export interface SyncSchedulerRepo {
  listActiveUserIds(): Promise<string[]>;
}

export interface SyncSchedulerPipeline {
  scanOrphanFiles(mediaRoot: string): Promise<string[]>;
  requeueFailedMedia(): Promise<number>;
}

export interface SyncSchedulerOptions {
  queue: JobQueue;
  repo: SyncSchedulerRepo;
  pipeline: SyncSchedulerPipeline;
  mediaRoot: string;
  syncIntervalMinutes?: number;
}

export class SyncScheduler {
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly options: SyncSchedulerOptions) {}

  start(): void {
    if (this.timers.length > 0) return;
    const syncMs = (this.options.syncIntervalMinutes ?? 360) * 60_000;
    this.timers.push(setInterval(() => void this.enqueueDeltaSyncs(), syncMs));
    this.timers.push(setInterval(() => void this.runDailyMaintenance(), 24 * 60 * 60_000));
    this.timers.push(setInterval(() => void this.runWeeklyMaintenance(), 7 * 24 * 60 * 60_000));
    for (const timer of this.timers) timer.unref?.();
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async enqueueDeltaSyncs(): Promise<void> {
    for (const userId of await this.options.repo.listActiveUserIds()) {
      await this.options.queue.enqueue({
        type: "KITSU_DELTA_SYNC",
        priority: JobPriority.NORMAL,
        payload: { userId },
        dedupeKey: `KITSU_DELTA_SYNC:${userId}`,
      });
    }
  }

  async runDailyMaintenance(): Promise<void> {
    for (const userId of await this.options.repo.listActiveUserIds()) {
      await this.options.queue.enqueue({
        type: "AUTO_PLAYLIST_REFRESH",
        priority: JobPriority.NORMAL,
        payload: { userId },
        dedupeKey: `AUTO_PLAYLIST_REFRESH:${userId}`,
      });
    }
    await this.options.pipeline.scanOrphanFiles(this.options.mediaRoot);
  }

  async runWeeklyMaintenance(): Promise<void> {
    await this.options.pipeline.requeueFailedMedia();
  }
}
