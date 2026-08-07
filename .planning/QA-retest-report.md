# Anime Ongaku QA Retest Report

Generated on 2026-06-13 against `feature/server-initiative`, preserving the existing logged-in physical-device install. This retest covers the items that were bad or skipped in `QA-report.md`, excluding migration/upgrade tests by request.

## Environment

- Device: Pixel 7 Pro (`cheetah`), Android API 36, USB ADB.
- Server target: local Docker Compose API on host port 8080, accessed from Android through `adb reverse tcp:8080 tcp:8080`.
- Android build: debug APK installed in place with `ONGAKU_SERVER_BASE_URL=http://127.0.0.1:8080/` compiled into `BuildConfig`.
- Account/session: existing logged-in Kitsu session for `nblewtest` / Kitsu ID `466215`.
- Evidence artifacts: `artifacts/qa-retest-fixes/` and `artifacts/qa-retest-final/`.

## Summary

| QA ID | Retest Status | Result |
| --- | --- | --- |
| QA-01 | Pass for retested scope | Session was preserved; Settings shows compiled server URL; Sync reports `Server sync complete`, `Sync complete`, `30 titles`, and `Imported: 30`. |
| QA-03 | Pass for retested scope | Library pull has 30 anime and mapped themes. Server auto-playlist refresh now produces 134 Kitsu Library tracks and 15 Currently Watching tracks. Image routes no longer require bearer auth; no 401 image failures were observed with the server tunnel active. |
| QA-04 | Pass | Online search, online anime detail, and artist detail are server-routed. No direct Android calls to `api.animethemes.moe` were observed. |
| QA-05 | Pass | Online Naruto detail playback reached Android media session `PLAYING(3)` with queue size 25; no `/v1/anime/11` or `/v1/media/audio/1478` 404 remained. |
| QA-06 | Pass | A real device download was queued from the UI with Wi-Fi disabled, remained `pending`, then completed after Wi-Fi was restored to `KitsuNet`; DB row recorded audio path, image path, file size, and `progress=100`. |
| QA-07 | Pass for server-offline playback | Removed the ADB reverse tunnel and played the downloaded `A Silent Voice · OP`; media session stayed `PLAYING(3)` while server image/pre-cache requests failed, proving local audio playback survived server unavailability. Reverse tunnel was restored. |
| QA-08 | Pass | Device like action sent `PUT /v1/prefs/themes/1476`; server readback showed liked rows and refreshed `Liked Songs` to 2 tracks. Pending play rows for themes 3265/3266 flushed through `POST /v1/plays`, local `pending_plays` cleared, and server `theme_prefs.play_count` updated for Kitsu user `466215`. |
| QA-09 | Pass | Server and device playlists show non-empty auto-playlists: `Liked Songs` 2, `Currently Watching` 15, `Kitsu Library` 134. Server-pulled manual playlist `QA Manual Playlist` is now `isAuto=0`; device-created smart playlist `QA_Device_Smart_1533` persisted as `isAuto=1` with an `AUTO` `dynamic_playlist_spec`. |
| QA-11 | Pass for retested scope | Search, online anime detail, artist detail, player, Sync, Library Playlists, Kitsu Library playlist, and Download Manager opened without app crash. |
| QA-12 | Pass for pending-write recovery | Server-offline playback was exercised by removing ADB reverse; downloaded audio continued playing, and reverse was restored. Pending play interruption was retested by stopping `server-api-1`: Sync surfaced a server error and kept the pending row queued; after API restart the same sync flushed `/v1/plays`, cleared `pending_plays`, and updated server `theme_prefs`. |

## Evidence Highlights

- `settings-url.xml` / `.png`: Settings shows `http://127.0.0.1:8080/` and `Server URL (compiled)`.
- `sync-before-pull-2.xml` and `sync-after-pull.xml`: Sync screen shows linked `nblewtest`, `User ID: 466215 · Imported: 30`, `Server sync complete`, and `Sync complete`.
- `search-results-2.xml` / logcat: `naruto` search returned anime, artist, and song results; logcat shows `GET https://ongaku.local/v1/search?q=naruto` rewritten to `200 OK http://127.0.0.1:8080/v1/search?q=naruto`.
- `anime-detail.xml` / logcat: opening Naruto hit `/v1/anime/11` and returned 200, rendering 25 themes.
- `artist-detail.xml` / logcat: opening Karuta hit `/v1/search?q=Karuta` and `/v1/artists/karuta`, both rewritten to `127.0.0.1:8080`; no `api.animethemes.moe` match.
- `online-play-media-session.txt`: online Naruto playback reached `PLAYING(3)`, `description=Naruto · OP1`, queue size 25.
- Server DB check after liking: `AUTO_PLAYLIST_REFRESH:466215` was `DONE`; auto-playlists had 134, 15, and 2 tracks.
- `playlists.xml`: device Library Playlists showed `Liked Songs` 2 tracks, `Currently Watching` 15 tracks, and `Kitsu Library` 134 tracks.
- `download-3-logcat.txt`: retry downloaded theme 6663 from `/v1/media/audio/6663` and completed at `/data/user/0/com.takeya.animeongaku/files/downloads/6663.ogg` with 4,106,868 bytes.
- `offline-play-media-session.txt`: with ADB reverse removed, downloaded `A Silent Voice · OP` played with `PLAYING(3)` and `error=null`; reverse was restored afterward.
- `qa-retest-final/anime_ongaku-after-sync.db*`: after forced sync, `QA Manual Playlist` is `isAuto=0`.
- `qa-retest-final/anime_ongaku-smart-wal.db*`: `QA_Device_Smart_1533` is `isAuto=1` and has a `dynamic_playlist_spec` with `mode=AUTO`, `createdMode=SIMPLE`, and Action genre filter JSON.
- `qa-retest-final/anime_ongaku-download-main.db*` and `anime_ongaku-download-after-wifi.db*`: theme 2262 stayed `pending` while Wi-Fi was disabled, then completed with `filePath`, `imagePath`, `fileSize=3547564`, and `progress=100` after Wi-Fi returned.
- `qa-retest-final/anime_ongaku-after-patched-sync.db*`: pending play rows cleared after patched sync pre-flush; server `theme_prefs` showed theme 3265 `play_count=4`.
- `qa-retest-final/qa12_offline_sync.xml` and `anime_ongaku-qa12-offline.db*`: API-offline sync showed `Server sync failed...` and preserved pending play theme 3266.
- `qa-retest-final/anime_ongaku-qa12-recovered.db*`: after API restart, pending theme 3266 cleared locally and server `theme_prefs` recorded `play_count=1`.

## Fixes Validated During Retest

- Android artist-image resolution now uses the server API and server media image URLs.
- Server search/artist proxy results seed online catalog rows so `/v1/anime/:kitsuId` and `/v1/media/audio/:themeId` work for online search results.
- Image media routes proxy and queue cache fetches without bearer auth, avoiding UI artwork 401s.
- Auto-playlist refresh jobs are requeued when a deduped job was already `DONE`, and theme preference writes enqueue refresh.
- Android Sync UI uses local imported anime count, fixing the stale `Imported: 0`.
- Android download filenames now derive extensions from the URL path only; extensionless server media routes use a safe default and no longer include `127.0.0.1:8080/...` in filenames.
- Android library pull now preserves server manual playlist `isAuto=false` instead of marking every server playlist as auto.
- Android library pull now hydrates server dynamic playlist specs into `dynamic_playlist_spec` and keeps dynamic playlists auto-refreshable locally.
- Android Kitsu Sync now flushes pending writes through `LibraryPullManager` before queuing long server sync jobs, so play events are not stuck behind slow server imports.

## Final Upstream-Boundary Audit

- Static grep across Android main/test and server client-facing DTO files found no direct upstream host/API references for `api.animethemes.moe`, `*.animethemes.moe`, `kitsu.io`, `/api/edge`, or `oauth/token`.
- Android `http://` / `https://` production-code scan only found server URL normalization/placeholders, the Retrofit placeholder `https://ongaku.local/` that is rewritten by `OngakuBaseUrlInterceptor`, media comments, and the unrelated GitHub updater endpoint.
- Android network construction review found no direct Kitsu or AnimeThemes clients. `OngakuApi` is the server API, downloads use URLs supplied by the server, and server media auth headers are only added for configured server-origin URLs.
- Client-facing server theme DTOs now return `videoUrl: null` because there is no server-backed video route yet; Android sync/search/detail mapping also discards upstream video URLs instead of storing or exposing them.

## Remaining Watch-outs

- Offline testing used server unavailability via `adb reverse --remove tcp:8080`, not airplane mode, to avoid disturbing the physical device.
- Offline audio played successfully, but server-hosted notification artwork still logs expected connection failures while the server tunnel is unavailable.
- QA-12 retested pending-write interruption/recovery. Download interruption during an active transfer was not repeated because QA-06 already covered Wi-Fi wait/resume and completed download recovery.
