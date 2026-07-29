import type {
  EnqueueJobInput,
  JobRecord,
  JobRepository,
  JobState,
  JobType,
} from "./types.js";
import { JobPriority } from "./types.js";

export interface JobQueueOptions {
  now?: () => Date;
}

export interface EnqueueInput {
  type: JobType;
  priority: number;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  maxAttempts?: number;
  nextRunAt?: Date;
}

export class JobQueue {
  private readonly now: () => Date;

  constructor(
    private readonly repo: JobRepository,
    options: JobQueueOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async enqueue(input: EnqueueInput): Promise<JobRecord> {
    const repoInput: EnqueueJobInput = {
      type: input.type,
      priority: input.priority,
      payload: input.payload ?? {},
      dedupeKey: input.dedupeKey ?? null,
      maxAttempts: input.maxAttempts ?? 5,
      nextRunAt: input.nextRunAt ?? this.now(),
    };
    return this.repo.enqueue(repoInput);
  }

  async claimNext(maxPriority?: number): Promise<JobRecord | null> {
    return this.repo.claimNext(this.now(), maxPriority);
  }

  async complete(id: number): Promise<void> {
    await this.repo.complete(id);
  }

  async failRetryable(
    job: JobRecord,
    error: Error,
    options: { incrementAttempts: boolean; retryAfterMs?: number; jitterMs?: number; recordError?: boolean } = {
      incrementAttempts: true,
    },
  ): Promise<JobRecord | null> {
    const attempts = job.attempts + (options.incrementAttempts ? 1 : 0);
    const failed = attempts >= job.maxAttempts;
    const retryDelayMs = options.retryAfterMs ?? backoffMs(attempts, options.jitterMs ?? 0);
    return this.repo.fail(job.id, {
      state: failed ? "FAILED" : "QUEUED",
      nextRunAt: failed ? this.now() : new Date(this.now().getTime() + retryDelayMs),
      lastError: options.recordError === false ? null : error.message,
      incrementAttempts: options.incrementAttempts,
    });
  }

  async recoverRunningJobs(): Promise<number> {
    return this.repo.recoverRunning();
  }

  async list(status?: JobState, limit = 250): Promise<JobRecord[]> {
    return this.repo.list(status, limit);
  }

  async listForUser(userId: string, types: readonly JobType[], limit = 250): Promise<JobRecord[]> {
    if (this.repo.listForUser) return this.repo.listForUser(userId, types, limit);
    // Compatibility for in-memory/test adapters that predate the scoped query.
    return (await this.repo.list(undefined, 10_000))
      .filter((job) => job.payload.userId === userId && types.includes(job.type))
      .slice(0, limit);
  }

  async listJobs(status?: JobState, limit = 250): Promise<JobRecord[]> {
    return this.list(status, limit);
  }

  async retryJob(id: number): Promise<JobRecord | null> {
    return this.repo.retry(id, this.now());
  }

  async updateProgress(id: number, progress: Record<string, unknown>): Promise<void> {
    await this.repo.updateProgress(id, progress);
  }

  async pruneTerminalJobs(olderThan: Date, limit = 500): Promise<number> {
    // Older in-memory/test repository adapters predate retention support.
    // Production PgJobRepository implements it; treating a legacy adapter as
    // a no-op keeps maintenance best-effort rather than taking down the timer.
    return this.repo.pruneTerminalJobs?.(olderThan, limit) ?? 0;
  }

  async hasUrgentQueued(): Promise<boolean> {
    return this.repo.hasQueuedPriorityAtOrBelow(JobPriority.URGENT);
  }
}

export function backoffMs(attempts: number, jitterMs: number): number {
  return Math.min(2 ** attempts * 30_000, 30 * 60_000) + jitterMs;
}
