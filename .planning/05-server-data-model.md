# Spike 05 — Server Data Model (PostgreSQL)

Initial Drizzle migration (drizzle-kit generates the SQL; the SQL below is the contract — the Drizzle TS schema in `server/src/db/` must produce exactly this). Naming: snake_case. All timestamps `timestamptz`. `updated_at` maintained by triggers or app code — it backs the `/library?since=` delta feed, so every user-visible table carries `updated_at` and soft-delete `deleted_at` where the client needs tombstones.

## Design decisions vs. the Room schema

1. **Catalog is global, library is per-user.** Room mixes them (`anime.watchingStatus` etc. live on the catalog row). Server splits `anime` (catalog) from `library_entries` (user ↔ anime + status/rating). This is what enables multi-user + multi-device.
2. **Kitsu↔AnimeThemes mapping is N:1, not 1:1.** Multiple Kitsu entries may map to one AnimeThemes anime (current client forbids this with "claimed id" guards and clears duplicates — a workaround for Room's join-by-animeThemesId). `kitsu_anime.animethemes_anime_id` is a plain FK with no uniqueness constraint; themes join through `animethemes_anime`.
3. **Theme id = AnimeThemes numeric id, no hash fallback.** Non-numeric ids are rejected and logged (client's `abs(hashCode())` fallback is a collision bug).
4. **Media state lives in its own table** (`media_files`), not as booleans on themes.

## Schema

```sql
-- ===== identity =====
CREATE TABLE users (
  kitsu_user_id     text PRIMARY KEY,
  username          text NOT NULL,
  kitsu_access_token  text,
  kitsu_refresh_token text,
  kitsu_token_expires_at timestamptz,
  kitsu_auth_state  text NOT NULL DEFAULT 'OK',     -- OK | REAUTH_REQUIRED
  last_sync_at      timestamptz,
  last_status_sync_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_sessions (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,               -- sha256(token)
  device_name   text NOT NULL DEFAULT 'unknown',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

-- ===== global catalog =====
CREATE TABLE animethemes_anime (
  id            bigint PRIMARY KEY,                 -- AnimeThemes anime id
  name          text,
  name_en       text,
  cover_url     text,                               -- origin URL (i.animethemes.moe)
  synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kitsu_anime (
  kitsu_id      text PRIMARY KEY,
  animethemes_anime_id bigint REFERENCES animethemes_anime,  -- nullable until mapped; N:1 allowed
  title         text, title_en text, title_romaji text, title_ja text,
  poster_url    text, poster_url_large text,        -- origin URLs (Kitsu CDN)
  cover_url     text, cover_url_large  text,
  subtype       text, start_date date, end_date date,
  episode_count int,  age_rating text, average_rating double precision,
  slug          text,
  mapping_state text NOT NULL DEFAULT 'UNMAPPED',   -- UNMAPPED | MAPPED | UNMATCHED (all fallbacks failed)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE themes (
  id            bigint PRIMARY KEY,                 -- AnimeThemes theme id (numeric only)
  animethemes_anime_id bigint NOT NULL REFERENCES animethemes_anime,
  title         text NOT NULL,
  theme_type    text,                               -- OP1 / ED2 ...
  audio_origin_url text NOT NULL,                   -- a.animethemes.moe/...
  video_origin_url text,
  duration_seconds int,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE theme_artists (
  theme_id      bigint NOT NULL REFERENCES themes ON DELETE CASCADE,
  artist_name   text NOT NULL,
  as_character  text,
  alias         text,
  PRIMARY KEY (theme_id, artist_name)
);

CREATE TABLE artists (
  slug          text PRIMARY KEY,
  name          text NOT NULL,
  image_url     text
);

CREATE TABLE genres (
  slug          text PRIMARY KEY,
  display_name  text NOT NULL,
  source        text NOT NULL
);

CREATE TABLE anime_genres (
  kitsu_id      text NOT NULL REFERENCES kitsu_anime ON DELETE CASCADE,
  genre_slug    text NOT NULL REFERENCES genres,
  PRIMARY KEY (kitsu_id, genre_slug)
);

-- ===== per-user library/state =====
CREATE TABLE library_entries (
  user_id       text NOT NULL REFERENCES users ON DELETE CASCADE,
  kitsu_id      text NOT NULL REFERENCES kitsu_anime,
  watching_status text,                             -- current/completed/planned/...
  user_rating   double precision,
  library_updated_at timestamptz,                   -- Kitsu's updatedAt
  is_manually_added boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,                        -- tombstone for client delta
  PRIMARY KEY (user_id, kitsu_id)
);

CREATE TABLE theme_prefs (
  user_id       text NOT NULL REFERENCES users ON DELETE CASCADE,
  theme_id      bigint NOT NULL REFERENCES themes,
  liked         boolean NOT NULL DEFAULT false,
  disliked      boolean NOT NULL DEFAULT false,
  play_count    int NOT NULL DEFAULT 0,
  last_played_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, theme_id)
);

CREATE TABLE playlists (
  id            bigserial PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users ON DELETE CASCADE,
  name          text NOT NULL,
  is_auto       boolean NOT NULL DEFAULT false,
  auto_kind     text,                               -- KITSU_LIBRARY | CURRENTLY_WATCHING | LIKED_SONGS | null
  gradient_seed int NOT NULL DEFAULT 0,
  dynamic_spec_json text,                           -- opaque client filter spec (backup only, v1)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (user_id, name)
);

CREATE TABLE playlist_entries (
  playlist_id   bigint NOT NULL REFERENCES playlists ON DELETE CASCADE,
  theme_id      bigint NOT NULL REFERENCES themes,
  order_index   int NOT NULL,
  PRIMARY KEY (playlist_id, theme_id, order_index)  -- duplicates of a song allowed at different positions
);

-- ===== media =====
CREATE TABLE media_files (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL,                      -- AUDIO | ANIME_POSTER | ANIME_COVER | ARTIST_IMAGE
  ref_id        text NOT NULL,                      -- themeId / kitsuId / artistSlug
  origin_url    text NOT NULL,
  state         text NOT NULL DEFAULT 'MISSING',    -- MISSING | QUEUED | DOWNLOADING | READY | FAILED
  file_path     text,                               -- relative to MEDIA_ROOT
  byte_size     bigint,
  sha256        text,
  error_message text,
  attempts      int NOT NULL DEFAULT 0,
  fetched_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id)
);

-- ===== job queue (doc 06) =====
CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  type          text NOT NULL,        -- KITSU_FULL_SYNC | KITSU_DELTA_SYNC | MAP_THEMES | FETCH_AUDIO | FETCH_IMAGE | BACKFILL_SCAN | AUTO_PLAYLIST_REFRESH
  priority      int  NOT NULL,        -- 0 URGENT, 10 HIGH, 20 NORMAL, 30 MAINTENANCE
  state         text NOT NULL DEFAULT 'QUEUED',  -- QUEUED | RUNNING | DONE | FAILED | CANCELLED
  payload       jsonb NOT NULL DEFAULT '{}',     -- e.g. {"themeId":4567} / {"userId":"123","full":true}
  dedupe_key    text UNIQUE,          -- e.g. 'FETCH_AUDIO:4567' — prevents duplicate enqueues
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 5,
  next_run_at   timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pick_idx ON jobs (state, priority, next_run_at, id);
```

## Mapping notes (Room → server)

| Room | Server |
|---|---|
| `anime` (catalog+user mixed) | `kitsu_anime` + `library_entries` (+`animethemes_anime`) |
| `themes.audioUrl` | `themes.audio_origin_url`; client-facing URL is always `/v1/media/audio/{id}` |
| `themes.isDownloaded/localFilePath` | client-local concern only (device offline files) — does not exist server-side; server equivalent is `media_files.state` |
| `play_count`, `user_preferences` | `theme_prefs` |
| `download_request/group/...` | stays **client-only** (device offline downloads); server queue is `jobs` + `media_files` |
| `dynamic_playlist_spec` | `playlists.dynamic_spec_json` (opaque, v1) |
| `KitsuTokenStore` prefs | `users` row |

## Sizing reality check
2,000 themes × ~8 MB ≈ 16 GB audio — fits any homelab disk. Postgres footprint trivial (<100 MB). No partitioning/indexing concerns at this scale beyond the `jobs_pick_idx`.
