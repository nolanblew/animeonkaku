export const JobPriority = {
  URGENT: 0,
  HIGH: 10,
  NORMAL: 20,
  MAINTENANCE: 30,
} as const;

export type JobPriorityValue = (typeof JobPriority)[keyof typeof JobPriority];

export type JobState = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";

export type JobType =
  | "KITSU_FULL_SYNC"
  | "KITSU_DELTA_SYNC"
  | "MAP_THEMES"
  | "FETCH_AUDIO"
  | "FETCH_IMAGE"
  | "BACKFILL_SCAN"
  | "AUTO_PLAYLIST_REFRESH"
  | "MUSIC_CATALOG_SCAN"
  | "DISCOVER_ANIME_MUSIC"
  | "RECONCILE_MUSIC_ACQUISITION"
  | "IMPORT_MUSIC_AUDIO"
  | "SUBMIT_AMF_MUSIC_BATCH"
  | "POLL_AMF_MUSIC_BATCH"
  | "IMPORT_AMF_MUSIC_BATCH"
  | "IMPORT_AMF_MUSIC_ITEM"
  | "REIMPORT_AMF_FULL_SIZE"
  | "OPERATE_AMF_MUSIC_BATCH"
  | "RECONCILE_MUSIC_SEARCH_POLICY";

export interface JobRecord {
  id: number;
  type: JobType;
  priority: number;
  state: JobState;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  dedupeKey: string | null;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueJobInput {
  type: JobType;
  priority: JobPriorityValue | number;
  payload: Record<string, unknown>;
  dedupeKey?: string | null;
  maxAttempts: number;
  nextRunAt: Date;
}

export interface RetryJobInput {
  state: "QUEUED" | "FAILED";
  nextRunAt: Date;
  lastError: string | null;
  incrementAttempts: boolean;
}

export interface JobRepository {
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  /** Claim the next runnable job; `maxPriority` limits the claim to jobs at that priority or better (lower). */
  claimNext(now: Date, maxPriority?: number): Promise<JobRecord | null>;
  complete(id: number): Promise<void>;
  fail(id: number, input: RetryJobInput): Promise<JobRecord | null>;
  recoverRunning(): Promise<number>;
  list(status?: JobState, limit?: number): Promise<JobRecord[]>;
  /** Fetch recent jobs for one user without unrelated queue traffic displacing sync status. */
  listForUser?(userId: string, types: readonly JobType[], limit: number): Promise<JobRecord[]>;
  /** Delete a bounded batch of old completed/cancelled work during maintenance. */
  pruneTerminalJobs(olderThan: Date, limit: number): Promise<number>;
  retry(id: number, now: Date): Promise<JobRecord | null>;
  updateProgress(id: number, progress: Record<string, unknown>): Promise<void>;
  hasQueuedPriorityAtOrBelow(priority: number): Promise<boolean>;
}

export interface JobExecutionContext {
  /** Aborted when the worker's execution deadline elapses. */
  signal: AbortSignal;
}

export type JobHandler = (
  payload: Record<string, unknown>,
  job: JobRecord,
  context: JobExecutionContext,
) => Promise<void>;

