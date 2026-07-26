import type { AnimeMusicFetcherClient } from "../animeMusicFetcher/client.js";
import { AnimeMusicFetcherError } from "../animeMusicFetcher/errors.js";
import type { AmfJob, AmfJobStatus } from "../animeMusicFetcher/schemas.js";
import type { JobQueue } from "../../jobs/jobQueue.js";
import { RetryableJobError } from "../../jobs/jobWorker.js";
import { JobPriority, type JobHandler } from "../../jobs/types.js";
import type { MusicBatchState, MusicRequestRepository } from "./types.js";

export const AMF_POLL_INTERVAL_MS = 5_000;

// Statuses that represent AMF actively doing machine work on a job. Anything
// else (operator-wait states, "archived", or a status we don't recognize
// yet) is treated as a moment to persist evidence, since the provider
// document is unlikely to change on the next tick without outside action.
const AMF_MACHINE_ACTIVE_STATUSES = new Set([
  "queued", "searching", "selected", "submitting", "downloading", "processing",
]);
// The only statuses that end an Anime Ongaku batch's provider-side lifecycle.
// "archived" is deliberately absent: per product decision, archived means
// "closed for now", never "closed forever" — an archived job may still gain
// its songs, so it must stay in the poll loop and remain importable forever.
// A status this code has never seen before is treated the same way: it is
// NOT added here, so it falls through to "keep polling, never FAILED".
const AMF_TERMINAL_STATUSES = new Set(["completed", "completed_with_warnings", "failed", "cancelled"]);

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
      if (shouldPersistEvidence(providerJob)) await deps.repo.recordProviderEvidence(batch.id, providerJob, now());
      await deps.repo.recordProviderState(batch.id, providerUpdate(providerJob), now());
      if (hasImportableEvidence(providerJob)) await importBatch(batch.id);
      if (!isTerminal(providerJob.status)) await poll(batch.id);
    },
    async POLL_AMF_MUSIC_BATCH(payload) {
      const batch = await requireBatch(deps.repo, payload);
      if (!batch.amfJobId) throw new RetryableJobError("AMF submission identity is not persisted yet", { incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
      let providerJob: AmfJob;
      try { providerJob = await deps.client.getJob(batch.amfJobId); }
      catch (error) { await handleProviderError(deps.repo, batch.id, error, now()); return; }
      if (shouldPersistEvidence(providerJob)) await deps.repo.recordProviderEvidence(batch.id, providerJob, now());
      await deps.repo.recordProviderState(batch.id, providerUpdate(providerJob), now());
      if (hasImportableEvidence(providerJob)) await importBatch(batch.id);
      if (isImportable(providerJob.status)) return;
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
function providerUpdate(job: AmfJob): { state: MusicBatchState; amfJobId: string; warningCount: number; lastError: null; providerStatus: AmfJobStatus } {
  return { state: mapStatus(job.status), amfJobId: job.id, warningCount: job.warnings.length, lastError: null, providerStatus: job.status };
}
/**
 * Maps an AMF provider job status to our domain batch state.
 *
 * "archived" and any status this code has never seen before are both mapped
 * to AWAITING_OPERATOR deliberately: it is the existing non-terminal,
 * non-failing, operator-visible bucket, and isTerminal/isImportable below
 * already treat anything outside their explicit terminal set as "keep
 * polling forever" — exactly what a dormant provider status needs. A
 * genuinely unrecognized value is logged so contract drift is visible; the
 * raw status string itself is also captured verbatim on the batch via
 * recordProviderEvidence (see shouldPersistEvidence).
 */
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
    case "archived": return "AWAITING_OPERATOR";
    default:
      console.warn(`[amf] unrecognized provider job status "${status}" observed — treating as dormant: non-terminal, non-failing, operator-visible`);
      return "AWAITING_OPERATOR";
  }
}
function isTerminal(status: AmfJobStatus) { return AMF_TERMINAL_STATUSES.has(status); }
function isImportable(status: AmfJobStatus) { return status === "completed" || status === "completed_with_warnings"; }
function shouldPersistEvidence(job: AmfJob) {
  return job.item_results.length > 0 || job.deliveries.length > 0 || !AMF_MACHINE_ACTIVE_STATUSES.has(job.status);
}
function hasImportableEvidence(job: AmfJob) { return job.deliveries.some((delivery) => delivery.files.length > 0); }
async function handleProviderError(repo: MusicRequestRepository, batchId: string, error: unknown, now: Date): Promise<never | void> {
  if (error instanceof AnimeMusicFetcherError) {
    if (error.retryable) {
      throw new RetryableJobError(error.message, { incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
    }
    if (error.code === "NOT_FOUND") {
      // The provider no longer holds this job record — the only genuine
      // stop condition. Record it as operator-visible attention, never
      // FAILED: unrelated provider bookkeeping must never destroy an Anime
      // Ongaku request.
      await repo.recordProviderState(batchId, { state: "AWAITING_OPERATOR", lastError: error.message }, now);
      return;
    }
  }
  const message = error instanceof Error ? error.message : "Anime Music Fetcher failed";
  await repo.recordProviderState(batchId, { state: "FAILED", lastError: message }, now);
}
