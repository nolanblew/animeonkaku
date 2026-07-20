// The content class of a stored binary. AUDIO/VIDEO attach to a theme;
// the image kinds attach to anime/artist rows.
export type MediaKind = "AUDIO" | "VIDEO" | "ANIME_POSTER" | "ANIME_COVER" | "ARTIST_IMAGE";

// Which source/cut of a (kind, ref) a media row holds. Orthogonal to kind so a
// Catalog songs use ORIGINAL because the stored file is the accepted source
// recording; FULL_SIZE is a user-facing playback mode, not a storage variant.
// FULL remains for the pre-catalog media scaffold until its callers migrate.
// Images have no cut and use DEFAULT. See .planning/13-media-catalog-tdr.md.
export type MediaVariant = "SHORT" | "ORIGINAL" | "FULL" | "DEFAULT";

export type MediaState = "MISSING" | "QUEUED" | "DOWNLOADING" | "READY" | "FAILED";

/** Variant used for image kinds, which have only one source. */
export const IMAGE_VARIANT: MediaVariant = "DEFAULT";

/**
 * The canonical playable audio for a theme: the short (~90s) AnimeThemes cut.
 * `/v1/media/audio/{themeId}` resolves to this forever — never change it without
 * a new, separately-addressed route, or already-cached clients break.
 */
export const CANONICAL_AUDIO = { kind: "AUDIO", variant: "SHORT" } as const satisfies {
  kind: MediaKind;
  variant: MediaVariant;
};

/** Addresses one stored media variant of a reference (theme/anime/artist). */
export interface MediaDescriptor {
  kind: MediaKind;
  variant: MediaVariant;
  refId: string;
}

export interface MediaFileRecord {
  id: number;
  kind: MediaKind;
  refId: string;
  variant: MediaVariant;
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
  contentType?: string | null;
  sourceFileName?: string | null;
}

export interface SaveMediaFileInput {
  kind: MediaKind;
  refId: string;
  variant: MediaVariant;
  originUrl: string;
  filePath: string;
  videoFallback: boolean;
  contentType?: string | null;
  sourceFileName?: string | null;
}

export interface ImportLocalSongFileInput {
  songId: number;
  sourcePath: string;
}

export interface MediaFileRepo {
  markDownloading(input: SaveMediaFileInput): Promise<void>;
  markReady(input: SaveMediaFileInput & { byteSize: number; sha256: string }): Promise<void>;
  markFailed(input: SaveMediaFileInput & { errorMessage: string }): Promise<void>;
  /** Optional: lets MediaStore skip downloads for media that is already READY on disk. */
  find?(descriptor: MediaDescriptor): Promise<MediaFileRecord | null>;
}

