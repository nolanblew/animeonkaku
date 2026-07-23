import { z } from "zod";

export const AMF_JOB_STATUSES = [
  "queued",
  "searching",
  "awaiting_selection",
  "selected",
  "submitting",
  "downloading",
  "processing",
  "awaiting_file_selection",
  "completed",
  "completed_with_warnings",
  "download_stalled",
  "failed",
  "cancelled",
] as const;

export const amfJobStatusSchema = z.enum(AMF_JOB_STATUSES);
export const amfMusicKindSchema = z.enum([
  "OP",
  "ED",
  "OST",
  "CHARACTER_SONG",
  "DRAMA",
  "OTHER",
]);
export const amfMusicVersionSchema = z.enum(["ANY", "TV", "FULL"]);
export const amfReleasePreferenceSchema = z.enum(["ANY", "COLLECTION", "INDIVIDUAL"]);
export const amfSelectionModeSchema = z.enum(["automatic", "review"]);

const nullableTitleSchema = z.string().min(1).max(300).nullable().optional();

// AMF 0.2 returns these three keys even when a particular localization is not
// known. Keep the shape intact so an import can retain every value for a later
// language preference instead of baking a file tag into the catalog forever.
export const amfResponseTitlesSchema = z.object({
  english: nullableTitleSchema,
  japanese: nullableTitleSchema,
  romaji: nullableTitleSchema,
}).strict();

export const amfAnimeTitlesSchema = z.object({
  english: nullableTitleSchema,
  japanese: nullableTitleSchema,
  romaji: nullableTitleSchema,
  names: z.array(z.string().min(1).max(300)).max(20).optional(),
}).strict().refine(
  (titles) => Boolean(titles.english ?? titles.japanese ?? titles.romaji),
  "at least one primary anime title is required",
);

export const amfSongTitlesSchema = z.object({
  english: nullableTitleSchema,
  japanese: nullableTitleSchema,
  romaji: nullableTitleSchema,
}).strict().refine(
  (titles) => Boolean(titles.english ?? titles.japanese ?? titles.romaji),
  "at least one song title is required",
);

export const amfArtifactRequestSchema = z.object({
  kind: amfMusicKindSchema,
  number: z.number().int().min(1).max(99).nullable().optional(),
  version: amfMusicVersionSchema.optional(),
  release_preference: amfReleasePreferenceSchema.optional(),
  song_titles: amfSongTitlesSchema.nullable().optional(),
  album_titles: amfSongTitlesSchema.nullable().optional(),
  artists: z.array(z.string()).max(20).optional(),
  artist_names: z.array(amfResponseTitlesSchema).max(20).optional(),
  search_terms: z.array(z.string()).max(10).optional(),
}).strict();

export const amfQualityPreferencesSchema = z.object({
  preferred_formats: z.array(z.string()).max(10).optional(),
  prefer_lossless: z.boolean().optional(),
  min_seeders: z.number().int().nonnegative().nullable().optional(),
  min_size_bytes: z.number().int().nonnegative().nullable().optional(),
  max_size_bytes: z.number().int().positive().nullable().optional(),
  required_terms: z.array(z.string()).max(20).optional(),
  excluded_terms: z.array(z.string()).max(20).optional(),
}).strict().refine(
  (quality) => quality.min_size_bytes == null || quality.max_size_bytes == null
    || quality.min_size_bytes <= quality.max_size_bytes,
  "minimum size cannot exceed maximum size",
);

export const amfJobCreateSchema = z.object({
  titles: amfAnimeTitlesSchema,
  items: z.array(amfArtifactRequestSchema).min(1).max(12),
  metadata_lookup: z.boolean().optional(),
  anilist_id: z.number().int().positive().nullable().optional(),
  animethemes_slug: nullableTitleSchema,
  quality: amfQualityPreferencesSchema.optional(),
  destination: z.string().min(1).max(1024).refine(isSafeAmfRelativePath, "unsafe relative destination"),
  selection_mode: amfSelectionModeSchema.optional(),
}).strict();

export const amfHealthSchema = z.object({
  status: z.string(),
});

export const amfReadinessSchema = z.object({
  status: z.string(),
  database: z.boolean(),
  prowlarr_configured: z.boolean(),
  custom_source_count: z.number().int(),
  qbittorrent_configured: z.boolean(),
});

export const amfItemMatchResultSchema = z.object({
  requested_item_index: z.number().int(),
  label: z.string(),
  kind: amfMusicKindSchema,
  number: z.number().int().nullable().optional(),
  status: z.enum(["pending", "found", "possible", "not_found", "delivered", "delegated"]),
  candidate_indexes: z.array(z.number().int()).default([]),
  selected_release_indexes: z.array(z.number().int()).default([]),
  matched_releases: z.array(z.string().transform(redactAmfText)).default([]),
  delivered_files: z.array(z.string().min(1).refine(isSafeAmfRelativePath, "unsafe delivered file path")).default([]),
  file_count: z.number().int().default(0),
});

export function isSafeAmfRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isSafeAmfApiReference(value: string): boolean {
  return value.startsWith("/api/v1/jobs/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && !value.split(/[/?#]/).includes("..");
}

type AmfSafeMetadataValue = string | number;

function isSafeMetadataValue(value: unknown): value is AmfSafeMetadataValue {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return false;
  return !value.includes("\0")
    && !/(?:https?|magnet):/i.test(value)
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.startsWith("/")
    && !value.startsWith("\\\\");
}

const amfSafeMetadataSchema = z.record(z.string(), z.unknown()).transform((metadata) => {
  const safe: Partial<Record<"title" | "artist" | "album" | "albumartist" | "track" | "disc", AmfSafeMetadataValue>> = {};
  for (const key of ["title", "artist", "album", "albumartist", "track", "disc"] as const) {
    const value = metadata[key];
    if (isSafeMetadataValue(value)) safe[key] = value;
  }
  return safe;
});

const amfMediaSongSchema = z.object({
  file_index: z.number().int().nonnegative(),
  requested_item_indexes: z.array(z.number().int()).default([]),
  labels: z.array(z.string()).default([]),
  titles: amfResponseTitlesSchema,
  artists: z.array(amfResponseTitlesSchema).default([]),
  relative_path: z.string().min(1).refine(isSafeAmfRelativePath, "unsafe relative delivery path"),
  absolute_path: z.string().min(1),
  media_url: z.string().min(1).refine(isSafeAmfApiReference, "unsafe media URL"),
  download_url: z.string().min(1).refine(isSafeAmfApiReference, "unsafe download URL"),
  size: z.number().int().nonnegative().nullable().optional(),
  sha256: z.string().min(1).nullable().optional(),
  metadata: amfSafeMetadataSchema.default({}),
}).strict();

const amfJobMediaSchema = z.object({
  anime: z.object({
    titles: amfResponseTitlesSchema,
    albums: z.array(z.object({
      titles: amfResponseTitlesSchema,
      songs: z.array(amfMediaSongSchema).default([]),
    }).strict()).default([]),
  }).strict(),
}).strict();

export function redactAmfText(value: string): string {
  return value
    .replace(/(?:https?|magnet):\S+/gi, "[redacted]")
    .replace(/\b[A-Za-z]:[\\/]\S+/g, "[redacted]")
    .replace(/(^|\s)\/(?:downloads|library|config)(?:\/\S*)?/gi, "$1[redacted]");
}

const amfRawDeliveryFileSchema = z.object({
  file_index: z.number().int().nonnegative(),
  relative_path: z.string().min(1).refine(isSafeAmfRelativePath, "unsafe relative delivery path"),
  absolute_path: z.string().min(1),
  media_url: z.string().min(1).refine(isSafeAmfApiReference, "unsafe media URL"),
  download_url: z.string().min(1).refine(isSafeAmfApiReference, "unsafe download URL"),
  size: z.number().int().nonnegative().nullable().optional(),
  sha256: z.string().min(1).nullable().optional(),
  metadata: amfSafeMetadataSchema.default({}),
}).passthrough();

export const amfDeliveryFileSchema = amfRawDeliveryFileSchema.transform((value) => ({
  file_index: value.file_index,
  relative_path: value.relative_path,
  size: value.size ?? null,
  sha256: value.sha256 ?? null,
  metadata: value.metadata,
}));

const amfRawJobDeliverySchema = z.object({
  requested_item_index: z.number().int(),
  label: z.string(),
  kind: amfMusicKindSchema,
  number: z.number().int().nullable().optional(),
  requested_metadata: z.record(z.string(), z.unknown()).default({}),
  files: z.array(amfDeliveryFileSchema).default([]),
});

export const amfJobDeliverySchema = amfRawJobDeliverySchema.transform((value) => ({
  requested_item_index: value.requested_item_index,
  label: redactAmfText(value.label),
  kind: value.kind,
  number: value.number ?? null,
  files: value.files,
}));

export const amfSourceFileSchema = z.object({
  source_file_index: z.number().int().nonnegative(),
  release_index: z.number().int().nonnegative(),
  relative_path: z.string().min(1).refine(isSafeAmfRelativePath, "unsafe relative source path"),
  media_url: z.string().min(1).refine(isSafeAmfApiReference, "unsafe source media URL"),
  size: z.number().int().nonnegative().nullable().optional(),
  metadata: amfSafeMetadataSchema.default({}),
  suggested_item_indexes: z.array(z.number().int()).default([]),
}).transform((value) => ({
  source_file_index: value.source_file_index,
  release_index: value.release_index,
  relative_path: value.relative_path,
  size: value.size ?? null,
  metadata: value.metadata,
  suggested_item_indexes: value.suggested_item_indexes,
}));

const unknownObject = z.record(z.string(), z.unknown());
const nullableUnknownObjectArray = z.array(unknownObject).nullable();

const amfRawJobSchema = z.object({
  id: z.string().min(1),
  status: amfJobStatusSchema,
  request_payload: unknownObject,
  destination: z.string().min(1).refine(isSafeAmfRelativePath, "unsafe response destination"),
  candidate_snapshot: nullableUnknownObjectArray,
  selected_releases: nullableUnknownObjectArray,
  downloads: nullableUnknownObjectArray,
  last_progress: z.number().nullable(),
  output_manifest: nullableUnknownObjectArray.optional().default(null),
  media: amfJobMediaSchema.nullable().optional(),
  source_files: z.array(amfSourceFileSchema).default([]),
  deliveries: z.array(amfJobDeliverySchema).default([]),
  item_results: z.array(amfItemMatchResultSchema).default([]),
  warnings: z.array(z.string()).nullable().optional().transform((value) => (value ?? []).map(redactAmfText)),
  error_stage: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  completed_at: z.string().nullable(),
});

export const amfJobSchema = amfRawJobSchema.transform((value) => ({
  id: value.id,
  status: value.status,
  destination: value.destination,
  last_progress: value.last_progress,
  source_files: value.source_files,
  deliveries: value.media ? mergeMediaDeliveries(value.media, value.item_results, value.deliveries) : value.deliveries,
  item_results: value.item_results,
  warnings: value.warnings,
  error_stage: value.error_stage == null ? null : redactAmfText(value.error_stage),
  has_error: value.error_message !== null,
  created_at: value.created_at,
  updated_at: value.updated_at,
  completed_at: value.completed_at,
}));

function mediaDeliveries(
  media: z.infer<typeof amfJobMediaSchema>,
  itemResults: z.infer<typeof amfItemMatchResultSchema>[],
) {
  const items = new Map(itemResults.map((item) => [item.requested_item_index, item]));
  const deliveries = new Map<number, {
    requested_item_index: number;
    label: string;
    kind: z.infer<typeof amfMusicKindSchema>;
    number: number | null;
    files: Array<{
      file_index: number;
      relative_path: string;
      size: number | null;
      sha256: string | null;
      metadata: Record<string, unknown>;
    }>;
  }>();
  for (const album of media.anime.albums) {
    for (const song of album.songs) {
      for (const itemIndex of song.requested_item_indexes) {
        const item = items.get(itemIndex);
        if (!item) continue;
        let delivery = deliveries.get(itemIndex);
        if (!delivery) {
          delivery = { requested_item_index: itemIndex, label: redactAmfText(item.label), kind: item.kind,
            number: item.number ?? null, files: [] };
          deliveries.set(itemIndex, delivery);
        }
        delivery.files.push({
          file_index: song.file_index,
          relative_path: song.relative_path,
          size: song.size ?? null,
          sha256: song.sha256 ?? null,
          metadata: {
            ...song.metadata,
            localized: {
              animeTitles: media.anime.titles,
              albumTitles: album.titles,
              songTitles: song.titles,
              artists: song.artists,
            },
          },
        });
      }
    }
  }
  return [...deliveries.values()];
}

function mergeMediaDeliveries(
  media: z.infer<typeof amfJobMediaSchema>,
  itemResults: z.infer<typeof amfItemMatchResultSchema>[],
  legacyDeliveries: z.output<typeof amfJobDeliverySchema>[],
) {
  const associated = mediaDeliveries(media, itemResults);
  if (associated.length > 0) return associated;
  const localizedByFile = new Map<string, Record<string, unknown>>();
  for (const album of media.anime.albums) for (const song of album.songs) {
    localizedByFile.set(`${song.file_index}:${song.relative_path}`, {
      ...song.metadata,
      localized: { animeTitles: media.anime.titles, albumTitles: album.titles, songTitles: song.titles, artists: song.artists },
    });
  }
  return legacyDeliveries.map((delivery) => ({ ...delivery, files: delivery.files.map((file) => ({
    ...file,
    metadata: localizedByFile.get(`${file.file_index}:${file.relative_path}`) ?? file.metadata,
  })) }));
}

export type AmfJobStatus = z.infer<typeof amfJobStatusSchema>;
export type AmfJobCreate = z.input<typeof amfJobCreateSchema>;
export type AmfJob = z.output<typeof amfJobSchema>;
export type AmfDeliveryFile = z.output<typeof amfDeliveryFileSchema>;
