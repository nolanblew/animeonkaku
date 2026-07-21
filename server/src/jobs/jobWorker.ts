import type { Sleep } from "../http/types.js";
import { realSleep } from "../http/types.js";
import { JobQueue } from "./jobQueue.js";
import { JobPriority, type JobHandler, type JobRecord, type JobType } from "./types.js";

export class RetryableJobError extends Error {
  constructor(
    message: string,
    public readonly options: { incrementAttempts?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "RetryableJobError";
  }
}

export interface JobWorkerOptions {
  handlers: Partial<Record<JobType, JobHandler>>;
  now?: () => Date;
  sleep?: Sleep;
  jitterMs?: () => number;
  maintenanceFetchDelayMs?: number;
  timeoutsMs?: Partial<Record<JobType, number>>;
  /**
   * When it returns true, MAINTENANCE-priority jobs are not claimed — used to
   * pause background media hydration while clients have on-demand media
   * requests in flight, so hydration only proceeds when the server is idle.
   */
  holdMaintenanceWork?: () => boolean;
  /**
   * Fixed claim ceiling for this worker. A worker with `maxPriority:
   * JobPriority.HIGH` only ever runs urgent/high jobs, guaranteeing on-demand
   * work is never stuck behind a long-running background download on another
   * worker.
   */
  maxPriority?: number;
}

const DEFAULT_TIMEOUTS_MS: Record<JobType, number> = {
  FETCH_AUDIO: 5 * 60_000,
  FETCH_IMAGE: 2 * 60_000,
  KITSU_FULL_SYNC: 30 * 60_000,
  KITSU_DELTA_SYNC: 30 * 60_000,
  // Safety net only: the pipeline checkpoints on a ~45s wall-clock budget, so a
  // healthy invocation finishes well under this. The margin covers a single
  // unusually slow batch without tripping a timeout-and-restart-from-scratch.
  MAP_THEMES: 4 * 60_000,
  BACKFILL_SCAN: 2 * 60_000,
  AUTO_PLAYLIST_REFRESH: 2 * 60_000,
  MUSIC_CATALOG_SCAN: 2 * 60_000,
  DISCOVER_ANIME_MUSIC: 10 * 60_000,
  // Reconciliation performs one provider status request and reschedules; it
  // never waits for a download in-process.
  RECONCILE_MUSIC_ACQUISITION: 2 * 60_000,
  IMPORT_MUSIC_AUDIO: 10 * 60_000,
  SUBMIT_AMF_MUSIC_BATCH: 2 * 60_000,
  POLL_AMF_MUSIC_BATCH: 2 * 60_000,
};

export class JobWorker {
  private readonly sleep: Sleep;
  private readonly jitterMs: () => number;
  private readonly maintenanceFetchDelayMs: number;
  private readonly timeoutsMs: Record<JobType, number>;
  private running = false;
  private stopRequested = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly options: JobWorkerOptions,
  ) {
    this.sleep = options.sleep ?? realSleep;
    this.jitterMs = options.jitterMs ?? (() => Math.floor(Math.random() * 30_000));
    this.maintenanceFetchDelayMs = options.maintenanceFetchDelayMs ?? 0;
    this.timeoutsMs = { ...DEFAULT_TIMEOUTS_MS, ...options.timeoutsMs };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    void this.loop();
  }

  stop(): void {
    this.stopRequested = true;
  }

  async runOnce(): Promise<boolean> {
    const job = await this.queue.claimNext(this.claimCeiling());
    if (!job) return false;

    const handler = this.options.handlers[job.type];
    if (!handler) {
      await this.queue.failRetryable(job, new Error(`No handler registered for job type ${job.type}`), {
        incrementAttempts: true,
        jitterMs: 0,
      });
      return true;
    }

    try {
      await withTimeout(handler(job.payload, job), this.timeoutsMs[job.type], job.type);
      await this.queue.complete(job.id);
      // The politeness pause between background fetches must not delay urgent
      // (client-facing) jobs that arrived while this one ran.
      if (shouldMaintenanceDelay(job, this.maintenanceFetchDelayMs) && !(await this.queue.hasUrgentQueued())) {
        await this.sleep(this.maintenanceFetchDelayMs);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err instanceof RetryableJobError) {
        const failOptions: { incrementAttempts: boolean; retryAfterMs?: number; jitterMs: number } = {
          incrementAttempts: err.options.incrementAttempts ?? true,
          jitterMs: this.jitterMs(),
        };
        if (err.options.retryAfterMs !== undefined) {
          failOptions.retryAfterMs = err.options.retryAfterMs;
        }
        await this.queue.failRetryable(job, err, failOptions);
      } else {
        await this.queue.failRetryable(job, err, {
          incrementAttempts: true,
          jitterMs: this.jitterMs(),
        });
      }
    }
    return true;
  }

  private claimCeiling(): number | undefined {
    const hold = this.options.holdMaintenanceWork?.() ? JobPriority.NORMAL : undefined;
    const fixed = this.options.maxPriority;
    if (hold === undefined) return fixed;
    if (fixed === undefined) return hold;
    return Math.min(hold, fixed);
  }

  private async loop(): Promise<void> {
    while (!this.stopRequested) {
      const processed = await this.runOnce();
      if (!processed) {
        await this.sleep(1000);
      }
    }
    this.running = false;
  }
}

function shouldMaintenanceDelay(job: JobRecord, delayMs: number): boolean {
  return (
    delayMs > 0 &&
    job.priority >= JobPriority.MAINTENANCE &&
    (job.type === "FETCH_AUDIO" || job.type === "FETCH_IMAGE")
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, jobType: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RetryableJobError(`${jobType} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
