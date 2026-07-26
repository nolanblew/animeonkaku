import type { AnimeMusicFetcherClient } from "../animeMusicFetcher/client.js";
import { AnimeMusicFetcherError } from "../animeMusicFetcher/errors.js";
import type { AmfJob, AmfJobStatus } from "../animeMusicFetcher/schemas.js";
import type { JobQueue } from "../../jobs/jobQueue.js";
import { RetryableJobError } from "../../jobs/jobWorker.js";
import { JobPriority, type JobHandler } from "../../jobs/types.js";
import type { MusicBatchState, MusicRequestRepository, StoredMusicBatch, StoredMusicBatchManifest } from "./types.js";

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

// MC-S16: escalating poll backoff for operator-wait/dormant statuses, capped
// at 20 minutes and held there indefinitely. Index 0 (5s) doubles as "just
// changed" / "never observed before" so a provider-document change always
// drops a batch straight back to the fast cadence within one interval.
const AMF_POLL_BACKOFF_LADDER_MS = [5_000, 30_000, 120_000, 300_000, 600_000, 1_200_000];

export function createMusicRequestHandlers(deps: { repo: MusicRequestRepository; queue: JobQueue; client: Pick<AnimeMusicFetcherClient, "submitJob" | "getJob">; now?: () => Date }): Record<"SUBMIT_AMF_MUSIC_BATCH" | "POLL_AMF_MUSIC_BATCH", JobHandler> {
  const now = deps.now ?? (() => new Date());
  const poll = async (batchId: string, delayMs?: number) => deps.queue.enqueue({ type: "POLL_AMF_MUSIC_BATCH", priority: JobPriority.NORMAL,
    payload: { batchId }, dedupeKey: `POLL_AMF_MUSIC_BATCH:${batchId}`, maxAttempts: 8,
    ...(delayMs !== undefined ? { nextRunAt: new Date(now().getTime() + delayMs) } : {}) });
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
      const nowTs = now();
      const schedule = nextPollSchedule(batch, providerJob, nowTs);
      if (shouldPersistEvidence(providerJob) && schedule.changed) await deps.repo.recordProviderEvidence(batch.id, providerJob, nowTs);
      await deps.repo.recordProviderState(batch.id, { ...providerUpdate(providerJob), pollBackoffStep: schedule.backoffStep, pollNotBefore: schedule.notBefore }, nowTs);
      if (hasImportableEvidence(providerJob)) await importBatch(batch.id);
      if (!isTerminal(providerJob.status)) await poll(batch.id, schedule.delayMs);
    },
    async POLL_AMF_MUSIC_BATCH(payload) {
      const batch = await requireBatch(deps.repo, payload);
      if (!batch.amfJobId) throw new RetryableJobError("AMF submission identity is not persisted yet", { incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
      const nowTs = now();
      if (batch.pollNotBefore && batch.pollNotBefore.getTime() > nowTs.getTime()) {
        // The durable queue can redeliver this job earlier than the ladder
        // intends — most notably MusicRequestService.recheckIncomplete's
        // 15-minute sweep, which re-enqueues against the same dedupe key and,
        // per PgJobRepository's upsert, pulls next_run_at forward to now and
        // resets the job's own `attempts` to 0. The ladder position lives on
        // the batch (see StoredMusicBatch.pollBackoffStep), not the job, so a
        // wake-up this early is a cheap no-op: reschedule for what remains
        // without ever contacting the provider or touching persisted state.
        throw new RetryableJobError("AMF batch poll is not due yet", { incrementAttempts: false, retryAfterMs: batch.pollNotBefore.getTime() - nowTs.getTime() });
      }
      let providerJob: AmfJob;
      try { providerJob = await deps.client.getJob(batch.amfJobId); }
      catch (error) { await handleProviderError(deps.repo, batch.id, error, nowTs); return; }
      const schedule = nextPollSchedule(batch, providerJob, nowTs);
      if (shouldPersistEvidence(providerJob) && schedule.changed) await deps.repo.recordProviderEvidence(batch.id, providerJob, nowTs);
      await deps.repo.recordProviderState(batch.id, { ...providerUpdate(providerJob), pollBackoffStep: schedule.backoffStep, pollNotBefore: schedule.notBefore }, nowTs);
      if (hasImportableEvidence(providerJob)) await importBatch(batch.id);
      if (isImportable(providerJob.status)) return;
      if (!isTerminal(providerJob.status)) throw new RetryableJobError("AMF batch is still active", { incrementAttempts: false, retryAfterMs: schedule.delayMs });
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
/**
 * Decides the next poll delay (MC-S16). Machine-active statuses always poll
 * at the fast 5s cadence. Everything else — operator-wait states, "archived",
 * and unrecognized statuses — walks `AMF_POLL_BACKOFF_LADDER_MS`, advancing
 * one step per consecutive poll that finds the manifest unchanged and
 * resetting to step 0 the moment it changes (status, item results, or
 * deliveries — matching what `recordProviderEvidence` actually persists).
 */
function nextPollSchedule(previous: StoredMusicBatch, job: AmfJob, now: Date): { delayMs: number; backoffStep: number; notBefore: Date; changed: boolean } {
  const changed = !manifestUnchanged(previous.manifestEvidence, job);
  const machineActive = AMF_MACHINE_ACTIVE_STATUSES.has(job.status);
  const backoffStep = machineActive || changed ? 0 : Math.min(previous.pollBackoffStep + 1, AMF_POLL_BACKOFF_LADDER_MS.length - 1);
  const delayMs = machineActive ? AMF_POLL_INTERVAL_MS : AMF_POLL_BACKOFF_LADDER_MS[backoffStep]!;
  return { delayMs, backoffStep, notBefore: new Date(now.getTime() + delayMs), changed };
}
function manifestUnchanged(previous: StoredMusicBatchManifest, job: AmfJob): boolean {
  return deepEqual(previous.status, job.status) && deepEqual(previous.itemResults, job.item_results) && deepEqual(previous.deliveries, job.deliveries);
}
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as Record<string, unknown>), ...Object.keys(b as Record<string, unknown>)]);
    return [...keys].every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
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
