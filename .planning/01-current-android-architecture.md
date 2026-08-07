# Spike 01 — Current Android Architecture (as-is)

Audit of the existing app, focused on everything the server initiative must replace, reuse, or interoperate with. File paths are relative to `src/app/src/main/java/com/takeya/animeongaku/`.

## High-level

MVVM + Repository, Hilt DI, Compose UI, Media3/ExoPlayer, Room (schema v19), WorkManager. The phone is currently the *only* place where metadata lives; everything is fetched directly from Kitsu and AnimeThemes.moe.

```
Compose UI → ViewModel (StateFlow) → Repository → Room / Retrofit+OkHttp (Kitsu, AnimeThemes)
                                              ↕
                                  Media engine (NowPlayingManager / MediaControllerManager / MediaPlaybackService)
```

## Sync pipeline (the thing the server will own)

`sync/SyncManager.kt` (~780 lines) is the full pipeline, triggered from `LibrarySyncService` (foreground service with notification, pause/resume/stop actions):

1. **Kitsu library fetch** — `UserRepositoryImpl.getLibraryEntries` pages `users/{id}/library-entries` 500/page, statuses `current,completed`, includes anime + fields. Delta variant (`getLibraryEntriesDelta`) walks pages sorted `-updatedAt` and stops at the first fully-known page.
2. **Status refresh** — on non-first sync, `getLibraryEntriesUpdatedSince(lastStatusSyncAt)` walks `-updatedAt` until cutoff; updates status/rating/titles in place.
3. **Genre backfill** — `getAnimeWithCategories` in batches of 20 for anime lacking genre cross-refs.
4. **AnimeThemes mapping** — `AnimeRepositoryImpl.mapKitsuThemes`: `GET api.animethemes.moe/anime?filter[site]=Kitsu&filter[external_id]=<50 ids>&include=resources,animethemes,animethemes.animethemeentries.videos,animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists&page[size]=100`, follows `links.next` with 300ms delay.
5. **Fallback 1 (MAL ids)** — for unmapped anime: Kitsu `anime?include=mappings` (batch 20) → collect `myanimelist/anime` ids → AnimeThemes `filter[site]=MyAnimeList&filter[external_id]=…`.
6. **Fallback 2 (title search)** — per-anime `?q=<title>` with strict exact name/synonym match, guards against already-claimed animeThemesIds and mismatched Kitsu resource ids; 1s delay between anime.
7. **Dedup safety** — clears duplicated `animeThemesId` assignments (keep-first), plus DB self-heal `clearDuplicateAnimeThemesIds()` at start.
8. **Artist reconciliation** — rebuilds `ThemeArtistCrossRef` from the display string when structured credits missing.
9. **Artwork fill** — Kitsu `anime?filter[id]=` for entries missing titles/posters.
10. **Playlists** — rebuilds "Kitsu Library" playlist (all themes), then `AutoPlaylistManager` ("Currently Watching" from `watchingStatus == "current"`, "Liked Songs" from `user_preferences.isLiked`), then `DynamicPlaylistManager.refreshAllAutoSuspend()` (filter-tree based playlists, spec JSON in `dynamic_playlist_spec`).
11. Persists `lastSyncedAt` / `lastStatusSyncAt` in `KitsuTokenStore` prefs.

Stale cleanup on force-full-sync: removes anime no longer on Kitsu unless `isManuallyAdded` or referenced in a user playlist (cascade: cross-refs → themes → anime).

### Background sync cadence (current behavior, to mirror server-side)

| Trigger | Where | Interval gate |
|---|---|---|
| Cold app start | `MainActivity.onCreate` → `StatusSyncService` | ≥ 5 min since last status sync |
| Warm resume | `MainActivity.onStart` | ≥ 60 min |
| Foreground loop | `MainActivity` lifecycleScope `while(true)` | every 2 h while app open |
| Dynamic playlists | `DynamicPlaylistDailyWorker` (WorkManager periodic) | 24 h, battery-not-low, linear backoff 30 min |
| Full/delta library sync | manual from Import screen → `LibrarySyncService` | user action |

**Important gap:** there is *no* periodic WorkManager job for library sync — heavy sync only ever happens while the app is open. `StatusSyncService` has a 60s hard timeout. The server removes this whole class of problem.

## Auth (Kitsu)

- `data/remote/KitsuAuthApi.kt` — `POST kitsu.io/api/oauth/token`, grant types `password` and `refresh_token`, using the **public client id/secret** hardcoded in `KitsuAuthRepositoryImpl` (from Kitsu docs; fine to reuse server-side).
- Tokens stored in `EncryptedSharedPreferences` via `KitsuTokenStore` (access, refresh, expiry, username, kitsu userId, sync timestamps).
- `KitsuAuthInterceptor` refreshes lazily (`runBlocking` inside interceptor, synchronized) and adds `Authorization: Bearer` + JSON:API headers for `kitsu.io/api/edge/*` only.
- User identity: `KitsuApi.getSelfUser()` (`users?filter[self]=true`) → Kitsu user id; that id is the de-facto account key already.

## Network layer

- One `@Named("base")` OkHttpClient: `RateLimitInterceptor` (global 350ms min spacing, `Thread.sleep` under lock) + `RetryInterceptor` (GET/HEAD only, retries 408/429/500/502/503/504, exp backoff 300ms→2s, max 2 retries, no `Retry-After` parsing) + logging.
- `@Named("kitsu")` adds `KitsuAuthInterceptor`. AnimeThemes calls use raw OkHttp (no Retrofit) in `AnimeRepositoryImpl` with hand-built URLs.

## Download pipeline (offline files on device)

- `download/DownloadManager.kt` (singleton): group model — `download_group` (type SINGLE/ANIME/PLAYLIST + groupId + label) ←→ `download_group_theme` ←→ `download_request` (per-theme, statuses pending/downloading/completed/failed/paused/waiting_for_wifi, progress, filePath, imagePath, fileSize, workManagerId). Reference-counted cleanup: a theme's files are deleted only when no group references it.
- `DownloadWorker` (HiltWorker, foreground dataSync): streams audio to `filesDir/downloads/{themeId}.{ext}` (ext parsed from URL, default `webm`; AnimeThemes audio is `.ogg` from `a.animethemes.moe`), cover image to `downloads/images/`, marks `ThemeEntity.isDownloaded=true` + `localFilePath`. Retries via WorkManager `Result.retry()`. WiFi-only via `NetworkType.UNMETERED` constraint + `waiting_for_wifi` status (`DownloadPreferences.wifiOnly`, default **true**).
- 500ms spacing between enqueues in batch downloads.

## Playback / caching

- `media/PlaybackMediaItems.kt`: MediaItem URI = `file://{localFilePath}` when downloaded, else `audioUrl` (direct AnimeThemes URL). **The server swap point is `ThemeEntity.audioUrl`.**
- `AudioCacheProvider`: Media3 `SimpleCache`, 250MB LRU in `cacheDir/audio_cache`; `CacheDataSource` for player + pre-fetch factory.
- `PreCacheManager`: pre-caches next 2 queue tracks via `CacheWriter`; periodic eviction of >48h-stale entries every 6h. Note: `isCached` only checks key presence, so a *partially* cached track is treated as cached (existing bug).
- `NowPlayingManager` owns queue state; `MediaControllerManager` syncs with ExoPlayer; `MediaPlaybackService` hosts the MediaSession. Play counts recorded in `play_count` table.

## Room data model (v19)

- `anime` (PK `kitsuId` TEXT) — `animeThemesId`, 4 title variants, poster/cover (+Large), `watchingStatus`, `subtype`, dates, `episodeCount`, `ageRating`, `averageRating`, `userRating`, `libraryUpdatedAt`, `slug`, `isManuallyAdded`, `syncedAt`.
- `themes` (PK `id` = AnimeThemes theme id, **fallback `abs(hashCode)` if non-numeric** — collision risk) — `animeId` (animeThemesId), `title`, `artistName` (display string), `audioUrl`, `videoUrl`, `isDownloaded`, `localFilePath`, `themeType` (e.g. `OP1`), `source` (kitsu|user).
- `theme_artists` cross-ref (themeId, artistName, asCharacter, alias), `artist_images`.
- `playlists` / `playlist_entries` (+ `isAuto`, `gradientSeed`), `dynamic_playlist_spec` (filterJson/sortJson/simpleStateJson, mode).
- `play_count` (themeId, playCount, lastPlayedAt), `user_preferences` (themeId, isLiked, isDisliked).
- `genres` + `anime_genres`, download tables (above).
- Filter system (`data/filter/`): polymorphic `FilterNode` JSON (Moshi) — and/or/not over genre, air date, season, subtype, ratings, watch status, theme type, artist, regex title match, liked/disliked/downloaded, play counts. Evaluated fully client-side against Room. **This entire feature can stay client-side initially.**

## Existing quirks / bugs worth fixing in the new world

(Details + more in `08-corner-cases.md`.)

1. No background sync when app closed (no periodic WorkManager library sync).
2. `PreCacheManager.isCached` treats partial cache spans as fully cached.
3. `DownloadWorker` marks DB `failed` then returns `Result.retry()` — DB status and WorkManager state can disagree.
4. Theme id `abs(hashCode())` fallback can collide.
5. `RateLimitInterceptor` blocks OkHttp threads with `Thread.sleep` under a global lock (acceptable, but the 350ms spacing is the only AnimeThemes throttle besides ad-hoc `delay()`s).
6. `RetryInterceptor` ignores `Retry-After` despite AnimeThemes sending it.
7. Likes/dislikes/play counts/playlists are device-local — lost on reinstall, not shared across devices.
8. Audio binaries re-downloaded from AnimeThemes by every device, every reinstall.
