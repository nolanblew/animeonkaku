import type { AmfJobCreate } from "../animeMusicFetcher/schemas.js";
import type { AmfJob } from "../animeMusicFetcher/schemas.js";
import type { MusicRequestMetadata } from "./builder.js";

export const MUSIC_BATCH_STATES = ["QUEUED", "SEARCHING", "AWAITING_OPERATOR", "DOWNLOADING", "PROCESSING", "COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"] as const;
export type MusicBatchState = typeof MUSIC_BATCH_STATES[number];
export type MusicRequestSource = "DEBUG_USER" | "AUTOMATIC";
/**
 * The slice of the last-observed AMF manifest that decides whether the poll
 * backoff ladder should reset. Deliberately narrower than the full evidence
 * blob persisted by `recordProviderEvidence` — only status/item-results/
 * deliveries are compared (per MC-S16), so unrelated fields (e.g. warnings)
 * never cause a spurious reset.
 */
export interface StoredMusicBatchManifest { status: string | null; itemResults: unknown[]; deliveries: unknown[]; }
export interface StoredMusicBatch {
  id: string; requestId: string; index: number; state: MusicBatchState; body: AmfJobCreate; idempotencyKey: string;
  amfJobId: string | null; warningCount: number; providerStatus?: AmfJob["status"] | null;
  /**
   * Escalating poll-backoff ladder state (MC-S16). Lives on the batch, not the
   * job row: `PgJobRepository.enqueue`'s upsert resets a job's `attempts` to 0
   * and pulls `next_run_at` forward on every re-enqueue against the same
   * dedupe key (e.g. the 15-minute `recheckIncomplete` sweep), so the ladder
   * position cannot survive there. `pollNotBefore` lets a poll that fires
   * early because of that pull-forward reschedule itself without contacting
   * the provider.
   */
  pollBackoffStep: number;
  pollNotBefore: Date | null;
  manifestEvidence: StoredMusicBatchManifest;
}
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
  recordProviderState(batchId: string, input: { state: MusicBatchState; amfJobId?: string; warningCount?: number; lastError?: string | null; providerStatus?: AmfJob["status"]; pollBackoffStep?: number; pollNotBefore?: Date | null }, now: Date): Promise<void>;
  recordProviderEvidence(batchId: string, job: AmfJob, now: Date): Promise<void>;
}

export type MusicRequestState = MusicBatchState;
export interface MusicRequestSummary {
  id: string; kitsuId: string; state: MusicRequestState; batchCount: number;
  counts: Record<"queued" | "searching" | "awaitingOperator" | "downloading" | "processing" | "completed" | "completedWithWarnings" | "failed" | "cancelled", number>;
  requiresOperatorAction: boolean; lastUpdatedAt: string; pollAfterSeconds?: number;
}
