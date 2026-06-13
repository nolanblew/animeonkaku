import { JobPriority, type JobQueue, type JobRecord, type JobType } from "../jobs/index.js";
import type { SyncApiService, SyncStatusResponse } from "./syncRoutes.js";

const SYNC_TYPES = new Set<JobType>(["KITSU_FULL_SYNC", "KITSU_DELTA_SYNC"]);

export class JobSyncApiService implements SyncApiService {
  constructor(private readonly queue: JobQueue) {}

  async enqueueSync(userId: string, full: boolean): Promise<{ jobId: number }> {
    const type: JobType = full ? "KITSU_FULL_SYNC" : "KITSU_DELTA_SYNC";
    const job = await this.queue.enqueue({
      type,
      priority: JobPriority.HIGH,
      payload: { userId, full },
      dedupeKey: `${type}:${userId}`,
    });
    return { jobId: job.id };
  }

  async getStatus(userId: string): Promise<SyncStatusResponse> {
    const jobs = (await this.queue.list())
      .filter((job) => SYNC_TYPES.has(job.type) && job.payload.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
    const active = jobs.find((job) => job.state === "RUNNING") ?? jobs.find((job) => job.state === "QUEUED");
    const latest = active ?? jobs[0] ?? null;
    const lastDone = jobs.find((job) => job.state === "DONE") ?? null;
    if (!latest) {
      return {
        state: "IDLE",
        phase: null,
        progress: {},
        lastCompletedAt: null,
        unmatched: [],
      };
    }
    return statusFromJob(latest, lastDone);
  }
}

function statusFromJob(job: JobRecord, lastDone: JobRecord | null): SyncStatusResponse {
  const phase = typeof job.progress.phase === "string" ? job.progress.phase : null;
  const unmatched = Array.isArray(job.progress.unmatched)
    ? job.progress.unmatched.filter((item): item is string => typeof item === "string")
    : [];
  return {
    state: job.state,
    phase,
    progress: job.progress,
    lastCompletedAt: lastDone?.updatedAt.getTime() ?? (job.state === "DONE" ? job.updatedAt.getTime() : null),
    unmatched,
  };
}
