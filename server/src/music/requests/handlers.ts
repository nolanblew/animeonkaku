import type { AnimeMusicFetcherClient } from "../animeMusicFetcher/client.js";
import { AnimeMusicFetcherError } from "../animeMusicFetcher/errors.js";
import type { AmfJob, AmfJobStatus } from "../animeMusicFetcher/schemas.js";
import type { JobQueue } from "../../jobs/jobQueue.js";
import { RetryableJobError } from "../../jobs/jobWorker.js";
import { JobPriority, type JobHandler } from "../../jobs/types.js";
import type { MusicBatchState, MusicRequestRepository } from "./types.js";

export const AMF_POLL_INTERVAL_MS = 5_000;

export function createMusicRequestHandlers(deps: { repo: MusicRequestRepository; queue: JobQueue; client: Pick<AnimeMusicFetcherClient, "submitJob" | "getJob">; now?: () => Date }): Record<"SUBMIT_AMF_MUSIC_BATCH" | "POLL_AMF_MUSIC_BATCH", JobHandler> {
  const now = deps.now ?? (() => new Date());
  const poll = async (batchId: string) => deps.queue.enqueue({ type: "POLL_AMF_MUSIC_BATCH", priority: JobPriority.NORMAL,
    payload: { batchId }, dedupeKey: `POLL_AMF_MUSIC_BATCH:${batchId}`, maxAttempts: 8 });
  const importBatch = async (batchId: string) => deps.queue.enqueue({ type: "IMPORT_AMF_MUSIC_BATCH", priority: JobPriority.NORMAL,
    payload: { batchId }, dedupeKey: `IMPORT_AMF_MUSIC_BATCH:${batchId}`, maxAttempts: 8 });
  return {
    async SUBMIT_AMF_MUSIC_BATCH(payload) {
      const batch = await requireBatch(deps.repo, payload);
      if (batch.amfJobId) { await poll(batch.id); return; }
      let providerJob: AmfJob;
      try {
        providerJob = await deps.client.submitJob(batch.body, batch.idempotencyKey);
      } catch (error) { await handleProviderError(deps.repo, batch.id, error, now()); return; }
      if (shouldPersistEvidence(providerJob.status)) await deps.repo.recordProviderEvidence(batch.id, providerJob, now());
      await deps.repo.recordProviderState(batch.id, providerUpdate(providerJob), now());
      if (isImportable(providerJob.status)) await importBatch(batch.id);
      else if (!isTerminal(providerJob.status)) await poll(batch.id);
    },
    async POLL_AMF_MUSIC_BATCH(payload) {
      const batch = await requireBatch(deps.repo, payload);
      if (!batch.amfJobId) throw new RetryableJobError("AMF submission identity is not persisted yet", { incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
      let providerJob: AmfJob;
      try { providerJob = await deps.client.getJob(batch.amfJobId); }
      catch (error) { await handleProviderError(deps.repo, batch.id, error, now()); return; }
      if (shouldPersistEvidence(providerJob.status)) await deps.repo.recordProviderEvidence(batch.id, providerJob, now());
      await deps.repo.recordProviderState(batch.id, providerUpdate(providerJob), now());
      if (isImportable(providerJob.status)) { await importBatch(batch.id); return; }
      if (!isTerminal(providerJob.status)) throw new RetryableJobError("AMF batch is still active", { incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
    },
  };
}

async function requireBatch(repo: MusicRequestRepository, payload: Record<string, unknown>) {
  if (typeof payload.batchId !== "string") throw new Error("Music request job is missing batchId");
  const batch = await repo.findBatch(payload.batchId);
  if (!batch) throw new Error("Music request batch does not exist");
  return batch;
}
function providerUpdate(job: AmfJob): { state: MusicBatchState; amfJobId: string; warningCount: number; lastError: null } {
  return { state: mapStatus(job.status), amfJobId: job.id, warningCount: job.warnings.length, lastError: null };
}
function mapStatus(status: AmfJobStatus): MusicBatchState {
  switch (status) {
    case "queued": return "QUEUED";
    case "searching": case "selected": case "submitting": return "SEARCHING";
    case "awaiting_selection": case "awaiting_file_selection": case "download_stalled": return "AWAITING_OPERATOR";
    case "downloading": return "DOWNLOADING";
    case "processing": return "PROCESSING";
    case "completed": case "completed_with_warnings": return "PROCESSING";
    case "failed": return "FAILED";
    case "cancelled": return "CANCELLED";
    default: return assertNever(status);
  }
}
function isTerminal(status: AmfJobStatus) { return ["completed", "completed_with_warnings", "failed", "cancelled"].includes(status); }
function isImportable(status: AmfJobStatus) { return status === "completed" || status === "completed_with_warnings"; }
function shouldPersistEvidence(status: AmfJobStatus) {
  return isTerminal(status) || status === "awaiting_selection" || status === "awaiting_file_selection" || status === "download_stalled";
}
async function handleProviderError(repo: MusicRequestRepository, batchId: string, error: unknown, now: Date): Promise<never | void> {
  if (error instanceof AnimeMusicFetcherError && error.retryable) {
    throw new RetryableJobError(error.message, { incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
  }
  const message = error instanceof Error ? error.message : "Anime Music Fetcher failed";
  await repo.recordProviderState(batchId, { state: "FAILED", lastError: message }, now);
}
function assertNever(value: never): never { throw new Error(`Unknown AMF status: ${String(value)}`); }
