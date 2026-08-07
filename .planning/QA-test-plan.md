# Anime Ongaku QA Test Plan

This plan verifies that the server-backed app keeps the current app experience intact: library sync, search, playback, downloads, playlists, and offline use should work without regressions. Keep evidence for each test: app version, device/API level, server URL, screenshots for visible results, and server/app logs for failures.

## Test Setup

- Android device or emulator on API 35 or newer.
- Fresh Anime Ongaku server from the target branch, with Postgres and media volume running.
- Test Kitsu account that can sign in with either username or email. Use a non-production account when possible.
- At least one anime with themes in the Kitsu library, one anime not in the library for manual add/search, and one playlist/dynamic playlist candidate.
- For multi-device checks, use two Android installs against the same server account. If only one device is available, sign out/in after each write to verify server persistence.

## 1. Server Connection, Auth, and Sync

### QA-01 Fresh Server Login and Initial Sync

**Context:** The Android app no longer talks directly to Kitsu or AnimeThemes. A configured server URL is required for network features.

**Steps:**
1. Install the app with no existing app data.
2. Open Settings and configure the Anime Ongaku server URL.
3. Go to Kitsu Sync and sign in with the Kitsu username.
4. Sign out or clear session, then sign in again with the Kitsu email for the same account.
5. Trigger a full library sync and wait until the app reports completion.

**Accept when:**
- Both username and email login paths work.
- The sync screen shows clear queued/running/done states with no direct Kitsu token prompts.
- Library, Currently Watching, and Kitsu Library content appears after pull completes.
- Server logs show Kitsu/AnimeThemes access from the server, not Android.

**Watch out for:**
- Stuck "authenticating" or "queued" states.
- Android logs showing direct calls to `kitsu.io` or `api.animethemes.moe`.
- Duplicate library rows or empty auto-playlists after a completed sync.

### QA-02 Existing Install Migration

**Context:** Existing local likes, dislikes, play counts, manual playlists, and dynamic playlist specs should upload once after server login.

**Steps:**
1. Start from an older/local-data install or seeded database containing liked/disliked songs, play counts, a manual playlist, and one dynamic playlist.
2. Upgrade to the server-backed build without clearing app data.
3. Configure server URL and sign in.
4. Let migration and first server pull complete.
5. Restart the app and trigger sync/pull again.

**Accept when:**
- Local preferences, play counts, manual playlist entries, and dynamic specs exist on the server after migration.
- The same local state is visible after the post-migration pull.
- Repeating sync does not duplicate playlists, play events beyond the expected migrated counts, or dynamic specs.
- Existing downloaded files still appear downloaded.

**Watch out for:**
- Migration running before server URL/session exists.
- Manual playlists being recreated on every login.
- Dynamic spec JSON being dropped or converted to invalid filters.

## 2. Library, Search, and Playback

### QA-03 Library Delta, Tombstone, and Artwork Refresh

**Context:** The app pulls `/v1/library?since=` deltas into Room and should reflect adds/removals without full local reset.

**Steps:**
1. Complete QA-01.
2. Add one anime to the Kitsu/server library and remove another through the server or Kitsu-backed sync path.
3. Trigger server sync and app pull.
4. Inspect Library, anime detail, artwork, and auto-playlists.

**Accept when:**
- Added anime appears with title, artwork, genres/status where available, and themes.
- Removed anime is removed or tombstoned locally unless protected by manual/user playlist rules.
- Auto-playlists refresh to match the new library state.
- No stale artwork placeholders remain when server artwork is available.

**Watch out for:**
- Removed anime still appearing in Library after a completed pull.
- Existing manual/user playlist items being deleted unexpectedly.
- Artwork URLs pointing at non-server hosts for server-backed items.

### QA-04 Search, Artist Detail, and Manual Add

**Context:** Search and artist detail now use server proxy endpoints and manual add goes through server library APIs.

**Steps:**
1. Search for an anime not already in the local library.
2. Open anime detail and play a preview theme if available.
3. Add a single song and then add the full anime to the library.
4. Open an artist detail page from search or a song row.

**Accept when:**
- Search returns anime, theme, and artist results without direct AnimeThemes calls from Android.
- Anime detail and artist detail load full online catalogs via server URLs.
- Manual add persists after app restart and after a library pull.
- Duplicate manual add attempts do not create duplicate local anime/theme rows.

**Watch out for:**
- Non-numeric theme IDs being saved as unstable hash IDs.
- Manual add succeeding locally but disappearing after pull.
- Artist detail failing when only artist name is available and slug must be resolved.

### QA-05 Playback, Queue, and Media Fallback

**Context:** Server media URLs must preserve the existing music player and queue behavior.

**Steps:**
1. Play a READY server track from Library.
2. Play a PENDING/missing-audio track that should trigger server request/fallback.
3. Use Play Next, Add to Queue, shuffle, repeat, skip, and duplicate-song queue entries.
4. Background the app and use notification/media controls.

**Accept when:**
- READY audio starts promptly and seeking works.
- PENDING audio either plays via server fallback or shows a clear recoverable error while the server queues media.
- Queue entries remain distinct even for duplicate songs.
- Media controls and now-playing metadata remain accurate in foreground/background.

**Watch out for:**
- Queue duplicates replacing each other or losing playback position.
- ExoPlayer failures on server redirects or range responses.
- Notification controls desyncing from the visible queue.

## 3. Downloads, Cache, and Offline Behavior

### QA-06 Download Manager, Wi-Fi Rules, and Retry State

**Context:** Downloads should still support songs, anime, and playlists, and retrying work should not show as permanently failed until final attempt.

**Steps:**
1. Enable Wi-Fi-only downloads, switch to cellular/non-Wi-Fi, and queue a song or playlist.
2. Return to Wi-Fi and confirm queued work starts.
3. Temporarily block server media or use a controlled failing media URL to trigger retry.
4. Restore media access and retry/resume if needed.

**Accept when:**
- Wi-Fi-only items show waiting/queued state and begin on Wi-Fi.
- Retriable failures show as retrying/active, not failed, until max attempts are exhausted.
- Final failures show actionable retry controls.
- Completed downloads record file path, image path when available, file size, and downloaded theme state.

**Watch out for:**
- Retrying downloads disappearing from active counts.
- Failed rows blocking future retry.
- Batch counters counting old completed downloads from unrelated sessions.

### QA-07 Offline Playback and Pre-Cache Safety

**Context:** Existing and newly downloaded files must work offline, while partial cache spans must not be treated as complete files.

**Steps:**
1. Download at least one song and one anime/playlist batch.
2. Start playback online, then enable airplane mode.
3. Play downloaded songs from Library, Search results already saved locally, playlist, and artist pages.
4. Queue upcoming non-downloaded tracks and observe behavior.

**Accept when:**
- Downloaded files play in airplane mode without server access.
- Non-downloaded tracks do not pretend to be cached if only partially available.
- The app shows a clear unavailable state for non-downloaded server media while offline.
- Removing a download clears local file state without deleting unrelated songs.

**Watch out for:**
- Partial pre-cache causing playback to start then fail mid-track.
- Offline UI hiding downloaded tracks because server pull fails.
- Remove-all deleting files but leaving Room rows marked downloaded.

## 4. User State, Playlists, and Multi-Device

### QA-08 Likes, Dislikes, and Play Counts Sync

**Context:** Preferences and play events are write-through/pending-write backed and should reconcile from the server.

**Steps:**
1. Like one song, dislike another, and play a third song to completion or enough to increment play count.
2. Force close/reopen the app and trigger pending writes/pull.
3. Verify the same state on a second device or after sign out/in.

**Accept when:**
- Likes/dislikes are mutually consistent and persist after pull.
- Play counts increase additively; local pending plays are not lost.
- Server state wins consistently after reconciliation without oscillating UI.

**Watch out for:**
- Like and dislike both active on one song.
- Pending play events replaying repeatedly after successful flush.
- UI showing stale preference state until full app restart.

### QA-09 Manual and Dynamic Playlists

**Context:** Manual playlists and dynamic specs were part of migration and should remain stable in server-only mode.

**Steps:**
1. Create a manual playlist, add/remove/reorder songs, and restart the app.
2. Create or edit a dynamic playlist with at least two filters and a sort option.
3. Trigger server pull and local auto-playlist refresh.
4. Verify on a second device or after sign out/in.

**Accept when:**
- Manual playlist membership/order persists after restart and pull.
- Dynamic playlist criteria persist and evaluate against local Room data.
- Server pull does not overwrite manual edits made shortly before sync.

**Watch out for:**
- Playlist entries duplicated after repeated pull.
- Dynamic filters using old Kitsu-only fields failing silently.
- Reorder operations not reflected after refresh.

## 5. Upgrade, Stability, and Regression Smoke

### QA-10 Upgrade and Data Preservation

**Context:** Users may upgrade from the current production app and must not lose offline content or local database data.

**Steps:**
1. Install a previous release/debug build with sample synced library, downloads, playlists, and preferences.
2. Upgrade in place to the target build with the same signing identity.
3. Launch, configure server, sign in, and complete migration/pull.

**Accept when:**
- App upgrades without uninstalling or clearing data.
- Room migration succeeds with no crash loop.
- Downloaded files, playlists, preferences, and playback history remain available.
- Server-backed URLs replace network media/artwork after pull while local files remain usable.

**Watch out for:**
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE` due to wrong signing key.
- Startup crash before settings/server URL can be configured.
- Duplicate or missing Room rows after migration.

### QA-11 Core Navigation and UI Regression Smoke

**Context:** The server refactor should not regress common app navigation or visual states.

**Steps:**
1. Navigate Home, Library, Search, Player, Downloads, Settings, Sync, playlist detail, anime detail, and artist detail.
2. Rotate device or test small/large screen if available.
3. Toggle server URL settings, download settings, and sync actions.

**Accept when:**
- No screen crashes, infinite spinners, clipped primary controls, or blank lists when data exists.
- Loading, empty, error, and success states are understandable.
- Back navigation returns to the expected previous screen.

**Watch out for:**
- Old "direct Kitsu" wording where server setup is required.
- Buttons enabled while required server/session state is missing.
- Long titles/artists overlapping controls.

### QA-12 Server Restart and Network Interruption Recovery

**Context:** The app should tolerate realistic local-server and network interruptions without corrupting state.

**Steps:**
1. Start playback or a library pull, then restart the server container.
2. Toggle device network off/on during a pending write or download.
3. Reopen the app and trigger pull/flush again.

**Accept when:**
- App surfaces recoverable errors and resumes after server/network returns.
- Pending writes and downloads retry without duplicate rows or lost user state.
- Playback of already-downloaded files continues while server is unavailable.

**Watch out for:**
- Auth session being cleared on transient server errors.
- Pending writes being dropped after process death.
- Download notifications stuck after network recovery.
