import { JobPriority } from "../jobs/types.js";
import type { JobQueue } from "../jobs/jobQueue.js";
import { kitsuSyncDedupeKey } from "./syncJobKeys.js";

export const INACTIVE_REAUTH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Incremental updatedAt reads omit removed library entries. Periodic
 * reconciliation needs to run often enough to make
 * additions, status edits, and removals visible without relying on a device
 * opening the app.  Full reconciliations are cheap for the small server this
 * project targets, and the pipeline avoids repeating catalog mapping work
 * for already-mapped anime.
 */
export const DEFAULT_SYNC_INTERVAL_MINUTES = 10;

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
  /** Reports contained timer failures without allowing an unhandled rejection. */
  onError?: (error: Error, task: string) => void;
  terminalJobRetentionDays?: number;
}

export class SyncScheduler {
  private timers: NodeJS.Timeout[] = [];
  private readonly runningTasks = new Set<string>();
  private readonly now: () => Date;

  constructor(private readonly options: SyncSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timers.length > 0) return;
    const syncMs = (this.options.syncIntervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES) * 60_000;
    // A setInterval-only scheduler waits for a full interval after every
    // process restart.  Reconcile once immediately so a restart cannot leave
    // a library stale for another ten minutes (or longer if the old cadence
    // was configured).
    void this.runScheduled("periodic sync", () => this.enqueuePeriodicSyncs());
    this.timers.push(setInterval(() => void this.runScheduled("periodic sync", () => this.enqueuePeriodicSyncs()), syncMs));
    this.timers.push(setInterval(() => void this.runScheduled("daily maintenance", () => this.runDailyMaintenance()), 24 * 60 * 60_000));
    this.timers.push(setInterval(() => void this.runScheduled("weekly maintenance", () => this.runWeeklyMaintenance()), 7 * 24 * 60 * 60_000));
    for (const timer of this.timers) timer.unref?.();
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async enqueuePeriodicSyncs(): Promise<void> {
    await this.enqueueUserSyncs(true);
  }

  /** Weekly catalog refresh retains the original full-sync behavior. */
  async enqueueFullSyncs(): Promise<void> {
    await this.enqueueUserSyncs(false);
  }

  private async enqueueUserSyncs(reconcileOnly: boolean): Promise<void> {
    const activeAfter = this.activeAfterCutoff();
    await this.options.repo.deactivateInactiveUsers?.(activeAfter);
    for (const userId of await this.options.repo.listActiveUserIds(activeAfter)) {
      await this.options.queue.enqueue({
        type: "KITSU_FULL_SYNC",
        priority: JobPriority.NORMAL,
        payload: reconcileOnly ? { userId, reconcileOnly: true } : { userId },
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
    await this.enqueueFullSyncs();
    await this.options.pipeline.requeueFailedMedia();
    const retentionDays = this.options.terminalJobRetentionDays ?? 30;
    await this.options.queue.pruneTerminalJobs(
      new Date(this.now().getTime() - retentionDays * 24 * 60 * 60_000),
    );
  }

  private async runScheduled(task: string, run: () => Promise<void>): Promise<void> {
    if (this.runningTasks.has(task)) return;
    this.runningTasks.add(task);
    try {
      await run();
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)), task);
    } finally {
      this.runningTasks.delete(task);
    }
  }

  private activeAfterCutoff(): Date {
    return new Date(this.now().getTime() - INACTIVE_REAUTH_AFTER_MS);
  }
}
