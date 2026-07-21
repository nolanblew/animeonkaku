import { randomUUID } from "node:crypto";
import type { JobQueue } from "../../jobs/jobQueue.js";
import { JobPriority } from "../../jobs/types.js";
import { buildMusicRequestBatches } from "./builder.js";
import type { MusicRequestRepository, MusicRequestSource, MusicRequestSummary, StoredMusicRequest } from "./types.js";

export class MusicRequestNotFoundError extends Error {}
export class MusicRequestNotMappedError extends Error {}

export class MusicRequestService {
  constructor(private readonly deps: { repo: MusicRequestRepository; queue: JobQueue; uuid?: () => string }) {}

  async trigger(userId: string, kitsuId: string, source: MusicRequestSource = "DEBUG_USER") {
    const metadata = await this.deps.repo.loadMetadata(kitsuId);
    if (!metadata) throw new MusicRequestNotMappedError();
    const uuid = this.deps.uuid ?? randomUUID;
    const requestId = uuid();
    const built = buildMusicRequestBatches({ ...metadata, requestId });
    const persisted = await this.deps.repo.createOrReplay({
      id: requestId, requestedByUserId: userId, kitsuId, animeThemesAnimeId: metadata.animeThemesAnimeId, source,
      batches: built.map((batch) => ({
        id: uuid(), index: batch.index, body: batch.body,
        idempotencyKey: `anime-ongaku:${requestId}:${batch.index}`,
        items: batch.items.map((item) => ({ id: uuid(), ...item })),
      })),
    });
    await Promise.all(persisted.request.batches.map((batch) => this.enqueueBatch(batch.id, Boolean(batch.amfJobId))));
    return { request: toSummary(persisted.request), replayed: !persisted.created };
  }

  async get(_userId: string, id: string) {
    const request = await this.deps.repo.findById(id);
    if (!request) throw new MusicRequestNotFoundError();
    const visible = await this.deps.repo.loadMetadata(request.kitsuId);
    if (!visible || visible.animeThemesAnimeId !== request.animeThemesAnimeId) throw new MusicRequestNotFoundError();
    return toSummary(request);
  }

  async latest(kitsuId: string) {
    const metadata = await this.deps.repo.loadMetadata(kitsuId);
    if (!metadata) throw new MusicRequestNotMappedError();
    const request = await this.deps.repo.findLatest(metadata.animeThemesAnimeId);
    return request ? toSummary(request) : null;
  }

  async recover(): Promise<number> {
    const batches = await this.deps.repo.listRecoverableBatches();
    await Promise.all(batches.map((batch) => this.enqueueBatch(batch.id, Boolean(batch.amfJobId))));
    return batches.length;
  }

  private async enqueueBatch(batchId: string, polling: boolean) {
    await this.deps.queue.enqueue({
      type: polling ? "POLL_AMF_MUSIC_BATCH" : "SUBMIT_AMF_MUSIC_BATCH",
      priority: JobPriority.NORMAL, payload: { batchId },
      dedupeKey: `${polling ? "POLL_AMF_MUSIC_BATCH" : "SUBMIT_AMF_MUSIC_BATCH"}:${batchId}`,
      maxAttempts: 8,
    });
  }
}

export function toSummary(request: StoredMusicRequest): MusicRequestSummary {
  const counts: MusicRequestSummary["counts"] = { queued: 0, searching: 0, awaitingOperator: 0, downloading: 0, processing: 0, completed: 0, completedWithWarnings: 0, failed: 0, cancelled: 0 };
  for (const batch of request.batches) {
    switch (batch.state) {
      case "QUEUED": counts.queued++; break;
      case "SEARCHING": counts.searching++; break;
      case "AWAITING_OPERATOR": counts.awaitingOperator++; break;
      case "DOWNLOADING": counts.downloading++; break;
      case "PROCESSING": counts.processing++; break;
      case "COMPLETED": counts.completed++; break;
      case "COMPLETED_WITH_WARNINGS": counts.completedWithWarnings++; break;
      case "FAILED": counts.failed++; break;
      case "CANCELLED": counts.cancelled++; break;
      default: return assertNever(batch.state);
    }
  }
  const state = aggregate(counts, request.batches.length);
  const active = !["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(state);
  return { id: request.id, kitsuId: request.kitsuId, state, batchCount: request.batches.length, counts,
    requiresOperatorAction: counts.awaitingOperator > 0,
    lastUpdatedAt: request.updatedAt.toISOString(), ...(active ? { pollAfterSeconds: 5 } : {}) };
}

function aggregate(c: MusicRequestSummary["counts"], total: number): MusicRequestSummary["state"] {
  if (c.awaitingOperator) return "AWAITING_OPERATOR";
  if (c.processing) return "PROCESSING";
  if (c.downloading) return "DOWNLOADING";
  if (c.searching) return "SEARCHING";
  if (c.queued) return "QUEUED";
  if (c.cancelled === total) return "CANCELLED";
  if (c.failed) return "FAILED";
  if (c.cancelled || c.completedWithWarnings) return "COMPLETED_WITH_WARNINGS";
  return "COMPLETED";
}

function assertNever(value: never): never { throw new Error(`Unknown batch state: ${String(value)}`); }
