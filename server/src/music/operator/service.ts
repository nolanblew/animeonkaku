import type { AnimeMusicFetcherClient } from "../animeMusicFetcher/client.js";
import type { JobQueue } from "../../jobs/jobQueue.js";
import { JobPriority } from "../../jobs/types.js";
import type { MusicOperatorAction, MusicOperatorApiService, MusicOperatorRepository } from "./types.js";

export class MusicOperatorNotFoundError extends Error {}
export class MusicOperatorConflictError extends Error {}

export class MusicOperatorService implements MusicOperatorApiService {
  constructor(private readonly deps: { repo: MusicOperatorRepository; queue: JobQueue;
    client: Pick<AnimeMusicFetcherClient, "getHealth" | "getReadiness">;
    stagingMountConfigured: boolean; automaticDiscoveryEnabled: boolean; diagnosticTimeoutMs?: number }) {}

  async diagnostics() {
    const [health, readiness, requests] = await Promise.all([
      this.settle(() => this.deps.client.getHealth()), this.settle(() => this.deps.client.getReadiness()), this.deps.repo.countRequests(),
    ]);
    const healthOk = health.ok && health.value.status.toLowerCase() === "ok";
    const ready = readiness.ok && readiness.value.status.toLowerCase() === "ready";
    return { provider: { status: health.ok ? (healthOk && ready ? "READY" : "DEGRADED") : "UNAVAILABLE",
      health: healthOk, ready, components: readiness.ok ? { database: readiness.value.database,
        prowlarrConfigured: readiness.value.prowlarr_configured, customSourceCount: readiness.value.custom_source_count,
        qbittorrentConfigured: readiness.value.qbittorrent_configured } : null },
      animeOngaku: { requests, automaticDiscoveryEnabled: this.deps.automaticDiscoveryEnabled,
        stagingMountConfigured: this.deps.stagingMountConfigured } };
  }

  listRequests() { return this.deps.repo.listRequests(); }

  async enqueueAction(batchId: string, action: MusicOperatorAction) {
    const target = await this.deps.repo.findBatchTarget(batchId);
    if (!target) throw new MusicOperatorNotFoundError();
    let type: "SUBMIT_AMF_MUSIC_BATCH" | "OPERATE_AMF_MUSIC_BATCH";
    let mode: "SUBMISSION" | "PROVIDER";
    if (action === "RETRY_PROVIDER" && target.state === "FAILED" && !target.amfJobId) { type = "SUBMIT_AMF_MUSIC_BATCH"; mode = "SUBMISSION"; }
    else {
      const permitted = action === "RETRY_PROVIDER" ? ["failed", "download_stalled"]
        : action === "CANCEL_PROVIDER" ? ["queued", "searching", "awaiting_selection", "selected", "submitting", "downloading", "processing", "awaiting_file_selection"]
        : ["completed_with_warnings"];
      if (!target.amfJobId || !target.providerStatus || !permitted.includes(target.providerStatus)) throw new MusicOperatorConflictError();
      type = "OPERATE_AMF_MUSIC_BATCH"; mode = "PROVIDER";
    }
    await this.deps.queue.enqueue({ type, priority: JobPriority.NORMAL, payload: type === "OPERATE_AMF_MUSIC_BATCH" ? { batchId, action } : { batchId },
      dedupeKey: `${type}:${batchId}${type === "OPERATE_AMF_MUSIC_BATCH" ? `:${action}` : ""}`, maxAttempts: 8 });
    return { batchId, action, mode, state: "QUEUED" };
  }

  async cleanupEligibility(batchId: string) {
    const result = await this.deps.repo.cleanupEligibility(batchId);
    if (!result.exists) throw new MusicOperatorNotFoundError();
    return { batchId, mode: "DRY_RUN_ONLY", eligible: result.eligible, verifiedFileCount: result.verifiedFileCount,
      reason: result.eligible ? "Matching READY canonical media records exist; verify current file bytes before manual host cleanup."
        : "Staging cleanup is not eligible because every active delivery is not proven ready and verified." };
  }

  private async settle<T>(call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        call().then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
        new Promise<{ ok: false }>((resolve) => { timeout = setTimeout(() => resolve({ ok: false }), this.deps.diagnosticTimeoutMs ?? 3_000); }),
      ]);
      return result;
    } finally { if (timeout) clearTimeout(timeout); }
  }
}
