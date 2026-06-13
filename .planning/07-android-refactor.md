# Spike 07 — Android Client Refactor

Strategy: the client keeps its entire UI, media engine, Room cache, and offline-download machinery. What changes is *where data comes from*: one new Retrofit service (`OngakuApi`) replaces direct Kitsu/AnimeThemes traffic, and `SyncManager`'s 780-line pipeline collapses into "pull `/v1/library?since=` and upsert".

## What stays exactly as-is
- Compose UI, ViewModels, navigation, filter/dynamic-playlist evaluation (`data/filter/`).
- Media engine (`NowPlayingManager`, `MediaControllerManager`, `MediaPlaybackService`, `AudioCacheProvider`, `PreCacheManager`) — it plays URIs; it doesn't care who serves them.
- Room as the on-device cache (offline browsing requires it).
- Offline downloads: `DownloadManager` + `DownloadWorker` + group model + WiFi-only prefs — unchanged flow, new URLs.

## New pieces

### 1. Server connection config
- Settings screen field: server base URL (e.g. `https://ongaku.lan:8080`), persisted in prefs; `@Named("ongaku")` Retrofit built from it (dynamic base URL via interceptor or rebuild-on-change).
- `network/OngakuAuthInterceptor`: adds `Authorization: Bearer <serverToken>`; on 401 → clear session, surface re-login.
- `ServerTokenStore` (EncryptedSharedPreferences, replaces most of `KitsuTokenStore`; Kitsu tokens no longer live on the device at all).

### 2. Auth flow rewrite
- Login screen now posts username/password to `POST /v1/auth/login` (server does the Kitsu grant). Device never talks to kitsu.io again.
- `KitsuAuthRepository`/`KitsuAuthInterceptor`/`KitsuAuthApi` deleted after migration. `kitsuAuthState=REAUTH_REQUIRED` from `/v1/auth/me` → banner + re-login sheet.

### 3. Sync becomes a pull
Replace `SyncManager.doSync` phases with:
1. `POST /v1/sync` (manual) or nothing (server schedules its own).
2. Poll `GET /v1/sync/status` while Import screen open (keeps existing progress UI; phases map 1:1 to today's `SyncPhase`).
3. `GET /v1/library?since={lastPullAt}` → upsert Room `anime`/`themes`/cross-refs, apply tombstones, then refresh local dynamic playlists.
- Pull triggers replace status-sync cadence: cold start (≥5 min), warm resume (≥60 min), 2 h foreground loop → all become cheap `GET /library?since=` calls; **plus add a periodic WorkManager job (6 h, network-connected constraint)** so the device converges even if the app isn't opened — fixes today's foreground-only gap.
- `LibraryStatusSyncManager`, `StatusSyncService`, fallback-mapping code, `AnimeRepositoryImpl`'s AnimeThemes client: deleted (server owns all of it).

### 4. URL strategy & playback
- Room `ThemeEntity.audioUrl` now stores the *server* URL (`{base}/v1/media/audio/{id}`) — `PlaybackMediaItems` logic untouched.
- Server 302→origin on cache miss is followed transparently by both OkHttp (downloads) and Media3's `DefaultHttpDataSource` (`setAllowCrossProtocolRedirects(true)` already set). First-play-while-server-backfills "just works".
- Keep `videoUrl` pointing at origin (video is out of scope for server storage v1).
- Artwork: `posterUrl/coverUrl` switch to server URLs; Coil follows redirects; `FallbackAsyncImage` multi-resolution fallback keeps working (server returns 302 to the right CDN tier when not stored).

### 5. Offline downloads against the server
- `DownloadWorker` URL = server audio URL. Optionally call `POST /v1/media/audio/{id}/request` first so the server prioritizes warming its copy; if the worker gets a 302 it just follows it (file still lands on device either way — offline must never depend on server having the binary).
- Keep `isDownloaded/localFilePath` exactly as today.

### 6. User state push/pull
- Likes/dislikes: write-through — update Room immediately, fire `PUT /v1/prefs/themes/{id}`; on app start / pull, reconcile from `GET /v1/prefs/themes` (server wins, LWW).
- Play counts: append to local `play_count` as today **plus** enqueue into a small `pending_plays` Room table; a WorkManager job flushes batches to `POST /v1/plays` when online (offline plays survive).
- Manual playlists: same write-through pattern against `/v1/playlists`. Auto playlists become read-only projections of `GET /v1/playlists/auto`.

### 7. Offline / server-unreachable degradation
- All reads come from Room → browsing + downloaded playback work with zero connectivity (current behavior preserved).
- Streaming non-downloaded tracks obviously needs the server (or origin) — same as today needing internet.
- API failures: repositories return cached data + emit a non-fatal "server unreachable" state for a status banner; pending writes (prefs/plays/playlist edits) queue in Room and flush on reconnect (plays already designed so; prefs reuse the same flush worker).

## Migration for existing installs
One-time migration on first launch after update, gated on "server URL configured + logged in":
1. Local Room data stays (instant UI).
2. Login → server full-syncs from Kitsu itself (no upload of catalog needed).
3. Push local-only user state up: likes/dislikes (`PUT /prefs`), play counts (one `POST /plays` batch using `play_count` totals as synthetic events — acceptable for a personal app), manual playlists (`POST /playlists`), dynamic specs (`PUT /playlists/{id}/spec`).
4. Rewrite `themes.audioUrl` rows to server URLs on first `/library` pull (the pull upserts them anyway).
5. Downloaded files keep playing throughout (paths untouched).

## Deletions (post-migration cleanup)
`KitsuApi`, `KitsuAuthApi`, `KitsuAuthInterceptor`, `KitsuAuthRepository(Impl)`, `UserRepositoryImpl` Kitsu paging, `AnimeRepositoryImpl` (AnimeThemes), `SyncManager` mapping phases, `LibraryStatusSyncManager`, `StatusSyncService`, `RateLimitInterceptor` (server handles politeness; keep `RetryInterceptor` for the server connection).

## Test impact
- Keep: queue/media tests (`NowPlayingManagerTest`, `QueueDiffTest`, `PlaybackMediaItemsTest`, filter tests).
- Rewrite: `ApiDeserializationTest`/`ApiResponseParsingTest` → `OngakuApi` DTO tests against fixture JSON from doc 04.
- New: delta-upsert (tombstone handling), pending-writes flush worker, 302-follow behavior of `DownloadWorker` (MockWebServer).
