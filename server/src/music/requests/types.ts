import type { AmfJobCreate } from "../animeMusicFetcher/schemas.js";
import type { AmfJob } from "../animeMusicFetcher/schemas.js";
import type { MusicRequestMetadata } from "./builder.js";

export const MUSIC_BATCH_STATES = ["QUEUED", "SEARCHING", "AWAITING_OPERATOR", "DOWNLOADING", "PROCESSING", "COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"] as const;
export type MusicBatchState = typeof MUSIC_BATCH_STATES[number];
export type MusicRequestSource = "DEBUG_USER" | "AUTOMATIC";
export interface StoredMusicBatch { id: string; requestId: string; index: number; state: MusicBatchState; body: AmfJobCreate; idempotencyKey: string; amfJobId: string | null; warningCount: number; providerStatus?: AmfJob["status"] | null; }
export interface StoredMusicRequest { id: string; kitsuId: string; animeThemesAnimeId: number; createdAt: Date; updatedAt: Date; completedAt: Date | null; batches: StoredMusicBatch[]; }
export interface NewMusicRequest { id: string; requestedByUserId: string; kitsuId: string; animeThemesAnimeId: number; source: MusicRequestSource; batches: Array<{ id: string; index: number; body: AmfJobCreate; idempotencyKey: string; items: Array<{ id: string; itemIndex: number; kind: string; number: number | null; themeId: number | null }> }>; }
export interface MusicRequestRepository {
  loadMetadata(kitsuId: string): Promise<(MusicRequestMetadata & { animeThemesAnimeId: number }) | null>;
  createOrReplay(input: NewMusicRequest): Promise<{ request: StoredMusicRequest; created: boolean }>;
  findById(id: string): Promise<StoredMusicRequest | null>;
  findLatest(animeThemesAnimeId: number): Promise<StoredMusicRequest | null>;
  findBatch(id: string): Promise<StoredMusicBatch | null>;
  listRecoverableBatches(): Promise<StoredMusicBatch[]>;
  listRecheckableBatches(): Promise<StoredMusicBatch[]>;
  recordProviderState(batchId: string, input: { state: MusicBatchState; amfJobId?: string; warningCount?: number; lastError?: string | null; providerStatus?: AmfJob["status"] }, now: Date): Promise<void>;
  recordProviderEvidence(batchId: string, job: AmfJob, now: Date): Promise<void>;
}

export type MusicRequestState = MusicBatchState;
export interface MusicRequestSummary {
  id: string; kitsuId: string; state: MusicRequestState; batchCount: number;
  counts: Record<"queued" | "searching" | "awaitingOperator" | "downloading" | "processing" | "completed" | "completedWithWarnings" | "failed" | "cancelled", number>;
  requiresOperatorAction: boolean; lastUpdatedAt: string; pollAfterSeconds?: number;
}
