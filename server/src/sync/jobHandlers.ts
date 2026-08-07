import type { JobHandler, JobRecord } from "../jobs/types.js";

interface SyncPipelineHandlers {
  runKitsuSync(input: { userId: string; full: boolean; job: JobRecord }): Promise<void>;
  runMapThemes(input: { kitsuIds: string[]; userId?: string; job: JobRecord }): Promise<void>;
  runBackfillScan(input: { userId?: string; job: JobRecord }): Promise<void>;
  runAutoPlaylistRefresh(input: { userId: string; job: JobRecord }): Promise<void>;
}

export function createSyncJobHandlers(pipeline: SyncPipelineHandlers): {
  KITSU_FULL_SYNC: JobHandler;
  KITSU_DELTA_SYNC: JobHandler;
  MAP_THEMES: JobHandler;
  BACKFILL_SCAN: JobHandler;
  AUTO_PLAYLIST_REFRESH: JobHandler;
} {
  return {
    KITSU_FULL_SYNC: async (payload, job) => {
      await pipeline.runKitsuSync({ userId: requiredString(payload.userId, "userId"), full: true, job });
    },
    KITSU_DELTA_SYNC: async (payload, job) => {
      await pipeline.runKitsuSync({ userId: requiredString(payload.userId, "userId"), full: false, job });
    },
    MAP_THEMES: async (payload, job) => {
      const input: { kitsuIds: string[]; userId?: string; job: JobRecord } = {
        kitsuIds: requiredStringArray(payload.kitsuIds, "kitsuIds"),
        job,
      };
      if (typeof payload.userId === "string" && payload.userId.length > 0) {
        input.userId = payload.userId;
      }
      await pipeline.runMapThemes(input);
    },
    BACKFILL_SCAN: async (payload, job) => {
      const input: { userId?: string; job: JobRecord } = { job };
      if (typeof payload.userId === "string" && payload.userId.length > 0) {
        input.userId = payload.userId;
      }
      await pipeline.runBackfillScan(input);
    },
    AUTO_PLAYLIST_REFRESH: async (payload, job) => {
      await pipeline.runAutoPlaylistRefresh({ userId: requiredString(payload.userId, "userId"), job });
    },
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Invalid ${name} in job payload`);
}

function requiredStringArray(value: unknown, name: string): string[] {
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0)) {
    return value;
  }
  throw new Error(`Invalid ${name} in job payload`);
}
