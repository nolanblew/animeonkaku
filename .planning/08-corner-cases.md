# Spike 08 — Corner Cases, Known Bugs, Error Handling

## A. Existing bugs found during the spike (fix opportunistically; some die with the refactor)

| # | Where | Bug | Disposition |
|---|---|---|---|
| 1 | `MainActivity` | Library/status sync only runs while app foregrounded (no periodic WorkManager job) | Fixed by design: server syncs on schedule; client adds 6 h WorkManager pull (doc 07 §3) |
| 2 | `PreCacheManager.isCached` | Checks `cache.keys.contains(url)` — a *partially* cached track counts as cached and never finishes pre-caching | Fix in client refactor: check `cache.isCached(key, 0, contentLength)` or track spans |
| 3 | `DownloadWorker` | On failure: `downloadDao.markFailed(...)` then `Result.retry()` — DB says FAILED while WorkManager silently retries; UI shows failed for a download that may later succeed | Fix when touching worker: mark a RETRYING status, only FAILED on final attempt |
| 4 | `SyncManager.toEntity` | Non-numeric theme id → `abs(themeId.hashCode()).toLong()` — collision risk corrupts joins | Server rejects non-numeric ids; client stops generating ids |
| 5 | `RetryInterceptor` | Ignores `Retry-After` header (AnimeThemes sends it on 429) | Server HTTP client honors it; client keeps simple version for server connection |
| 6 | `DownloadManager.downloadSong` | Race: `findGroup` → insert → re-find; concurrent calls can double-insert groups; `groupId` result unused | Dies if/when group writes move behind one transaction; low priority |
| 7 | `StatusSyncService` | Hard 60 s timeout kills long status syncs midway (large libraries on slow nets); `lastStatusSyncAt` may then never advance past a big backlog | Dies with server-side sync |
| 8 | `LibraryStatusSyncManager` | `syncIfNeeded` time-gate is read-then-act (no lock) — double trigger from onCreate+onStart races; benign (isRunning guard) but sloppy | Dies with refactor |
| 9 | `SyncManager` dedup | Duplicate `animeThemesId` resolution is keep-first-seen, not best-title-match (acknowledged in comment) | Superseded by N:1 mapping server-side (doc 05 decision 2) |
| 10 | `KitsuAuthInterceptor` | `runBlocking` inside OkHttp interceptor thread; global lock serializes all Kitsu calls during refresh | Dies — device no longer talks to Kitsu |
| 11 | Theme→audio fallback | When a theme has no audio link, `video.link` (webm video!) is stored as `audioUrl` and played/downloaded as audio | Server keeps the same fallback (it works — ExoPlayer plays webm audio track) but records it as `video_fallback=true` in `media_files` for visibility |

## B. Server corner cases (designs already account for these; listed as acceptance criteria)

**Sync & mapping**
- Kitsu entry deleted → tombstone `library_entries.deleted_at`; catalog rows are never deleted (shared across users), only unlinked.
- Same AnimeThemes anime mapped from 2 Kitsu entries (seasons collapsed) → allowed (N:1); both library entries expose the same themes; client dedupes display by theme id within a playlist build.
- All fallbacks fail → `kitsu_anime.mapping_state=UNMATCHED`, included in sync status `unmatched` list (same UX as today), retried on next *full* sync only.
- AnimeThemes re-encodes / changes URLs → weekly FAILED-media re-scan; `MAP_THEMES` updates `audio_origin_url` and resets `media_files` to MISSING if the URL changed → backfill re-fetches; client URL (`/v1/media/audio/{id}`) never changes.
- Kitsu refresh token revoked (password change) → `kitsu_auth_state=REAUTH_REQUIRED`; sync jobs for that user skip (not fail-spin); surfaced via `/v1/auth/me`.
- User with private/empty library, or 10k-entry library → paging already handles; per-user sync job timeout 30 min with checkpoint/yield.

**Media & streaming**
- Concurrent first-plays of the same missing file → both get 302; dedupe_key collapses the two URGENT jobs into one.
- Download interrupted (server restart) → tmp file ignored, job re-queued on boot, atomic rename guarantees no partial file is ever READY.
- Disk full → FETCH jobs fail with clear `last_error`; `/healthz` reports disk-free; circuit-breaker style pause when free space < threshold (e.g. 2 GB) so the queue doesn't grind through 5 attempts per file.
- Range request for file that just transitioned MISSING→READY mid-playback → client followed 302 to origin for the whole session; next session hits local. No mid-stream switching.
- Origin returns 200 HTML error page (AnimeThemes maintenance) → verify Content-Type `audio/*`/`application/octet-stream` and non-trivial size before READY; else fail attempt.
- ETag/immutability: theme id audio treated immutable; sha256 recorded; if re-fetch yields different hash, bump `updated_at` so clients can re-download offline copies if they care (v1: they don't).

**Auth & multi-device**
- Multiple devices, same Kitsu account → multiple `device_sessions`, one `users` row; prefs LWW; play counts additive (`POST /plays` events, server increments — no lost updates).
- Two *different* Kitsu accounts on one server → fully separate libraries; shared catalog/media (the whole point).
- Token theft threat model: LAN-only personal service; hashed tokens at rest; revocable per device. Good enough; explicitly not hardening further per project brief.

**Client offline behavior (must-not-break list)**
- Downloaded tracks play with airplane mode ON — preserved (file:// paths, untouched).
- Browsing library/playlists offline — preserved (Room cache).
- Likes/plays made offline reach the server eventually — pending-writes flush worker (doc 07 §6).
- WiFi-only download preference — preserved (WorkManager constraint unchanged).
- Server down but internet up → streaming non-downloaded tracks fails gracefully with banner; everything local still works. (Optional future nicety: client falls back to `video/audio_origin_url` if it has them cached — *not* in v1; the device shouldn't keep origin URLs around.)

## C. Operational corner cases
- Compose upgrade with schema change → drizzle migrations run before the HTTP listener starts; failed migration aborts boot (no half-migrated serving).
- DB volume restored from backup older than media volume → orphan-file scan reconciles (extra files deleted, missing rows re-queued). Reverse skew (media older) self-heals via BACKFILL_SCAN.
- Clock skew between client and server → all deltas use `serverTime` returned by `/library` as the next `since`, never the client clock.
