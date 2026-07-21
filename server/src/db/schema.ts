import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Schema contract: .planning/05-server-data-model.md
// Every change here goes through `npm run db:generate`; never edit applied migrations.

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export type CatalogItemType = "THEME" | "SONG";
export type PlaylistPlaybackMode = "TV_SIZE" | "FULL_SIZE";
export type ActualPlaybackMode = PlaylistPlaybackMode | "VIDEO" | "AUDIO";
export type MusicReleaseType =
  | "SOUNDTRACK"
  | "CHARACTER"
  | "IMAGE"
  | "THEME"
  | "INSERT"
  | "OTHER";
export type MusicDiscoveryStatus = "NEVER" | "DUE" | "RUNNING" | "COMPLETE" | "FAILED";
export type MusicAcquisitionPurpose = "FULL_SIZE" | "RELATED_RELEASE";
export type MusicAcquisitionState =
  | "REQUESTED"
  | "ACQUIRING"
  | "IMPORTING"
  | "READY"
  | "FAILED"
  | "AMBIGUOUS";
export type AnimeMusicRequestSource = "DEBUG_USER" | "AUTOMATIC";
export type AnimeMusicBatchState =
  | "QUEUED" | "SEARCHING" | "AWAITING_OPERATOR" | "DOWNLOADING" | "PROCESSING"
  | "COMPLETED" | "COMPLETED_WITH_WARNINGS" | "FAILED" | "CANCELLED";

// ===== identity =====

export const users = pgTable("users", {
  kitsuUserId: text("kitsu_user_id").primaryKey(),
  username: text("username").notNull(),
  kitsuAccessToken: text("kitsu_access_token"),
  kitsuRefreshToken: text("kitsu_refresh_token"),
  kitsuTokenExpiresAt: timestamp("kitsu_token_expires_at", { withTimezone: true }),
  kitsuAuthState: text("kitsu_auth_state").notNull().default("OK"), // OK | REAUTH_REQUIRED
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastStatusSyncAt: timestamp("last_status_sync_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const deviceSessions = pgTable("device_sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.kitsuUserId, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // sha256(token), hex
  deviceName: text("device_name").notNull().default("unknown"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("device_sessions_user_id_idx").on(t.userId),
]);

// ===== global catalog =====

export const animethemesAnime = pgTable("animethemes_anime", {
  id: bigint("id", { mode: "number" }).primaryKey(), // AnimeThemes anime id
  name: text("name"),
  nameEn: text("name_en"),
  coverUrl: text("cover_url"), // origin URL (i.animethemes.moe)
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kitsuAnime = pgTable("kitsu_anime", {
  kitsuId: text("kitsu_id").primaryKey(),
  // nullable until mapped; N:1 allowed (no unique constraint by design — doc 05 decision 2)
  animethemesAnimeId: bigint("animethemes_anime_id", { mode: "number" }).references(
    () => animethemesAnime.id,
  ),
  title: text("title"),
  titleEn: text("title_en"),
  titleRomaji: text("title_romaji"),
  titleJa: text("title_ja"),
  posterUrl: text("poster_url"),
  posterUrlLarge: text("poster_url_large"),
  coverUrl: text("cover_url"),
  coverUrlLarge: text("cover_url_large"),
  subtype: text("subtype"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  episodeCount: integer("episode_count"),
  ageRating: text("age_rating"),
  averageRating: doublePrecision("average_rating"),
  slug: text("slug"),
  mappingState: text("mapping_state").notNull().default("UNMAPPED"), // UNMAPPED | MAPPED | UNMATCHED
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("kitsu_anime_animethemes_anime_id_idx").on(t.animethemesAnimeId),
  index("kitsu_anime_updated_at_idx").on(t.updatedAt),
]);

export const themes = pgTable("themes", {
  id: bigint("id", { mode: "number" }).primaryKey(), // AnimeThemes theme id (numeric only)
  // Stable source-song association. Title equality is not a safe catalog identity.
  animethemesSongId: bigint("animethemes_song_id", { mode: "number" }),
  animethemesAnimeId: bigint("animethemes_anime_id", { mode: "number" })
    .notNull()
    .references(() => animethemesAnime.id),
  title: text("title").notNull(),
  themeType: text("theme_type"), // OP1 / ED2 ...
  audioOriginUrl: text("audio_origin_url").notNull(), // a.animethemes.moe/...
  videoOriginUrl: text("video_origin_url"),
  durationSeconds: integer("duration_seconds"),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("themes_animethemes_anime_id_idx").on(t.animethemesAnimeId, t.id),
  index("themes_updated_at_idx").on(t.updatedAt),
]);

export const songs = pgTable("songs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  animethemesSongId: bigint("animethemes_song_id", { mode: "number" }).unique(),
  musicbrainzRecordingId: text("musicbrainz_recording_id").unique(),
  title: text("title").notNull(),
  normalizedTitle: text("normalized_title").notNull(),
  artistCredit: text("artist_credit").notNull(),
  normalizedArtist: text("normalized_artist").notNull(),
  durationSeconds: integer("duration_seconds"),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("songs_normalized_title_artist_idx").on(t.normalizedTitle, t.normalizedArtist),
  index("songs_updated_at_idx").on(t.updatedAt),
]);

export const musicReleases = pgTable("music_releases", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  provider: text("provider").notNull(),
  providerReleaseId: text("provider_release_id").notNull(),
  title: text("title").notNull(),
  normalizedTitle: text("normalized_title").notNull(),
  artistCredit: text("artist_credit").notNull(),
  releaseType: text("release_type").$type<MusicReleaseType>().notNull(),
  releaseDate: date("release_date"),
  artworkUrl: text("artwork_url"),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  unique("music_releases_provider_release_unique").on(t.provider, t.providerReleaseId),
  index("music_releases_normalized_title_idx").on(t.normalizedTitle),
  index("music_releases_updated_at_idx").on(t.updatedAt),
]);

export const releaseTracks = pgTable("release_tracks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  releaseId: bigint("release_id", { mode: "number" })
    .notNull()
    .references(() => musicReleases.id, { onDelete: "cascade" }),
  songId: bigint("song_id", { mode: "number" })
    .notNull()
    .references(() => songs.id),
  discNumber: integer("disc_number").notNull().default(1),
  trackNumber: integer("track_number"),
  displayOrder: integer("display_order").notNull(),
}, (t) => [
  unique("release_tracks_release_display_order_unique").on(t.releaseId, t.displayOrder),
  index("release_tracks_release_order_idx").on(t.releaseId, t.displayOrder),
  index("release_tracks_song_id_idx").on(t.songId),
]);

export const animeMusicReleases = pgTable("anime_music_releases", {
  animethemesAnimeId: bigint("animethemes_anime_id", { mode: "number" })
    .notNull()
    .references(() => animethemesAnime.id, { onDelete: "cascade" }),
  releaseId: bigint("release_id", { mode: "number" })
    .notNull()
    .references(() => musicReleases.id, { onDelete: "cascade" }),
  relationshipType: text("relationship_type").$type<MusicReleaseType>().notNull(),
  confidence: doublePrecision("confidence").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  updatedAt: updatedAt(),
}, (t) => [
  primaryKey({ columns: [t.animethemesAnimeId, t.releaseId] }),
  index("anime_music_releases_release_id_idx").on(t.releaseId),
]);

export const themeFullSongs = pgTable("theme_full_songs", {
  themeId: bigint("theme_id", { mode: "number" })
    .primaryKey()
    .references(() => themes.id, { onDelete: "cascade" }),
  songId: bigint("song_id", { mode: "number" })
    .notNull()
    .references(() => songs.id),
  sourceReleaseId: bigint("source_release_id", { mode: "number" })
    .references(() => musicReleases.id),
  confidence: doublePrecision("confidence").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt(),
}, (t) => [
  index("theme_full_songs_song_id_idx").on(t.songId),
  index("theme_full_songs_source_release_id_idx").on(t.sourceReleaseId),
]);

export const themeVideoSources = pgTable("theme_video_sources", {
  animethemesVideoId: bigint("animethemes_video_id", { mode: "number" }).primaryKey(),
  animethemesEntryId: bigint("animethemes_entry_id", { mode: "number" }).notNull(),
  themeId: bigint("theme_id", { mode: "number" })
    .notNull()
    .references(() => themes.id, { onDelete: "cascade" }),
  entryVersion: integer("entry_version"),
  entryOrder: integer("entry_order"),
  link: text("link").notNull(),
  mimeType: text("mime_type"),
  resolution: integer("resolution"),
  source: text("source"),
  spoiler: boolean("spoiler").notNull().default(false),
  nsfw: boolean("nsfw").notNull().default(false),
  creditless: boolean("creditless").notNull().default(false),
  subbed: boolean("subbed").notNull().default(false),
  lyrics: boolean("lyrics").notNull().default(false),
  preferenceRank: integer("preference_rank").notNull(),
  updatedAt: updatedAt(),
}, (t) => [
  index("theme_video_sources_theme_rank_idx").on(t.themeId, t.preferenceRank),
  index("theme_video_sources_entry_id_idx").on(t.animethemesEntryId),
]);

export const musicDiscoveryState = pgTable("music_discovery_state", {
  animethemesAnimeId: bigint("animethemes_anime_id", { mode: "number" })
    .primaryKey()
    .references(() => animethemesAnime.id, { onDelete: "cascade" }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  nextScanAt: timestamp("next_scan_at", { withTimezone: true }),
  status: text("status").$type<MusicDiscoveryStatus>().notNull().default("NEVER"),
  missingFullCount: integer("missing_full_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
}, (t) => [
  index("music_discovery_state_due_idx").on(t.status, t.nextScanAt),
]);

export const musicAcquisitions = pgTable("music_acquisitions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  provider: text("provider").notNull(),
  providerJobId: text("provider_job_id"),
  providerReleaseId: text("provider_release_id"),
  animethemesAnimeId: bigint("animethemes_anime_id", { mode: "number" })
    .notNull()
    .references(() => animethemesAnime.id),
  purpose: text("purpose").$type<MusicAcquisitionPurpose>().notNull(),
  themeId: bigint("theme_id", { mode: "number" }).references(() => themes.id),
  songId: bigint("song_id", { mode: "number" }).references(() => songs.id),
  releaseId: bigint("release_id", { mode: "number" }).references(() => musicReleases.id),
  state: text("state").$type<MusicAcquisitionState>().notNull().default("REQUESTED"),
  providerResourceCreated: boolean("provider_resource_created").notNull().default(false),
  priorProviderMonitoringState: text("prior_provider_monitoring_state"),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  providerMetadata: jsonb("provider_metadata").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("music_acquisitions_provider_job_idx").on(t.provider, t.providerJobId),
  index("music_acquisitions_state_retry_idx").on(t.state, t.nextRetryAt),
  index("music_acquisitions_anime_id_idx").on(t.animethemesAnimeId),
  index("music_acquisitions_theme_id_idx").on(t.themeId),
  index("music_acquisitions_song_id_idx").on(t.songId),
  index("music_acquisitions_release_id_idx").on(t.releaseId),
]);

export const themeArtists = pgTable(
  "theme_artists",
  {
    themeId: bigint("theme_id", { mode: "number" })
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    artistName: text("artist_name").notNull(),
    asCharacter: text("as_character"),
    alias: text("alias"),
  },
  (t) => [primaryKey({ columns: [t.themeId, t.artistName] })],
);

export const artists = pgTable("artists", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
});

export const genres = pgTable("genres", {
  slug: text("slug").primaryKey(),
  displayName: text("display_name").notNull(),
  source: text("source").notNull(),
});

export const animeGenres = pgTable(
  "anime_genres",
  {
    kitsuId: text("kitsu_id")
      .notNull()
      .references(() => kitsuAnime.kitsuId, { onDelete: "cascade" }),
    genreSlug: text("genre_slug")
      .notNull()
      .references(() => genres.slug),
  },
  (t) => [primaryKey({ columns: [t.kitsuId, t.genreSlug] })],
);

// ===== per-user library/state =====

export const libraryEntries = pgTable(
  "library_entries",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.kitsuUserId, { onDelete: "cascade" }),
    kitsuId: text("kitsu_id")
      .notNull()
      .references(() => kitsuAnime.kitsuId),
    watchingStatus: text("watching_status"), // current/completed/planned/...
    userRating: doublePrecision("user_rating"),
    libraryUpdatedAt: timestamp("library_updated_at", { withTimezone: true }), // Kitsu's updatedAt
    isManuallyAdded: boolean("is_manually_added").notNull().default(false),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // tombstone for client delta
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kitsuId] }),
    index("library_entries_user_updated_idx").on(t.userId, t.updatedAt),
    index("library_entries_user_deleted_idx").on(t.userId, t.deletedAt),
    index("library_entries_user_status_active_idx")
      .on(t.userId, t.watchingStatus, t.kitsuId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const themePrefs = pgTable(
  "theme_prefs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.kitsuUserId, { onDelete: "cascade" }),
    themeId: bigint("theme_id", { mode: "number" })
      .notNull()
      .references(() => themes.id),
    liked: boolean("liked").notNull().default(false),
    disliked: boolean("disliked").notNull().default(false),
    dislikedTvSize: boolean("disliked_tv_size").notNull().default(false),
    dislikedFullSize: boolean("disliked_full_size").notNull().default(false),
    playCount: integer("play_count").notNull().default(0),
    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
    // Dedicated last-write-wins clock for the liked/disliked pair. Kept separate from
    // updatedAt (which any change, including additive play counts, bumps) so a play event
    // cannot reject an older like via row-level LWW. See sync/lww.ts.
    likedUpdatedAt: timestamp("liked_updated_at", { withTimezone: true }),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // tombstone for client delta
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.themeId] }),
    index("theme_prefs_user_updated_idx").on(t.userId, t.updatedAt),
    index("theme_prefs_user_deleted_idx").on(t.userId, t.deletedAt),
    index("theme_prefs_user_liked_active_idx")
      .on(t.userId, t.liked, t.themeId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const playlists = pgTable(
  "playlists",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.kitsuUserId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isAuto: boolean("is_auto").notNull().default(false),
    autoKind: text("auto_kind"), // KITSU_LIBRARY | CURRENTLY_WATCHING | LIKED_SONGS | null
    gradientSeed: integer("gradient_seed").notNull().default(0),
    defaultMode: text("default_mode").$type<PlaylistPlaybackMode>().notNull().default("TV_SIZE"),
    // Dynamic (smart) playlists: server-authoritative spec + sort, materialized like auto
    // playlists when dynamicAutoUpdate is true. dynamicSpecJson is the filter tree; a
    // non-null spec marks the playlist as dynamic.
    dynamicSpecJson: text("dynamic_spec_json"), // filter tree (FilterNode) JSON
    dynamicSortJson: text("dynamic_sort_json"), // sort spec (SortSpec) JSON
    isDynamic: boolean("is_dynamic").notNull().default(false),
    dynamicAutoUpdate: boolean("dynamic_auto_update").notNull().default(true),
    dynamicSpecUpdatedAt: timestamp("dynamic_spec_updated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    mutationUpdatedAt: timestamp("mutation_updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("playlists_user_updated_idx").on(t.userId, t.updatedAt),
    index("playlists_user_auto_active_idx")
      .on(t.userId, t.isAuto, t.name)
      .where(sql`${t.deletedAt} is null`),
    index("playlists_user_dynamic_active_idx")
      .on(t.userId, t.isDynamic, t.dynamicAutoUpdate)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("playlists_user_id_name_active_unique")
      .on(t.userId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const playlistEntries = pgTable(
  "playlist_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    playlistId: bigint("playlist_id", { mode: "number" })
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    itemType: text("item_type").$type<CatalogItemType>().notNull().default("THEME"),
    itemId: bigint("item_id", { mode: "number" }).notNull(),
    orderIndex: integer("order_index").notNull(),
    modeOverride: text("mode_override").$type<PlaylistPlaybackMode>(),
  },
  // Duplicate items are intentionally represented by independently identified occurrences.
  (t) => [
    index("playlist_entries_playlist_order_idx").on(t.playlistId, t.orderIndex),
    index("playlist_entries_item_idx").on(t.itemType, t.itemId),
  ],
);

// Durable Anime Music Fetcher orchestration. Bodies and idempotency keys are
// committed here before queue/provider effects; API projections never expose them.
export const animeMusicRequests = pgTable("anime_music_requests", {
  id: text("id").primaryKey(),
  requestedByUserId: text("requested_by_user_id").notNull().references(() => users.kitsuUserId),
  kitsuId: text("kitsu_id").notNull().references(() => kitsuAnime.kitsuId),
  animethemesAnimeId: bigint("animethemes_anime_id", { mode: "number" }).notNull()
    .references(() => animethemesAnime.id),
  source: text("source").$type<AnimeMusicRequestSource>().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("anime_music_requests_one_active_anime_unique")
    .on(t.animethemesAnimeId).where(sql`${t.completedAt} is null`),
  index("anime_music_requests_anime_latest_idx").on(t.animethemesAnimeId, t.createdAt),
]);

export const animeMusicRequestBatches = pgTable("anime_music_request_batches", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => animeMusicRequests.id, { onDelete: "cascade" }),
  batchIndex: integer("batch_index").notNull(),
  state: text("state").$type<AnimeMusicBatchState>().notNull().default("QUEUED"),
  amfRequestBody: jsonb("amf_request_body").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  amfJobId: text("amf_job_id").unique(),
  warningCount: integer("warning_count").notNull().default(0),
  lastError: text("last_error"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique("anime_music_request_batches_request_index_unique").on(t.requestId, t.batchIndex),
  index("anime_music_request_batches_recovery_idx").on(t.completedAt, t.createdAt),
]);

export const animeMusicRequestItems = pgTable("anime_music_request_items", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => animeMusicRequestBatches.id, { onDelete: "cascade" }),
  itemIndex: integer("item_index").notNull(),
  kind: text("kind").notNull(),
  number: integer("number"),
  themeId: bigint("theme_id", { mode: "number" }).references(() => themes.id),
  createdAt: createdAt(),
}, (t) => [
  unique("anime_music_request_items_batch_index_unique").on(t.batchId, t.itemIndex),
]);

export const songPrefs = pgTable("song_prefs", {
  userId: text("user_id")
    .notNull()
    .references(() => users.kitsuUserId, { onDelete: "cascade" }),
  songId: bigint("song_id", { mode: "number" })
    .notNull()
    .references(() => songs.id),
  liked: boolean("liked").notNull().default(false),
  disliked: boolean("disliked").notNull().default(false),
  playCount: integer("play_count").notNull().default(0),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
  likedUpdatedAt: timestamp("liked_updated_at", { withTimezone: true }),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.songId] }),
  index("song_prefs_user_updated_idx").on(t.userId, t.updatedAt),
  index("song_prefs_user_deleted_idx").on(t.userId, t.deletedAt),
  index("song_prefs_user_liked_active_idx")
    .on(t.userId, t.liked, t.songId)
    .where(sql`${t.deletedAt} is null`),
]);

export const playEvents = pgTable("play_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.kitsuUserId, { onDelete: "cascade" }),
  clientEventId: text("client_event_id").notNull(),
  itemType: text("item_type").$type<CatalogItemType>().notNull(),
  itemId: bigint("item_id", { mode: "number" }).notNull(),
  actualMode: text("actual_mode").$type<ActualPlaybackMode>().notNull(),
  playedAt: timestamp("played_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique("play_events_user_client_event_unique").on(t.userId, t.clientEventId),
  index("play_events_user_played_at_idx").on(t.userId, t.playedAt),
  index("play_events_item_idx").on(t.itemType, t.itemId),
]);

// ===== media =====

export const mediaFiles = pgTable(
  "media_files",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(), // AUDIO | VIDEO | ANIME_POSTER | ANIME_COVER | ARTIST_IMAGE
    refId: text("ref_id").notNull(), // themeId / kitsuId / artistSlug
    // Which source/cut of (kind, ref_id) this row holds. Theme audio/video use
    // SHORT (the ~90s AnimeThemes cut, the canonical playable audio) and, in the
    // future, FULL (full-length). Images use DEFAULT. See .planning/09-media-variants.md.
    variant: text("variant").notNull().default("DEFAULT"),
    originUrl: text("origin_url").notNull(),
    state: text("state").notNull().default("MISSING"), // MISSING | QUEUED | DOWNLOADING | READY | FAILED
    filePath: text("file_path"), // relative to MEDIA_ROOT
    byteSize: bigint("byte_size", { mode: "number" }),
    sha256: text("sha256"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    updatedAt: updatedAt(),
    videoFallback: boolean("video_fallback").notNull().default(false),
    contentType: text("content_type"),
    sourceFileName: text("source_file_name"),
  },
  (t) => [unique("media_files_kind_ref_id_variant_unique").on(t.kind, t.refId, t.variant)],
);

// ===== job queue (.planning/06-download-queue-design.md) =====

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // KITSU_FULL_SYNC | KITSU_DELTA_SYNC | MAP_THEMES | FETCH_AUDIO | FETCH_IMAGE | BACKFILL_SCAN | AUTO_PLAYLIST_REFRESH
    type: text("type").notNull(),
    priority: integer("priority").notNull(), // 0 URGENT, 10 HIGH, 20 NORMAL, 30 MAINTENANCE
    state: text("state").notNull().default("QUEUED"), // QUEUED | RUNNING | DONE | FAILED | CANCELLED
    payload: jsonb("payload").notNull().default({}),
    progress: jsonb("progress").notNull().default({}),
    dedupeKey: text("dedupe_key").unique(), // e.g. 'FETCH_AUDIO:4567'
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_pick_idx").on(t.state, t.priority, t.nextRunAt, t.id)],
);
