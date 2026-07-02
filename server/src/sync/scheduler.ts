import { JobPriority } from "../jobs/types.js";
import type { JobQueue } from "../jobs/jobQueue.js";
import { kitsuSyncDedupeKey } from "./syncJobKeys.js";

export const INACTIVE_REAUTH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface SyncSchedulerRepo {
  listActiveUserIds(activeAfter?: Date): Promise<string[]>;
  deactivateInactiveUsers?(activeAfter: Date): Promise<string[]>;
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
  now?: () => Date;
}

export class SyncScheduler {
  private timers: NodeJS.Timeout[] = [];
  private readonly now: () => Date;

  constructor(private readonly options: SyncSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timers.length > 0) return;
    const syncMs = (this.options.syncIntervalMinutes ?? 10080) * 60_000;
    this.timers.push(setInterval(() => void this.enqueuePeriodicSyncs(), syncMs));
    this.timers.push(setInterval(() => void this.runDailyMaintenance(), 24 * 60 * 60_000));
    this.timers.push(setInterval(() => void this.runWeeklyMaintenance(), 7 * 24 * 60 * 60_000));
    for (const timer of this.timers) timer.unref?.();
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async enqueuePeriodicSyncs(): Promise<void> {
    const activeAfter = this.activeAfterCutoff();
    await this.options.repo.deactivateInactiveUsers?.(activeAfter);
    for (const userId of await this.options.repo.listActiveUserIds(activeAfter)) {
      await this.options.queue.enqueue({
        type: "KITSU_FULL_SYNC",
        priority: JobPriority.NORMAL,
        payload: { userId },
        dedupeKey: kitsuSyncDedupeKey(userId),
      });
    }
  }

  async enqueueDeltaSyncs(): Promise<void> {
    await this.enqueuePeriodicSyncs();
  }

  async runDailyMaintenance(): Promise<void> {
    for (const userId of await this.options.repo.listActiveUserIds(this.activeAfterCutoff())) {
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

  private activeAfterCutoff(): Date {
    return new Date(this.now().getTime() - INACTIVE_REAUTH_AFTER_MS);
  }
}
