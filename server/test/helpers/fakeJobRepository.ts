import type {
  EnqueueJobInput,
  JobRecord,
  JobRepository,
  JobState,
  RetryJobInput,
} from "../../src/jobs/types.js";

export class FakeJobRepository implements JobRepository {
  jobs = new Map<number, JobRecord>();
  private nextId = 1;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const existing = input.dedupeKey
      ? [...this.jobs.values()].find((job) => job.dedupeKey === input.dedupeKey)
      : undefined;
    if (
      existing &&
      (existing.state === "QUEUED" ||
        existing.state === "FAILED" ||
        existing.state === "DONE" ||
        existing.state === "CANCELLED")
    ) {
      existing.state = "QUEUED";
      existing.priority = Math.min(existing.priority, input.priority);
      existing.payload = input.payload;
      existing.progress = {};
      existing.attempts = 0;
      existing.lastError = null;
      existing.nextRunAt =
        existing.nextRunAt.getTime() <= input.nextRunAt.getTime()
          ? existing.nextRunAt
          : input.nextRunAt;
      existing.updatedAt = this.now();
      return { ...existing };
    }
    if (existing) return { ...existing };

    const now = this.now();
    const job: JobRecord = {
      id: this.nextId++,
      type: input.type,
      priority: input.priority,
      state: "QUEUED",
      payload: input.payload,
      progress: {},
      dedupeKey: input.dedupeKey ?? null,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      nextRunAt: input.nextRunAt,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async claimNext(now: Date): Promise<JobRecord | null> {
    const job = [...this.jobs.values()]
      .filter((candidate) => candidate.state === "QUEUED" && candidate.nextRunAt <= now)
      .sort((a, b) => a.priority - b.priority || a.nextRunAt.getTime() - b.nextRunAt.getTime() || a.id - b.id)[0];
    if (!job) return null;
    job.state = "RUNNING";
    job.updatedAt = this.now();
    return { ...job };
  }

  async complete(id: number): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.state = "DONE";
      job.updatedAt = this.now();
    }
  }

  async fail(id: number, input: RetryJobInput): Promise<JobRecord | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.attempts += input.incrementAttempts ? 1 : 0;
    job.lastError = input.lastError;
    job.state = input.state;
    job.nextRunAt = input.nextRunAt;
    job.updatedAt = this.now();
    return { ...job };
  }

  async recoverRunning(): Promise<number> {
    let recovered = 0;
    for (const job of this.jobs.values()) {
      if (job.state === "RUNNING") {
        job.state = "QUEUED";
        job.updatedAt = this.now();
        recovered += 1;
      }
    }
    return recovered;
  }

  async list(status?: JobState): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => !status || job.state === status)
      .sort((a, b) => a.id - b.id)
      .map((job) => ({ ...job }));
  }

  async retry(id: number, now: Date): Promise<JobRecord | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.state = "QUEUED";
    job.nextRunAt = now;
    job.lastError = null;
    job.updatedAt = this.now();
    return { ...job };
  }

  async updateProgress(id: number, progress: Record<string, unknown>): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    job.progress = progress;
    job.updatedAt = this.now();
  }

  async hasQueuedPriorityAtOrBelow(priority: number): Promise<boolean> {
    return [...this.jobs.values()].some(
      (job) => job.state === "QUEUED" && job.priority <= priority,
    );
  }
}

