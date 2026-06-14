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
} from "drizzle-orm/pg-core";

// Schema contract: .planning/05-server-data-model.md
// Every change here goes through `npm run db:generate`; never edit applied migrations.

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

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
});

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
});

export const themes = pgTable("themes", {
  id: bigint("id", { mode: "number" }).primaryKey(), // AnimeThemes theme id (numeric only)
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
});

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
  (t) => [primaryKey({ columns: [t.userId, t.kitsuId] })],
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
    playCount: integer("play_count").notNull().default(0),
    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.themeId] })],
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
    dynamicSpecJson: text("dynamic_spec_json"), // opaque client filter spec (backup only, v1)
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [unique("playlists_user_id_name_unique").on(t.userId, t.name)],
);

export const playlistEntries = pgTable(
  "playlist_entries",
  {
    playlistId: bigint("playlist_id", { mode: "number" })
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    themeId: bigint("theme_id", { mode: "number" })
      .notNull()
      .references(() => themes.id),
    orderIndex: integer("order_index").notNull(),
  },
  // duplicates of a song allowed at different positions
  (t) => [primaryKey({ columns: [t.playlistId, t.themeId, t.orderIndex] })],
);

// ===== media =====

export const mediaFiles = pgTable(
  "media_files",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(), // AUDIO | ANIME_POSTER | ANIME_COVER | ARTIST_IMAGE
    refId: text("ref_id").notNull(), // themeId / kitsuId / artistSlug
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
  },
  (t) => [unique("media_files_kind_ref_id_unique").on(t.kind, t.refId)],
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
