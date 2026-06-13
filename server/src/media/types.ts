export type MediaKind = "AUDIO" | "ANIME_POSTER" | "ANIME_COVER" | "ARTIST_IMAGE";
export type MediaState = "MISSING" | "QUEUED" | "DOWNLOADING" | "READY" | "FAILED";

export interface MediaFileRecord {
  id: number;
  kind: MediaKind;
  refId: string;
  originUrl: string;
  state: MediaState;
  filePath: string | null;
  byteSize: number | null;
  sha256: string | null;
  errorMessage: string | null;
  attempts: number;
  fetchedAt: Date | null;
  updatedAt: Date;
  videoFallback: boolean;
}

export interface SaveMediaFileInput {
  kind: MediaKind;
  refId: string;
  originUrl: string;
  filePath: string;
  videoFallback: boolean;
}

export interface MediaFileRepo {
  markDownloading(input: SaveMediaFileInput): Promise<void>;
  markReady(input: SaveMediaFileInput & { byteSize: number; sha256: string }): Promise<void>;
  markFailed(input: SaveMediaFileInput & { errorMessage: string }): Promise<void>;
}

