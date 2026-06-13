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
  | "AUTO_PLAYLIST_REFRESH";

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
  lastError: string;
  incrementAttempts: boolean;
}

export interface JobRepository {
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  claimNext(now: Date): Promise<JobRecord | null>;
  complete(id: number): Promise<void>;
  fail(id: number, input: RetryJobInput): Promise<JobRecord | null>;
  recoverRunning(): Promise<number>;
  list(status?: JobState): Promise<JobRecord[]>;
  retry(id: number, now: Date): Promise<JobRecord | null>;
  updateProgress(id: number, progress: Record<string, unknown>): Promise<void>;
  hasQueuedPriorityAtOrBelow(priority: number): Promise<boolean>;
}

export type JobHandler = (
  payload: Record<string, unknown>,
  job: JobRecord,
) => Promise<void>;

