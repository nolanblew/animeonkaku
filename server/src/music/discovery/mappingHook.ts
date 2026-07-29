import type { JobQueue } from "../../jobs/jobQueue.js";
import { JobPriority } from "../../jobs/types.js";
import { discoverAnimeMusicDedupeKey } from "./keys.js";
import type { MusicDiscoveryRepository } from "./types.js";

export function createAnimeMappedDiscoveryHook(input: {
  enabled: boolean;
  queue: JobQueue;
  repo: MusicDiscoveryRepository;
  now?: () => Date;
}): (animeIds: number[]) => Promise<void> {
  const now = input.now ?? (() => new Date());
  return async (animeIds) => {
    if (!input.enabled) return;
    // ensureAnime returns only newly-created state rows, preventing every
    // normal library remap from resetting a completed discovery job.
    for (const animeId of await input.repo.ensureAnime([...new Set(animeIds)], now())) {
      await input.queue.enqueue({ type: "DISCOVER_ANIME_MUSIC", priority: JobPriority.MAINTENANCE,
        payload: { animeId }, dedupeKey: discoverAnimeMusicDedupeKey(animeId) });
    }
  };
}
