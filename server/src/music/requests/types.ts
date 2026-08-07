import type { AmfJobCreate } from "../animeMusicFetcher/schemas.js";
import type { AmfJob } from "../animeMusicFetcher/schemas.js";
import type { MusicRequestMetadata } from "./builder.js";

export const MUSIC_BATCH_STATES = ["QUEUED", "SEARCHING", "AWAITING_OPERATOR", "DOWNLOADING", "PROCESSING", "COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"] as const;
export type MusicBatchState = typeof MUSIC_BATCH_STATES[number];
export type MusicRequestSource = "DEBUG_USER" | "AUTOMATIC" | "ADMIN_REIMPORT";
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
export type ProviderJobRole = "ROOT" | "FOLLOW_UP";

/**
 * One provider job in a batch's job graph (MC-S13/F1). AMF delegates items it
 * cannot confidently cover to linked single-item follow-up jobs, so a batch
 * owns many provider jobs; `StoredMusicBatch.amfJobId` stays the ROOT.
 */
export interface StoredProviderJobLink {
  batchId: string;
  amfJobId: string;
  role: ProviderJobRole;
  /** Discovery order within the batch. 0 is the root; drives `fileIndexOffset`. */
  ordinal: number;
  depth: number;
  parentAmfJobId: string | null;
  /** Index into the *parent job's* item list, as AMF reports it. */
  parentItemIndex: number | null;
  /**
   * The persisted batch item index this job's results attribute to. `null`
   * only for the root, whose item results cover the whole batch. A grandchild
   * inherits its parent's value, so a multi-level walk still lands on the
   * original batch item.
   */
  itemIndex: number | null;
  /**
   * Added to every delivery `file_index` this job reports, so two sibling
   * follow-up jobs covering the same batch item cannot collide on
   * `anime_music_request_deliveries (item_id, file_index)`. Root is 0.
   */
  fileIndexOffset: number;
  providerStatus: string | null;
  destination: string | null;
  manifestEvidence: StoredMusicBatchManifest;
  /** Set once a poll 404s — the provider no longer holds this record (F2). */
  goneAt: Date | null;
  lastPolledAt: Date | null;
}

/**
 * Restricts one `recordProviderEvidence` pass to the slice of a batch that a
 * single provider job actually speaks for. The root's scope is the whole batch
 * (`itemIndexes: null`, offset 0), which is exactly the pre-MC-S13 behaviour.
 */
export interface ProviderEvidenceScope {
  itemIndexes: number[] | null;
  fileIndexOffset: number;
  fileIndexStride: number;
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
  /**
   * `scope` is optional purely for backward compatibility: omitting it means
   * "this job's item results cover the entire batch", which is what a root job
   * has always meant. A follow-up job passes its own narrow scope so the
   * identity guard is evaluated against the slice it speaks for rather than
   * the whole batch (see MC-S13).
   */
  recordProviderEvidence(batchId: string, job: AmfJob, now: Date, scope?: ProviderEvidenceScope): Promise<void>;
  /** The batch's persisted provider job graph, root first (ordinal order). */
  listProviderJobs(batchId: string): Promise<StoredProviderJobLink[]>;
  /** Upserts observed/discovered graph members. Never deletes: a provider job we once knew about stays observable. */
  saveProviderJobs(batchId: string, links: StoredProviderJobLink[], now: Date): Promise<void>;
}

export type MusicRequestState = MusicBatchState;
export interface MusicRequestSummary {
  id: string; kitsuId: string; state: MusicRequestState; batchCount: number; fullThemeCount: number;
  counts: Record<"queued" | "searching" | "awaitingOperator" | "downloading" | "processing" | "completed" | "completedWithWarnings" | "failed" | "cancelled", number>;
  requiresOperatorAction: boolean; lastUpdatedAt: string; pollAfterSeconds?: number;
}
