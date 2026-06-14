import { JobPriority, type JobQueue, type JobRecord, type JobType } from "../jobs/index.js";
import type { SyncApiService, SyncMappingStatus, SyncStatusResponse } from "./syncRoutes.js";

const SYNC_TYPES = new Set<JobType>(["KITSU_FULL_SYNC", "KITSU_DELTA_SYNC"]);

/** Error signatures that indicate AnimeThemes blocked us rather than a transient bug. */
const UPSTREAM_BLOCK_PATTERNS = [/\b403\b/, /\b451\b/, /circuit open/i, /cloudflare/i];

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
    const all = await this.queue.list();
    const jobs = all
      .filter((job) => SYNC_TYPES.has(job.type) && job.payload.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
    const mapping = latestMappingStatus(all, userId);
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
        mapping,
        upstreamBlocked: isUpstreamBlocked(mapping),
      };
    }
    return statusFromJob(latest, lastDone, mapping);
  }
}

function latestMappingStatus(all: JobRecord[], userId: string): SyncMappingStatus | null {
  const latest = all
    .filter((job) => job.type === "MAP_THEMES" && job.payload.userId === userId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id)[0];
  if (!latest) return null;
  return { state: latest.state, lastError: latest.lastError };
}

function isUpstreamBlocked(mapping: SyncMappingStatus | null): boolean {
  if (!mapping || mapping.state !== "FAILED" || !mapping.lastError) return false;
  return UPSTREAM_BLOCK_PATTERNS.some((pattern) => pattern.test(mapping.lastError!));
}

function statusFromJob(
  job: JobRecord,
  lastDone: JobRecord | null,
  mapping: SyncMappingStatus | null,
): SyncStatusResponse {
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
    mapping,
    upstreamBlocked: isUpstreamBlocked(mapping),
  };
}
