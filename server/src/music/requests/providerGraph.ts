import type { AmfJob } from "../animeMusicFetcher/schemas.js";
import type { ProviderEvidenceScope, StoredMusicBatch, StoredProviderJobLink } from "./types.js";

/**
 * MC-S13/F1 — the provider job graph.
 *
 * AMF splits work: when a multi-item request cannot confidently cover a
 * sibling item it creates a linked *single-item* follow-up job, marks the
 * parent's item `delegated`, and lists the child under `follow_up_jobs`. On
 * the live controller this is the majority of the graph (34 of 44 jobs).
 *
 * This module owns the pure parts of walking that graph: adoption with cycle
 * and fan-out bounds, and projecting a child job's evidence back onto the
 * parent batch item so the existing item/delivery/import machinery is reused
 * rather than duplicated.
 */

/**
 * Hard ceiling on provider jobs tracked per batch, root included. A buggy or
 * hostile provider must not be able to make us enqueue unboundedly: a batch
 * asks for at most 12 items, so even one re-delegation per item stays far
 * under this. Reaching the cap stops adoption; it never fails the batch.
 */
export const AMF_MAX_PROVIDER_JOBS_PER_BATCH = 64;

/**
 * Hard ceiling on delegation depth. A child can itself delegate (that is why
 * discovery is a graph walk, not one level), but a chain this long means the
 * provider is looping on an item rather than making progress.
 */
export const AMF_MAX_PROVIDER_JOB_DEPTH = 8;

/**
 * Size of each provider job's private `file_index` window inside a shared
 * batch item. Sibling follow-up jobs both number their deliveries from 0, and
 * `anime_music_request_deliveries` is keyed `(item_id, file_index)`, so
 * without a per-job offset two children of the same item would overwrite each
 * other. The root's ordinal is 0, so its offset is 0 and every delivery row
 * written before MC-S13 keeps its identity.
 *
 * 10_000 comfortably exceeds the largest observed single-job manifest (71
 * files) while `AMF_MAX_PROVIDER_JOBS_PER_BATCH * stride` stays below the
 * 1_000_000 base `releaseTrackDisplayOrder` uses for untracked files.
 */
export const AMF_PROVIDER_JOB_FILE_INDEX_STRIDE = 10_000;

export function providerJobFileIndexOffset(ordinal: number): number {
  return ordinal * AMF_PROVIDER_JOB_FILE_INDEX_STRIDE;
}

/**
 * The root link for a batch that has a submitted provider job but no persisted
 * graph yet. This is the adoption path for every batch that predates MC-S13:
 * the first poll seeds the root from `batches.amf_job_id`, polls it, and
 * discovers its existing children from `follow_up_jobs`.
 */
export function seedRootProviderJob(batch: StoredMusicBatch): StoredProviderJobLink | null {
  if (!batch.amfJobId) return null;
  return {
    batchId: batch.id, amfJobId: batch.amfJobId, role: "ROOT", ordinal: 0, depth: 0,
    parentAmfJobId: null, parentItemIndex: null, itemIndex: null, fileIndexOffset: 0,
    providerStatus: batch.providerStatus ?? null, destination: batch.body?.destination ?? null,
    manifestEvidence: batch.manifestEvidence, goneAt: null, lastPolledAt: null,
  };
}

export interface FollowUpAdoption {
  adopted: StoredProviderJobLink[];
  /** True when at least one follow-up was refused by the fan-out or depth bound. */
  truncated: boolean;
}

/**
 * Adopts the follow-up jobs a freshly observed job declares.
 *
 * Cycle safety: `known` is the set of provider job ids already in this batch's
 * graph, and every adoption is added to it immediately. A follow-up pointing
 * at an ancestor, a sibling, or at the job itself is therefore already known,
 * is never adopted a second time and never re-queued — the walk is over a set,
 * so it terminates whatever shape the provider claims.
 */
export function adoptFollowUpJobs(
  parent: StoredProviderJobLink,
  job: AmfJob,
  known: Map<string, StoredProviderJobLink>,
): FollowUpAdoption {
  const adopted: StoredProviderJobLink[] = [];
  let truncated = false;
  let nextOrdinal = 0;
  for (const link of known.values()) nextOrdinal = Math.max(nextOrdinal, link.ordinal + 1);
  for (const followUp of job.follow_up_jobs ?? []) {
    if (known.has(followUp.job_id)) continue;
    if (known.size >= AMF_MAX_PROVIDER_JOBS_PER_BATCH) { truncated = true; continue; }
    if (parent.depth + 1 > AMF_MAX_PROVIDER_JOB_DEPTH) { truncated = true; continue; }
    // A child is single-item, so it covers exactly one batch item: the one its
    // parent delegated. A grandchild inherits its parent's batch item, because
    // its own `parent_item_index` is relative to a job that itself has only
    // one item.
    const itemIndex = parent.itemIndex ?? followUp.requested_item_index;
    const ordinal = nextOrdinal++;
    const link: StoredProviderJobLink = {
      batchId: parent.batchId, amfJobId: followUp.job_id, role: "FOLLOW_UP", ordinal,
      depth: parent.depth + 1, parentAmfJobId: parent.amfJobId,
      parentItemIndex: followUp.requested_item_index, itemIndex,
      fileIndexOffset: providerJobFileIndexOffset(ordinal),
      providerStatus: null, destination: null,
      manifestEvidence: { status: null, itemResults: [], deliveries: [] },
      goneAt: null, lastPolledAt: null,
    };
    known.set(link.amfJobId, link);
    adopted.push(link);
  }
  return { adopted, truncated };
}

export interface ProjectedProviderEvidence { job: AmfJob; scope: ProviderEvidenceScope }

/**
 * Rewrites one provider job's evidence into the batch's coordinate system.
 *
 * A root job already speaks the batch's language, so it passes through with a
 * whole-batch scope — byte-for-byte the pre-MC-S13 behaviour.
 *
 * A follow-up job is single-item: its item index 0 means "the batch item my
 * parent delegated". Remapping it here, rather than teaching the repository
 * about child jobs, is what lets the existing item/delivery/import machinery
 * be reused unchanged — and it keeps `recordProviderEvidence`'s identity guard
 * meaningful, because the remapped kind/number must still match the persisted
 * item, and a child claiming more than one item still produces duplicate
 * indexes and still trips the guard.
 *
 * Returns `null` when the job has nothing to say (no item results and no
 * deliveries), so a freshly created child cannot blank out its parent item.
 */
export function projectProviderJobEvidence(link: StoredProviderJobLink, job: AmfJob): ProjectedProviderEvidence | null {
  const scope: ProviderEvidenceScope = {
    itemIndexes: link.itemIndex === null ? null : [link.itemIndex],
    fileIndexOffset: link.fileIndexOffset,
    fileIndexStride: AMF_PROVIDER_JOB_FILE_INDEX_STRIDE,
  };
  if (link.itemIndex === null) return { job, scope };
  if (job.item_results.length === 0 && job.deliveries.length === 0) return null;
  const itemIndex = link.itemIndex;
  return {
    scope,
    job: {
      ...job,
      item_results: job.item_results.map((result) => ({ ...result, requested_item_index: itemIndex })),
      deliveries: job.deliveries.map((delivery) => ({
        ...delivery,
        requested_item_index: itemIndex,
        files: delivery.files.map((file) => ({ ...file, file_index: file.file_index + link.fileIndexOffset })),
      })),
    },
  };
}

/**
 * The statuses that end a provider job's lifecycle. Imported from the handler
 * rather than redefined so MC-S14's decision — `archived` and any unrecognized
 * status are *dormant*, never terminal — governs graph terminality too.
 */
export function isProviderGraphTerminal(
  links: StoredProviderJobLink[],
  isTerminalStatus: (status: string) => boolean,
): boolean {
  return links.every((link) => link.goneAt !== null || (link.providerStatus !== null && isTerminalStatus(link.providerStatus)));
}
