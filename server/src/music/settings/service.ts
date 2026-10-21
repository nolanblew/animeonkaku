import type { JobQueue } from "../../jobs/jobQueue.js";
import { DURABLE_MAX_ATTEMPTS, JobPriority } from "../../jobs/types.js";
import type { MusicRequestSource } from "../requests/types.js";
import type { EligibleAnime, MusicSearchMode, MusicSearchSettingsDto, MusicSearchSettingsRecord, MusicSearchSettingsRepository } from "./types.js";

export type { MusicSearchMode } from "./types.js";

interface AutomaticMusicRequestService {
  trigger(userId: string, kitsuId: string, source: MusicRequestSource): Promise<unknown>;
}

export class MusicSearchPolicyService {
  constructor(private readonly deps: {
    repo: MusicSearchSettingsRepository;
    queue: Pick<JobQueue, "enqueue">;
    requests: AutomaticMusicRequestService;
  }) {}

  async getSettings(): Promise<MusicSearchSettingsDto> {
    return toDto(await this.deps.repo.getMode());
  }

  async updateMode(mode: MusicSearchMode): Promise<MusicSearchSettingsDto> {
    const updated = await this.deps.repo.setMode(mode);
    await this.enqueueReconciliationWithKey(JobPriority.MAINTENANCE, "RECONCILE_MUSIC_SEARCH_POLICY", true);
    return toDto(updated);
  }

  async enqueueReconciliation(priority: number = JobPriority.MAINTENANCE): Promise<boolean> {
    return (await this.enqueueReconciliationWithKey(priority, "RECONCILE_MUSIC_SEARCH_POLICY")) !== null;
  }

  /** Queue a library-import follow-up independently of the periodic scan. */
  async enqueueImportReconciliation(): Promise<boolean> {
    return (await this.enqueueReconciliationWithKey(
      JobPriority.NORMAL,
      "RECONCILE_MUSIC_SEARCH_POLICY:IMPORT",
      true,
    )) !== null;
  }

  private async enqueueReconciliationWithKey(priority: number, dedupeKey: string, rerunIfRunning = false) {
    // Manual mode intentionally leaves the queue quiet. This method is also
    // called from library mapping hooks, so creating a no-op reconciliation
    // job for every mapped anime would add durable queue churn without ever
    // requesting music.
    const { mode } = await this.deps.repo.getMode();
    if (mode === "MANUAL") return null;
    return this.deps.queue.enqueue({
      type: "RECONCILE_MUSIC_SEARCH_POLICY",
      priority,
      dedupeKey,
      maxAttempts: DURABLE_MAX_ATTEMPTS,
      preserveRetryState: true,
      rerunIfRunning,
    });
  }

  async reconcile(): Promise<{ mode: MusicSearchMode; queued: number }> {
    const { mode } = await this.deps.repo.getMode();
    if (mode === "MANUAL") return { mode, queued: 0 };
    const eligible = await this.deps.repo.listEligibleAnime(mode);
    // Each anime owns its retry state. A malformed request or provider failure
    // cannot repeatedly starve the rest of the policy's eligible anime.
    const outcomes = await Promise.allSettled(eligible.map((anime) => this.deps.queue.enqueue({
      type: "RECONCILE_MUSIC_SEARCH_POLICY",
      priority: JobPriority.NORMAL,
      payload: { userId: anime.userId, kitsuId: anime.kitsuId },
      dedupeKey: `RECONCILE_MUSIC_SEARCH_POLICY:ANIME:${anime.userId}:${anime.kitsuId}`,
      maxAttempts: DURABLE_MAX_ATTEMPTS,
      preserveRetryState: true,
    })));
    const failures = outcomes.flatMap((outcome, index) => outcome.status === "rejected"
      ? [new Error(`Could not queue automatic music for Kitsu ${eligible[index]!.kitsuId}: ${String(outcome.reason)}`)] : []);
    if (failures.length > 0) throw new AggregateError(failures, failures.map((error) => error.message).join("; "));
    return { mode, queued: eligible.length };
  }

  async reconcileAnime(anime: EligibleAnime): Promise<void> {
    // Policy membership can change while this job is backing off. Recheck
    // exclusions and mode before any acquisition, retaining existing request
    // items so retries can replay their persisted batches idempotently.
    const { mode } = await this.deps.repo.getMode();
    if (mode === "MANUAL") return;
    const eligible = await this.deps.repo.listEligibleAnime(mode, anime);
    if (!eligible.some((entry) => entry.userId === anime.userId && entry.kitsuId === anime.kitsuId)) return;
    await this.deps.requests.trigger(anime.userId, anime.kitsuId, "AUTOMATIC");
  }
}

function toDto(record: MusicSearchSettingsRecord): MusicSearchSettingsDto {
  return { mode: record.mode, updatedAt: record.updatedAt.toISOString() };
}
