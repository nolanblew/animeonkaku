import type { JobQueue } from "../../jobs/jobQueue.js";
import { JobPriority } from "../../jobs/types.js";
import type { MusicRequestSource } from "../requests/types.js";
import type { MusicSearchMode, MusicSearchSettingsDto, MusicSearchSettingsRecord, MusicSearchSettingsRepository } from "./types.js";

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
    await this.enqueueReconciliation();
    return toDto(updated);
  }

  async enqueueReconciliation(priority: number = JobPriority.MAINTENANCE): Promise<boolean> {
    return (await this.enqueueReconciliationWithKey(priority, "RECONCILE_MUSIC_SEARCH_POLICY")) !== null;
  }

  /** Queue a library-import follow-up independently of the periodic scan. */
  async enqueueImportReconciliation(): Promise<boolean> {
    const importKey = "RECONCILE_MUSIC_SEARCH_POLICY:IMPORT";
    const queued = await this.enqueueReconciliationWithKey(
      JobPriority.NORMAL,
      importKey,
    );
    if (queued === null) return false;

    // A same-key enqueue returns the RUNNING record while a worker is already
    // scanning. Preserve one bounded follow-up so an import that completes
    // during that scan is not lost to queue deduplication.
    if (queued.state === "RUNNING") {
      await this.enqueueReconciliationWithKey(JobPriority.NORMAL, `${importKey}:FOLLOWUP`);
    }
    return true;
  }

  private async enqueueReconciliationWithKey(priority: number, dedupeKey: string) {
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
      maxAttempts: 5,
    });
  }

  async reconcile(): Promise<{ mode: MusicSearchMode; queued: number }> {
    const { mode } = await this.deps.repo.getMode();
    if (mode === "MANUAL") return { mode, queued: 0 };
    const eligible = await this.deps.repo.listEligibleAnime(mode);
    for (const anime of eligible) await this.deps.requests.trigger(anime.userId, anime.kitsuId, "AUTOMATIC");
    return { mode, queued: eligible.length };
  }
}

function toDto(record: MusicSearchSettingsRecord): MusicSearchSettingsDto {
  return { mode: record.mode, updatedAt: record.updatedAt.toISOString() };
}
