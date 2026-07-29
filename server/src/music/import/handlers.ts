import type { JobHandler } from "../../jobs/types.js";
import { RetryableJobError } from "../../jobs/jobWorker.js";
import { MusicImportValidationError, type MusicAcquisitionImportService } from "./service.js";

export function createMusicImportHandlers(input: { enabled: boolean; service: MusicAcquisitionImportService }): Record<"IMPORT_MUSIC_AUDIO", JobHandler> {
  return {
    IMPORT_MUSIC_AUDIO: async (payload, job) => {
      if (!input.enabled) throw new RetryableJobError("Music discovery is disabled", { incrementAttempts: false, retryAfterMs: 24 * 60 * 60_000 });
      const acquisitionId = positiveInteger(payload.acquisitionId, "acquisitionId");
      try {
        await input.service.importAcquisition(acquisitionId);
      } catch (error) {
        // The queue permanently fails this invocation when its next increment
        // reaches maxAttempts. Mirror that terminal boundary into acquisition
        // state so startup recovery cannot resurrect finite operational retry.
        if (!(error instanceof MusicImportValidationError) && job.attempts + 1 >= job.maxAttempts) {
          await input.service.markOperationalFailed(acquisitionId, error instanceof Error ? error.message : String(error));
        }
        throw error;
      }
    },
  };
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  throw new Error(`Invalid ${name} in job payload`);
}
