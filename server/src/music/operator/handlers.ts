import type { AnimeMusicFetcherClient } from "../animeMusicFetcher/client.js";
import type { AmfJob } from "../animeMusicFetcher/schemas.js";
import type { JobQueue } from "../../jobs/jobQueue.js";
import { JobPriority, type JobHandler } from "../../jobs/types.js";
import type { MusicRequestRepository, MusicBatchState } from "../requests/types.js";
import type { MusicOperatorAction } from "./types.js";

export function createMusicOperatorHandlers(deps: { repo: MusicRequestRepository; queue: JobQueue;
  client: Pick<AnimeMusicFetcherClient, "retryJob" | "cancelJob" | "reprocessJob"> }): Record<"OPERATE_AMF_MUSIC_BATCH", JobHandler> {
  return { async OPERATE_AMF_MUSIC_BATCH(payload) {
    const batchId = typeof payload.batchId === "string" ? payload.batchId : "";
    const action = payload.action as MusicOperatorAction;
    const batch = await deps.repo.findBatch(batchId);
    if (!batch?.amfJobId) throw new Error("Persisted AMF batch identity is unavailable");
    const permitted = action === "RETRY_PROVIDER" ? ["failed", "download_stalled"]
      : action === "CANCEL_PROVIDER" ? ["queued", "searching", "awaiting_selection", "selected", "submitting", "downloading", "processing", "awaiting_file_selection"]
      : action === "REPROCESS_PROVIDER" ? ["completed_with_warnings"] : [];
    if (!batch.providerStatus || !permitted.includes(batch.providerStatus)) throw new Error("AMF operator action is stale for the current provider state");
    let result: AmfJob;
    if (action === "RETRY_PROVIDER") result = await deps.client.retryJob(batch.amfJobId);
    else if (action === "CANCEL_PROVIDER") result = await deps.client.cancelJob(batch.amfJobId);
    else if (action === "REPROCESS_PROVIDER") result = await deps.client.reprocessJob(batch.amfJobId);
    else throw new Error("Unsupported AMF operator action");
    const now = new Date();
    if (["completed", "completed_with_warnings", "failed", "cancelled", "awaiting_selection", "awaiting_file_selection", "download_stalled"].includes(result.status))
      await deps.repo.recordProviderEvidence(batch.id, result, now);
    const state = mapStatus(result.status);
    await deps.repo.recordProviderState(batch.id, { state, amfJobId: result.id, warningCount: result.warnings.length, lastError: null, providerStatus: result.status }, now);
    if (result.status === "completed" || result.status === "completed_with_warnings")
      await deps.queue.enqueue({ type: "IMPORT_AMF_MUSIC_BATCH", priority: JobPriority.NORMAL, payload: { batchId }, dedupeKey: `IMPORT_AMF_MUSIC_BATCH:${batchId}`, maxAttempts: 8 });
    else if (!["failed", "cancelled"].includes(result.status))
      await deps.queue.enqueue({ type: "POLL_AMF_MUSIC_BATCH", priority: JobPriority.NORMAL, payload: { batchId }, dedupeKey: `POLL_AMF_MUSIC_BATCH:${batchId}`, maxAttempts: 8 });
  } };
}

function mapStatus(status: AmfJob["status"]): MusicBatchState {
  if (status === "queued") return "QUEUED";
  if (["searching", "selected", "submitting"].includes(status)) return "SEARCHING";
  if (["awaiting_selection", "awaiting_file_selection", "download_stalled"].includes(status)) return "AWAITING_OPERATOR";
  if (status === "downloading") return "DOWNLOADING";
  if (["processing", "completed", "completed_with_warnings"].includes(status)) return "PROCESSING";
  if (status === "failed") return "FAILED";
  return "CANCELLED";
}
