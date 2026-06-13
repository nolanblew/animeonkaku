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
}

const DEFAULT_TIMEOUTS_MS: Record<JobType, number> = {
  FETCH_AUDIO: 5 * 60_000,
  FETCH_IMAGE: 2 * 60_000,
  KITSU_FULL_SYNC: 30 * 60_000,
  KITSU_DELTA_SYNC: 30 * 60_000,
  MAP_THEMES: 2 * 60_000,
  BACKFILL_SCAN: 2 * 60_000,
  AUTO_PLAYLIST_REFRESH: 2 * 60_000,
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
    const job = await this.queue.claimNext();
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
      if (shouldMaintenanceDelay(job, this.maintenanceFetchDelayMs)) {
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
