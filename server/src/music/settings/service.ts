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

  async enqueueReconciliation(): Promise<void> {
    await this.deps.queue.enqueue({
      type: "RECONCILE_MUSIC_SEARCH_POLICY",
      priority: JobPriority.MAINTENANCE,
      dedupeKey: "RECONCILE_MUSIC_SEARCH_POLICY",
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
