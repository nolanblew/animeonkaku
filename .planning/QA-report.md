# Anime Ongaku QA Report

Generated against `feature/server-initiative`.

## Environment

- Device: Pixel 7 Pro (`cheetah`), Android API 36, USB ADB.
- Server target: local Docker Compose API on host port 8080, accessed from Android through `adb reverse` as `http://127.0.0.1:8080/`.
- Android build: debug APK with `ONGAKU_SERVER_BASE_URL=http://127.0.0.1:8080/` compiled into `BuildConfig`.
- Credentials: real Kitsu auth with the provided test account unless noted otherwise. Earlier stub-auth findings are retained as setup notes only.
- Evidence artifacts: `artifacts/qa/`.

## QA-01 Fresh Server Login and Initial Sync

Status: partial pass / fail.

What was tested:
- Fresh server volumes via `docker compose down -v` and `docker compose up -d --build`.
- Fresh app install after uninstalling an incompatible existing package.
- Debug APK compiled with `ONGAKU_SERVER_BASE_URL=http://127.0.0.1:8080/`.
- USB `adb reverse tcp:8080 tcp:8080`.
- Settings showed the compiled server URL as read-only.
- Real Kitsu login with the provided test account on the physical device.
- Email login path, invalid-credential handling, sync status, library pull, server jobs, and Android network logs were cross-checked through API/database/log evidence.

Result:
- Real Kitsu login completed on the physical device with the provided test account and linked to Kitsu user `nblewtest` / Kitsu ID `466215`.
- The sync screen reached `Server sync complete` / `Sync complete` and showed `30 titles`.
- Server database contained one real user, 30 `library_entries`, `KITSU_FULL_SYNC` done, `KITSU_DELTA_SYNC` done, and `AUTO_PLAYLIST_REFRESH` done.
- Direct server API login with the email path for the same test account returned the same Kitsu user and `/v1/library` returned 30 items.
- A deliberately invalid credential API login returned HTTP 401 and did not create an additional server user.
- Android logs showed server-routed requests through `ongaku.local` rewritten to `http://127.0.0.1:8080/`; no direct Android calls to `kitsu.io` or `api.animethemes.moe` were observed in the captured sync logs.
- The Android Library Animes tab showed imported anime titles, but each visible anime showed `0 themes`; direct `/v1/library` after API restart returned 30 anime and 0 themes.

Gotchas:
- Earlier stub-auth testing failed because stub Kitsu IDs cannot be used for real Kitsu sync; that is not representative of real Kitsu linking.
- The user manually entered the real credentials on device because ADB text injection into Compose fields reordered/dropped characters.
- Server `MAP_THEMES` remains queued after 3 attempts because AnimeThemes returned HTTP 403 / Cloudflare block; this prevents theme/media enrichment even though Kitsu auth and anime import succeeded.
- Server logs showed `/v1/media/images/anime/.../cover` returning HTTP 401 when the Android UI attempted to load cover art, so artwork coverage needs separate attention under QA-03.

## QA-02 Existing Install Migration

Status: skipped.

Reason: User requested skipping migration-from-current-version tests for this early beta.

## QA-03 Library Delta, Tombstone, and Artwork Refresh

Status: fail.

What was tested:
- Continued from the real linked Kitsu account and completed sync.
- Opened Library > Animes on the physical device.
- Queried server jobs and direct `/v1/library`.

Result:
- Imported anime appear in Library, including `A Silent Voice`, `anohana: The Flower We Saw That Day`, `Avatar: The Last Airbender Book 3: Fire`, and `Code Geass: Lelouch of the Rebellion`.
- All visible anime showed `0 themes`.
- Server `/v1/library` returned 30 anime and 0 themes.
- `MAP_THEMES` was not complete because AnimeThemes returned HTTP 403 / Cloudflare block.
- Server cover-image requests from Android returned HTTP 401, so artwork did not satisfy the "server artwork available" acceptance path.

Not tested:
- Add/remove tombstone delta through Kitsu was not performed because this QA run should preserve the user's manually linked device state and the theme mapping pipeline was already failing.

## QA-04 Search, Artist Detail, and Manual Add

Status: fail.

What was tested:
- Opened the app Search screen on the physical device.
- Called authenticated server `/v1/search?q=naruto`.

Result:
- The Search screen itself opened without crashing.
- Server search returned HTTP 500 because AnimeThemes returned HTTP 403 / Cloudflare block.
- Manual add from search and artist detail could not be completed because upstream search failed before returning usable anime/theme/artist results.

## QA-05 Playback, Queue, and Media Fallback

Status: blocked.

Reason:
- Playback/queue/media fallback requires at least one mapped theme/media row.
- Current server library has 30 anime but 0 themes because `MAP_THEMES` is blocked by AnimeThemes HTTP 403.

## QA-06 Download Manager, Wi-Fi Rules, and Retry State

Status: blocked.

Reason:
- Download tests require playable theme/media rows.
- Current server library has 0 themes, so there is no song/anime/playlist media to queue for download.

## QA-07 Offline Playback and Pre-Cache Safety

Status: blocked.

Reason:
- Offline playback and cache safety require at least one completed download or playable media item.
- No theme/media rows are available due to the failed AnimeThemes mapping job.

## QA-08 Likes, Dislikes, and Play Counts Sync

Status: blocked.

Reason:
- Like/dislike/play-count sync requires theme IDs.
- Direct `/v1/prefs/themes` returned 0 preference rows because the library has 0 themes.

## QA-09 Manual and Dynamic Playlists

Status: partial pass.

What was tested:
- Authenticated `/v1/playlists` returned auto playlists plus a QA-created empty manual playlist.
- Created `QA Manual Playlist` through the server API and verified it was returned by a subsequent playlist list call.

Result:
- Manual playlist create/read works at the server API level.
- Auto playlists exist (`Currently Watching`, `Kitsu Library`, `Liked Songs`) but contain 0 tracks because there are no mapped themes.

Not tested:
- App UI create/edit/reorder flow, dynamic playlist filters, and multi-device/sign-out verification were not exercised.

## QA-10 Upgrade and Data Preservation

Status: skipped.

Reason: User requested skipping migration-from-current-version tests for this early beta.

## QA-11 Core Navigation and UI Regression Smoke

Status: partial pass.

What was tested:
- Navigated Kitsu Sync, Settings, Library tabs, Search, and mini-player surfaces on the physical device.
- Captured screenshots/XML after sync, Library, Settings, Search, and post-server-restart Library.

Result:
- Tested screens opened without app crash.
- Settings showed the compiled server URL `http://127.0.0.1:8080/` and the read-only compiled URL label.
- Library and Search basic navigation worked.

Watch-outs found:
- Library content is incomplete: imported anime show `0 themes`.
- Search has a visible empty prompt, but upstream-backed results fail server-side.
- Theme/media-dependent screens could not be fully navigated because no themes were available.

## QA-12 Server Restart and Network Interruption Recovery

Status: partial pass.

What was tested:
- Restarted only the API container with `docker compose restart api`.
- Verified `/healthz` returned `ok`.
- Queried `/v1/library` after restart with a fresh token.
- Returned to Library on the physical device.
- Sampled logcat for app crashes.

Result:
- Server recovered after restart and `/healthz` was healthy.
- Server library still returned 30 anime and 0 themes after restart.
- The app continued rendering the Library screen with existing local data.
- No app `FATAL EXCEPTION` entries were observed in sampled logcat.

Not tested:
- Network interruption during a pending write or download, because no playable/downloadable theme rows are available.

## Automated Verification

- Server Vitest: pass, 23 test files / 105 tests.
- Server TypeScript: pass, `tsc -p tsconfig.json --noEmit`.
- Android unit tests: pass, `.\gradlew.bat --no-daemon test`.
