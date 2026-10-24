import { JobPriority, type JobQueue, type JobRecord, type JobType } from "../jobs/index.js";
import type { SyncApiService, SyncMappingStatus, SyncStageName, SyncStageStatus, SyncStatusResponse } from "./syncRoutes.js";
import { kitsuSyncDedupeKey } from "../sync/syncJobKeys.js";

const SYNC_TYPES = new Set<JobType>(["KITSU_FULL_SYNC", "KITSU_DELTA_SYNC"]);
const STAGE_TYPES: Record<SyncStageName, readonly JobType[]> = {
  library: ["KITSU_FULL_SYNC", "KITSU_DELTA_SYNC"],
  catalog: ["MAP_THEMES"],
  playlists: ["AUTO_PLAYLIST_REFRESH"],
  musicPolicy: ["MUSIC_POLICY_SYNC", "RECONCILE_MUSIC_SEARCH_POLICY"],
};
const STAGE_JOB_LIMIT = 10_000;

/** Error signatures that indicate AnimeThemes blocked us rather than a transient bug. */
const UPSTREAM_BLOCK_PATTERNS = [/\b403\b/, /\b451\b/, /circuit open/i, /cloudflare/i];

export class JobSyncApiService implements SyncApiService {
  constructor(
    private readonly queue: JobQueue,
    private readonly getLibraryLastSyncAt?: (userId: string) => Promise<Date | null>,
  ) {}

  async enqueueSync(userId: string, full: boolean): Promise<{ jobId: number }> {
    const type: JobType = full ? "KITSU_FULL_SYNC" : "KITSU_DELTA_SYNC";
    const job = await this.queue.enqueue({
      type,
      priority: JobPriority.HIGH,
      payload: { userId, full },
      dedupeKey: kitsuSyncDedupeKey(userId),
    });
    return { jobId: job.id };
  }

  async getStatus(userId: string): Promise<SyncStatusResponse> {
    // Query each stage separately: a large per-anime mapping backlog must not
    // displace the library completion row from the status response.
    const stageNames = Object.keys(STAGE_TYPES) as SyncStageName[];
    const stageJobs = await Promise.all(stageNames.map((stage) => this.stageJobs(userId, stage)));
    const stages = Object.fromEntries(stageNames.map((stage, index) => [stage, summarizeStage(stageJobs[index]!, stage)])) as Record<SyncStageName, SyncStageStatus>;
    const all = stageJobs.flat();
    const jobs = all
      .filter((job) => SYNC_TYPES.has(job.type) && job.payload.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
    const mapping = latestMappingStatus(all, userId);
    const active = jobs.find((job) => job.state === "RUNNING") ?? jobs.find((job) => job.state === "QUEUED");
    const activeMapping = all
      .filter(
        (job) =>
          job.type === "MAP_THEMES" &&
          job.payload.userId === userId &&
          (job.state === "RUNNING" || job.state === "QUEUED"),
      )
      .sort((a, b) => stateRank(a.state) - stateRank(b.state) || b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id)[0];
    const latest = active ?? jobs[0] ?? null;
    const lastDone = jobs.find((job) => job.state === "DONE" && job.progress.phase !== "SKIPPED") ?? null;
    // Library import is a single current operation. Retained failures under
    // older sync keys must not poison a later successful import's stage.
    stages.library = summarizeStage(latest ? [latest] : [], "library");
    stages.library.lastCompletedAt = lastDone?.updatedAt.getTime() ?? null;
    const details = {
      libraryState: latest?.state === "DONE" && latest.progress.phase === "SKIPPED" ? "FAILED" : latest?.state ?? "IDLE",
      libraryLastCompletedAt: this.getLibraryLastSyncAt
        ? (await this.getLibraryLastSyncAt(userId))?.getTime() ?? null
        : stages.library.lastCompletedAt,
      stages,
    };
    if (latest?.progress.independentlyRetryableStages === true) {
      // Existing Android clients treat mapping failure as an import failure.
      // Stage-aware imports expose downstream work only through `stages` so
      // those clients can finish their library pull when the import commits.
      return {
        ...statusFromJob(latest, lastDone, null, active !== undefined),
        ...details,
        mapping: null,
        upstreamBlocked: false,
      };
    }
    if (!active && activeMapping) {
      return { ...statusFromMappingJob(activeMapping, lastDone, mapping), ...details };
    }
    if (!latest) {
      return {
        state: "IDLE",
        phase: null,
        progress: {},
        lastCompletedAt: null,
        unmatched: [],
        mapping,
        upstreamBlocked: isUpstreamBlocked(mapping),
        ...details,
      };
    }
    return { ...statusFromJob(latest, lastDone, mapping, active !== undefined), ...details };
  }

  async retryStage(userId: string, stage: SyncStageName): Promise<{ retried: number }> {
    let retried = 0;
    for (const job of await this.stageJobs(userId, stage)) {
      if (job.state === "FAILED" && await this.queue.retryFailedJob(job.id)) retried += 1;
    }
    return { retried };
  }

  private async stageJobs(userId: string, stage: SyncStageName): Promise<JobRecord[]> {
    return (await this.queue.listForUser(userId, STAGE_TYPES[stage], STAGE_JOB_LIMIT))
      .filter((job) => job.payload.userId === userId && STAGE_TYPES[stage].includes(job.type));
  }
}

function summarizeStage(jobs: JobRecord[], stage: SyncStageName): SyncStageStatus {
  const skipped = stage === "library" ? jobs.filter((job) => job.state === "DONE" && job.progress.phase === "SKIPPED") : [];
  jobs = jobs.filter((job) => !skipped.includes(job));
  const ordered = [...jobs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
  const counts: Record<string, number> = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0, CANCELLED: 0 };
  if (skipped.length) counts.SKIPPED = skipped.length;
  for (const job of jobs) counts[job.state] = (counts[job.state] ?? 0) + 1;
  const state = counts.FAILED ? "FAILED" : counts.RUNNING ? "RUNNING" : counts.QUEUED ? "QUEUED" : skipped.length ? "FAILED" : counts.DONE ? "DONE" : "IDLE";
  const retryTimes = jobs.filter((job) => job.state === "QUEUED" && job.lastError).map((job) => job.nextRunAt.getTime());
  return {
    state,
    counts,
    updatedAt: ordered[0]?.updatedAt.getTime() ?? skipped[0]?.updatedAt.getTime() ?? null,
    lastCompletedAt: ordered.find((job) => job.state === "DONE")?.updatedAt.getTime() ?? null,
    nextRetryAt: retryTimes.length ? Math.min(...retryTimes) : null,
    lastError: ordered.find((job) => (job.state === "FAILED" || job.state === "QUEUED") && job.lastError)?.lastError
      ?? (skipped.length ? `Kitsu import skipped: ${String(skipped[0]!.progress.reason ?? "UNKNOWN_REASON")}` : null),
    failedJobIds: jobs.filter((job) => job.state === "FAILED").map((job) => job.id),
    attentionCount: jobs.filter((job) => job.state === "DONE" && (job.progress.metadataUnavailable === true || (Array.isArray(job.progress.unmatched) && job.progress.unmatched.length > 0))).length,
    truncated: jobs.length >= STAGE_JOB_LIMIT,
  };
}

function latestMappingStatus(all: JobRecord[], userId: string): SyncMappingStatus | null {
  const jobs = all
    .filter((job) => job.type === "MAP_THEMES" && job.payload.userId === userId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
  // A successful anime must not hide another anime's failed mapping.
  const latest = jobs.find((job) => job.state === "FAILED") ?? jobs[0];
  if (!latest) return null;
  return { state: latest.state, lastError: latest.lastError };
}

function stateRank(state: string): number {
  if (state === "RUNNING") return 0;
  if (state === "QUEUED") return 1;
  return 2;
}

function isUpstreamBlocked(mapping: SyncMappingStatus | null): boolean {
  if (!mapping || mapping.state !== "FAILED" || !mapping.lastError) return false;
  return UPSTREAM_BLOCK_PATTERNS.some((pattern) => pattern.test(mapping.lastError!));
}

function statusFromJob(
  job: JobRecord,
  lastDone: JobRecord | null,
  mapping: SyncMappingStatus | null,
  hasActiveLibrarySync: boolean,
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
    // A failed mapping row can belong to the previous attempt. While a fresh
    // library sync is active, let it enqueue a new mapping job before surfacing
    // the old failure again; otherwise retrying first sync fails immediately.
    upstreamBlocked: !hasActiveLibrarySync && isUpstreamBlocked(mapping),
  };
}

function statusFromMappingJob(
  job: JobRecord,
  lastDone: JobRecord | null,
  mapping: SyncMappingStatus | null,
): SyncStatusResponse {
  return {
    state: job.state,
    phase: "MAPPING_THEMES",
    progress: job.progress,
    lastCompletedAt: lastDone?.updatedAt.getTime() ?? null,
    unmatched: [],
    mapping,
    upstreamBlocked: isUpstreamBlocked(mapping),
  };
}
