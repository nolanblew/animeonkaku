import type { AnimeMusicFetcherClient } from "../animeMusicFetcher/client.js";
import { AnimeMusicFetcherError } from "../animeMusicFetcher/errors.js";
import type { AmfJob, AmfJobStatus } from "../animeMusicFetcher/schemas.js";
import type { JobQueue } from "../../jobs/jobQueue.js";
import { RetryableJobError } from "../../jobs/jobWorker.js";
import { JobPriority, type JobHandler } from "../../jobs/types.js";
import {
  adoptFollowUpJobs,
  isProviderGraphTerminal,
  projectProviderJobEvidence,
  seedRootProviderJob,
} from "./providerGraph.js";
import type { MusicBatchState, MusicRequestRepository, StoredMusicBatch, StoredMusicBatchManifest, StoredProviderJobLink } from "./types.js";

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

/** One provider job observed during a single poll tick. */
interface ObservedProviderJob { link: StoredProviderJobLink; job: AmfJob }

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
      // Seed the graph with the root we just created. A brand new job has no
      // follow-ups yet; discovery happens on the polls that follow.
      const root = seedRootProviderJob({ ...batch, amfJobId: providerJob.id })!;
      const schedule = nextPollSchedule(batch, [{ link: root, job: providerJob }], nowTs);
      if (shouldPersistEvidence(providerJob) && schedule.changed) await deps.repo.recordProviderEvidence(batch.id, providerJob, nowTs);
      await deps.repo.recordProviderState(batch.id, { ...providerUpdate(providerJob), pollBackoffStep: schedule.backoffStep, pollNotBefore: schedule.notBefore }, nowTs);
      await deps.repo.saveProviderJobs(batch.id, [observedLink(root, providerJob, nowTs)], nowTs);
      if (hasImportableEvidence(providerJob)) await importBatch(batch.id);
      if (!isTerminal(providerJob.status)) await poll(batch.id, schedule.delayMs);
    },
    /**
     * Polls the batch's whole provider job graph, not a single job.
     *
     * One queue job per batch walks every known provider job, discovers newly
     * delegated children transitively (a child can itself delegate), attributes
     * each child's single-item result back onto the parent batch item, and only
     * lets the batch be provider-terminal once the root *and every descendant*
     * are terminal. See MC-S13 / finding F1.
     */
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

      const graph = await loadGraph(deps.repo, batch);
      const known = new Map(graph.map((link) => [link.amfJobId, link]));
      // Breadth-first over the persisted graph. `pending` grows as follow-ups
      // are discovered, so a child that itself delegates is walked in the same
      // tick; `known` doubles as the visited set, which is what makes a cycle
      // (a child pointing back at an ancestor) terminate immediately.
      const pending = [...graph];
      const observed: ObservedProviderJob[] = [];
      const touched: StoredProviderJobLink[] = [];
      let rootJob: AmfJob | null = null;
      for (let index = 0; index < pending.length; index += 1) {
        const link = pending[index]!;
        if (link.goneAt) continue;
        let job: AmfJob;
        try { job = await deps.client.getJob(link.amfJobId); }
        catch (error) {
          // The root keeps the exact pre-MC-S13 error semantics, including
          // returning without rescheduling; only a child's failure is
          // contained so it cannot destroy the batch.
          if (link.role === "ROOT") { await handleProviderError(deps.repo, batch.id, error, nowTs); return; }
          if (await handleFollowUpProviderError(batch.id, link, error) === "GONE") {
            touched.push({ ...link, goneAt: nowTs, lastPolledAt: nowTs });
          }
          continue;
        }
        observed.push({ link, job });
        if (link.role === "ROOT") rootJob = job;
        const adoption = adoptFollowUpJobs(link, job, known);
        if (adoption.truncated) {
          console.warn(`[amf] batch ${batch.id} reached the provider follow-up bound; refusing further adoption from job ${link.amfJobId}`);
        }
        pending.push(...adoption.adopted);
        touched.push(observedLink(link, job, nowTs));
      }
      const schedule = nextPollSchedule(batch, observed, nowTs);
      // Evidence is written *before* the per-job manifests that gate it, for
      // the same reason it has always preceded `recordProviderState`: the
      // "unchanged" comparison is what suppresses the next write, so
      // persisting the manifest first would make a crash in between lose the
      // evidence permanently. Adoption is the opposite — it is rediscovered
      // from the parent's `follow_up_jobs` on the next tick — so the graph is
      // saved after.
      //
      // Parents before children: `observed` is in breadth-first order, so a
      // parent's `delegated` item result is written first and the child's own
      // (authoritative) result for that item overwrites it in the same tick.
      for (const entry of observed) {
        if (!shouldPersistEvidence(entry.job)) continue;
        if (!manifestChanged(entry.link.manifestEvidence, entry.job)) continue;
        if (!sharesBatchDestination(batch, entry)) {
          console.warn(`[amf] provider job ${entry.job.id} reports destination outside batch ${batch.id}; refusing to attribute its evidence`);
          continue;
        }
        const projected = projectProviderJobEvidence(entry.link, entry.job);
        if (!projected) continue;
        // A root's scope is the whole batch, which is precisely what omitting
        // the argument has always meant — call it the old way so the root
        // evidence path is literally unchanged.
        if (projected.scope.itemIndexes === null) await deps.repo.recordProviderEvidence(batch.id, projected.job, nowTs);
        else await deps.repo.recordProviderEvidence(batch.id, projected.job, nowTs, projected.scope);
      }

      // Carry forward every link this tick did not observe (already gone, or
      // unreachable) so a newly adopted child is never lost.
      const touchedIds = new Set(touched.map((link) => link.amfJobId));
      for (const link of known.values()) if (!touchedIds.has(link.amfJobId)) touched.push(link);
      await deps.repo.saveProviderJobs(batch.id, touched, nowTs);

      if (!rootJob) {
        // The root is retired (404 on an earlier tick) but descendants remain.
        if (observed.length === 0) return;
        throw new RetryableJobError("AMF batch root is gone but descendants remain", { incrementAttempts: false, retryAfterMs: schedule.delayMs });
      }

      const graphTerminal = isProviderGraphTerminal(touched, isTerminal);
      await deps.repo.recordProviderState(batch.id, {
        ...providerUpdate(rootJob),
        state: graphState(rootJob, observed, graphTerminal),
        pollBackoffStep: schedule.backoffStep, pollNotBefore: schedule.notBefore,
      }, nowTs);
      if (observed.some((entry) => hasImportableEvidence(entry.job))) await importBatch(batch.id);
      // Provider-terminal only when the whole graph is terminal. The live state
      // of root ef75e439 — completed_with_warnings with four children still
      // awaiting_selection — must keep polling, not settle.
      if (graphTerminal) return;
      throw new RetryableJobError("AMF batch is still active", { incrementAttempts: false, retryAfterMs: schedule.delayMs });
    },
  };
}

async function loadGraph(repo: MusicRequestRepository, batch: StoredMusicBatch): Promise<StoredProviderJobLink[]> {
  const persisted = await repo.listProviderJobs(batch.id);
  if (persisted.length > 0) return persisted;
  // Adoption path for every batch submitted before MC-S13: it has an
  // `amf_job_id` but no graph. Seed the root and let this tick discover the
  // children AMF already created for it.
  const root = seedRootProviderJob(batch);
  return root ? [root] : [];
}

function observedLink(link: StoredProviderJobLink, job: AmfJob, now: Date): StoredProviderJobLink {
  return { ...link, providerStatus: job.status, destination: job.destination, lastPolledAt: now,
    manifestEvidence: { status: job.status, itemResults: job.item_results, deliveries: job.deliveries } };
}

/**
 * Children share their parent's `destination` (34/34 on the live controller),
 * which is what keeps `validateAmfDeliveryFile`'s `expectedPrefix` containment
 * check valid for child deliveries. This asserts it rather than assuming it:
 * a job claiming a destination outside the batch's own staging directory has
 * its evidence refused instead of being allowed to smuggle paths past the
 * containment check.
 */
function sharesBatchDestination(batch: StoredMusicBatch, entry: ObservedProviderJob): boolean {
  const expected = batch.body?.destination;
  return typeof expected !== "string" || expected.length === 0 || entry.job.destination === expected;
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
 * The batch state for a whole graph.
 *
 * When the graph is terminal the root decides, exactly as before MC-S13. While
 * any descendant is still live the batch is downgraded to the strongest
 * non-terminal signal present, so a `completed_with_warnings` root cannot set
 * `completed_at` out from under four `awaiting_selection` children. A single
 * failed or cancelled *child* deliberately never fails the batch: that child's
 * item is already marked through the normal item-level machinery, and
 * `finishBatch` settles the batch from item state.
 */
function graphState(rootJob: AmfJob, observed: ObservedProviderJob[], graphTerminal: boolean): MusicBatchState {
  const rootState = mapStatus(rootJob.status);
  if (graphTerminal) return rootState;
  const states = observed.map((entry) => mapStatus(entry.job.status));
  for (const candidate of ["AWAITING_OPERATOR", "PROCESSING", "DOWNLOADING", "SEARCHING", "QUEUED"] as const) {
    if (states.includes(candidate)) return candidate;
  }
  // Every observed job is terminal but some unobserved descendant is not:
  // keep the batch in the non-terminal, non-failing, operator-visible bucket.
  return "AWAITING_OPERATOR";
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
function shouldPersistEvidence(job: AmfJob) {
  return job.item_results.length > 0 || job.deliveries.length > 0 || !AMF_MACHINE_ACTIVE_STATUSES.has(job.status);
}
/**
 * Decides the next poll delay (MC-S16, extended by MC-S13 to a job graph).
 *
 * The ladder stays *per batch*, not per provider job: the scheduler unit is
 * the `POLL_AMF_MUSIC_BATCH:{batchId}` queue job, which services the whole
 * graph in one tick, so the only cadence it can honour is the fastest one any
 * member wants. Machine-active statuses therefore always poll at the fast 5s
 * cadence, and the ladder advances only when *every* member is dormant and no
 * member's manifest changed — resetting to step 0 the moment any of them does.
 * Ladder state continues to live on the batch row, where `attempts = 0` on a
 * queue re-enqueue cannot wipe it.
 */
function nextPollSchedule(previous: StoredMusicBatch, observed: ObservedProviderJob[], now: Date): { delayMs: number; backoffStep: number; notBefore: Date; changed: boolean } {
  const changed = observed.some((entry) => manifestChanged(entry.link.manifestEvidence, entry.job));
  const machineActive = observed.some((entry) => AMF_MACHINE_ACTIVE_STATUSES.has(entry.job.status));
  const backoffStep = machineActive || changed ? 0 : Math.min(previous.pollBackoffStep + 1, AMF_POLL_BACKOFF_LADDER_MS.length - 1);
  const delayMs = machineActive ? AMF_POLL_INTERVAL_MS : AMF_POLL_BACKOFF_LADDER_MS[backoffStep]!;
  return { delayMs, backoffStep, notBefore: new Date(now.getTime() + delayMs), changed };
}
function manifestChanged(previous: StoredMusicBatchManifest, job: AmfJob): boolean {
  return !(deepEqual(previous.status, job.status) && deepEqual(previous.itemResults, job.item_results) && deepEqual(previous.deliveries, job.deliveries));
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

/**
 * A *child* job failing must never destroy the batch: a 404 retires that one
 * link (the provider no longer holds it, so there is nothing left to observe
 * for it), and anything else is logged and left non-terminal so the child
 * keeps being observed. A retryable error still aborts the whole tick, so a
 * partially observed graph is never mistaken for a terminal one.
 */
async function handleFollowUpProviderError(batchId: string, link: StoredProviderJobLink, error: unknown): Promise<"GONE" | "LIVE"> {
  if (error instanceof AnimeMusicFetcherError && error.retryable) {
    throw new RetryableJobError(error.message, { incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
  }
  if (error instanceof AnimeMusicFetcherError && error.code === "NOT_FOUND") {
    console.warn(`[amf] follow-up job ${link.amfJobId} is no longer held by the provider; retiring it from batch ${batchId}`);
    return "GONE";
  }
  console.warn(`[amf] follow-up job ${link.amfJobId} could not be polled for batch ${batchId}: ${error instanceof Error ? error.message : String(error)}`);
  return "LIVE";
}
