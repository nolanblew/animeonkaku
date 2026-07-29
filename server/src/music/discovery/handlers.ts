import type { JobQueue } from "../../jobs/jobQueue.js";
import { RetryableJobError } from "../../jobs/jobWorker.js";
import { JobPriority, type JobHandler } from "../../jobs/types.js";
import { discoverAnimeMusicDedupeKey } from "./keys.js";
import {
  ACQUISITION_POLL_INTERVAL_MS,
  DISCOVERY_DAILY_LIMIT,
  type MusicDiscoveryRepository,
  type MusicDiscoveryWorkflow,
} from "./types.js";

export function createMusicDiscoveryHandlers(input: {
  enabled: boolean;
  queue: JobQueue;
  repo: MusicDiscoveryRepository;
  workflow: MusicDiscoveryWorkflow;
  now?: () => Date;
}): Record<"MUSIC_CATALOG_SCAN" | "DISCOVER_ANIME_MUSIC" | "RECONCILE_MUSIC_ACQUISITION", JobHandler> {
  const now = input.now ?? (() => new Date());
  const active = () => input.enabled;
  return {
    MUSIC_CATALOG_SCAN: async () => {
      if (!active()) throw pausedDiscovery();
      for (const state of await input.repo.listDue(now(), DISCOVERY_DAILY_LIMIT)) {
        await input.queue.enqueue({ type: "DISCOVER_ANIME_MUSIC", priority: JobPriority.MAINTENANCE,
          payload: { animeId: state.animethemesAnimeId }, dedupeKey: discoverAnimeMusicDedupeKey(state.animethemesAnimeId) });
      }
    },
    DISCOVER_ANIME_MUSIC: async (payload, job) => {
      if (!active()) throw pausedDiscovery();
      const animeId = positiveInteger(payload.animeId, "animeId");
      await input.repo.markRunning(animeId, now());
      try {
        const result = await input.workflow.discoverAnime({ animeId, job });
        await input.repo.markSucceeded(animeId, result, now());
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        await input.repo.markFailed(animeId, err.message, now());
        throw err;
      }
    },
    RECONCILE_MUSIC_ACQUISITION: async (payload, job) => {
      if (!active()) throw pausedDiscovery();
      const acquisitionId = positiveInteger(payload.acquisitionId, "acquisitionId");
      if (await input.workflow.reconcileAcquisition({ acquisitionId, job }) === "PENDING") {
        throw new RetryableJobError("Provider acquisition is still pending", {
          incrementAttempts: false,
          retryAfterMs: ACQUISITION_POLL_INTERVAL_MS,
        });
      }
    },
  };
}

function pausedDiscovery(): RetryableJobError {
  return new RetryableJobError("Music discovery is disabled", { incrementAttempts: false, retryAfterMs: 24 * 60 * 60_000 });
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  throw new Error(`Invalid ${name} in job payload`);
}
