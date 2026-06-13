import { RetryableJobError } from "../jobs/jobWorker.js";
import type { JobHandler } from "../jobs/types.js";
import type { MediaCatalogLookup } from "./catalogLookup.js";
import type { MediaStore } from "./mediaStore.js";
import type { MediaKind } from "./types.js";

const DEFAULT_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;

export class DiskSpaceLowError extends RetryableJobError {
  constructor(freeBytes: number, minFreeBytes: number) {
    super(`Media disk free space ${freeBytes} is below required ${minFreeBytes}`, {
      incrementAttempts: false,
      retryAfterMs: 10 * 60_000,
    });
    this.name = "DiskSpaceLowError";
  }
}

export interface FetchMediaHandlersDeps {
  mediaStore: MediaStore;
  catalog: MediaCatalogLookup;
  getDiskFreeBytes: () => Promise<number>;
  minFreeBytes?: number;
}

export function createFetchMediaHandlers(deps: FetchMediaHandlersDeps): {
  FETCH_AUDIO: JobHandler;
  FETCH_IMAGE: JobHandler;
} {
  const minFreeBytes = deps.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;

  return {
    FETCH_AUDIO: async (payload) => {
      await assertDiskFree(deps.getDiskFreeBytes, minFreeBytes);
      const themeId = requiredNumber(payload.themeId, "themeId");
      const audio = await deps.catalog.findThemeAudio(themeId);
      if (!audio) throw new RetryableJobError(`No theme audio source found for ${themeId}`);
      const videoFallback =
        audio.videoOriginUrl !== null && audio.audioOriginUrl === audio.videoOriginUrl;
      await deps.mediaStore.fetchToMediaFile({
        kind: "AUDIO",
        refId: String(themeId),
        originUrl: audio.audioOriginUrl,
        filePath: `audio/${themeId}.ogg`,
        videoFallback,
      });
    },
    FETCH_IMAGE: async (payload) => {
      await assertDiskFree(deps.getDiskFreeBytes, minFreeBytes);
      const kind = requiredImageKind(payload.kind);
      const refId = requiredString(payload.refId, "refId");
      const image = await deps.catalog.findImage(kind, refId);
      if (!image) throw new RetryableJobError(`No ${kind} source found for ${refId}`);
      await deps.mediaStore.fetchToMediaFile({
        kind,
        refId,
        originUrl: image.originUrl,
        filePath: imageFilePath(kind, refId),
        videoFallback: false,
      });
    },
  };
}

async function assertDiskFree(getDiskFreeBytes: () => Promise<number>, minFreeBytes: number): Promise<void> {
  const freeBytes = await getDiskFreeBytes();
  if (freeBytes < minFreeBytes) {
    throw new DiskSpaceLowError(freeBytes, minFreeBytes);
  }
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new RetryableJobError(`Invalid ${name} in job payload`);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new RetryableJobError(`Invalid ${name} in job payload`);
}

function requiredImageKind(value: unknown): Exclude<MediaKind, "AUDIO"> {
  if (value === "ANIME_POSTER" || value === "ANIME_COVER" || value === "ARTIST_IMAGE") {
    return value;
  }
  throw new RetryableJobError("Invalid image kind in job payload");
}

function imageFilePath(kind: Exclude<MediaKind, "AUDIO">, refId: string): string {
  if (kind === "ANIME_POSTER") return `images/anime/${refId}/poster.jpg`;
  if (kind === "ANIME_COVER") return `images/anime/${refId}/cover.jpg`;
  return `images/artists/${refId}.jpg`;
}

