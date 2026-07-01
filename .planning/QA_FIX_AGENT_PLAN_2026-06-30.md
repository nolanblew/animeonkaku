# QA Fix Agent Plan - 2026-06-30

## Scope

This plan converts `.planning/QA_TEST_2026-06-30.md` into parallel agent workstreams. Do not execute the plan as part of creating this document.

Readiness target: private app for 3-5 trusted friends. Prioritize user-visible smoothness, regressions from pre-server behavior, and edge cases that would confuse or block friends. Do not spend agent capacity on public-SaaS hardening, scaling, strict migration support, or broad security work beyond a minimal private-app standard.

## Coordination Rules

- Start each agent from branch `cd/private-qa-readiness-plan` unless a coordinator creates per-agent branches.
- Each agent should read `.planning/QA_TEST_2026-06-30.md` first.
- Each agent should keep changes scoped to its workstream.
- Each agent should add or update tests when a stable automated check exists.
- Device-facing agents should preserve evidence under `artifacts/qa-fixes-YYYY-MM-DD/` if they run manual adb validation.
- No agent should mark the app friend-ready until the final verification workstream passes the complete friend-rollout script.

## Recommended Parallel Dispatch

### Agent 1 - First-Run Sync And Server URL Onboarding

Goal: make fresh install -> sign in -> library usable without app restart, and make private distribution server URL setup clear.

Primary issues:

- QA item 1: first-run sync should not require restart.
- QA item 4: private distribution must have one clear server URL path.
- QA item 10: friend-readable connectivity error messages.

Likely files:

- `src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/`
- `src/app/src/main/java/com/takeya/animeongaku/ui/settings/`
- `src/app/src/main/java/com/takeya/animeongaku/sync/`
- `src/app/src/main/java/com/takeya/animeongaku/work/`
- `src/app/src/main/java/com/takeya/animeongaku/data/server/ServerSettingsStore.kt`
- `src/app/build.gradle.kts`

Acceptance checks:

- Fresh install can sign in with the intended friend-distribution APK.
- Home/Library populate after initial sync without force-stopping the app.
- User sees a useful sync-in-progress state while server jobs run.
- If the server is unreachable, error text distinguishes connection failure from bad credentials.
- The exact friend APK either has the server URL compiled in or exposes a release-safe setup path.
- Add/update focused unit tests for onboarding/settings/sync state where feasible.

Suggested verification:

```powershell
Set-Location .\src
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.OnboardingViewModelTest"
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.LibraryPullManagerTest"
```

### Agent 2 - Bottom Sheets, Queue Actions, And Playback UX

Goal: ensure users cannot get trapped in modal sheets and core queue behavior still matches the pre-server contract.

Primary issues:

- QA item 2: bottom sheets should reliably dismiss.
- QA item 3: queue and action-menu behavior needs end-to-end device QA.

Likely files:

- `src/app/src/main/java/com/takeya/animeongaku/ui/`
- `src/app/src/main/java/com/takeya/animeongaku/ui/nowplaying/`
- `src/app/src/main/java/com/takeya/animeongaku/ui/library/`
- `src/app/src/main/java/com/takeya/animeongaku/media/NowPlayingManager.kt`
- `src/app/src/main/java/com/takeya/animeongaku/media/MediaControllerManager.kt`
- `src/app/src/test/java/com/takeya/animeongaku/NowPlayingManagerTest.kt`
- `src/app/src/test/java/com/takeya/animeongaku/LibrarySongsQueueTest.kt`

Acceptance checks:

- Back closes Now Playing and track action sheets.
- Scrim tap and close controls work where expected.
- Swipe-down works for draggable sheets.
- `Play next`, `Add to queue`, and `Replace queue` work from the track action sheet.
- Duplicate songs remain distinct queue entries.
- Mini-player Next updates queue, metadata, and UI correctly.
- Queue survives app restart if that was supported before the server rewrite.

Suggested verification:

```powershell
Set-Location .\src
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.NowPlayingManagerTest"
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.LibrarySongsQueueTest"
```

Manual adb/physical-touch validation is required for sheet dismissal.

### Agent 3 - Playlists, Downloads, Offline Behavior, And Metadata Polish

Goal: cover the friend-visible music workflows that were only partially exercised in the QA pass.

Primary issues:

- QA item 6: pending writes should not disappear after failures.
- QA item 7: playlist flows need a real user pass.
- QA item 8: offline mode should cover more than completed playback.
- QA item 9: Bluetooth/lock-screen artwork should be checked.

Likely files:

- `src/app/src/main/java/com/takeya/animeongaku/data/repository/ServerPlaylistWriter.kt`
- `src/app/src/main/java/com/takeya/animeongaku/sync/SyncEngine.kt`
- `src/app/src/main/java/com/takeya/animeongaku/work/PendingWritesFlushWorker.kt`
- `src/app/src/main/java/com/takeya/animeongaku/download/`
- `src/app/src/main/java/com/takeya/animeongaku/media/`
- `src/app/src/test/java/com/takeya/animeongaku/PlaylistDownloadSyncTest.kt`
- `src/app/src/test/java/com/takeya/animeongaku/OfflineSyncTest.kt`
- `src/app/src/test/java/com/takeya/animeongaku/ArtworkDataCacheTest.kt`

Acceptance checks:

- Create playlist, add song, remove song, and restart app without state loss.
- Pending writes retry after server outage instead of silently disappearing.
- A completed download plays from cold app start with server unavailable or airplane mode enabled.
- Attempting to stream a non-downloaded track offline gives a friend-readable error.
- Download interrupted by server outage either resumes/retries or clearly fails with a retry path.
- Lock-screen/Bluetooth metadata shows acceptable title/artist/artwork after track skips.

Suggested verification:

```powershell
Set-Location .\src
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.PlaylistDownloadSyncTest"
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.OfflineSyncTest"
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.ArtworkDataCacheTest"
```

Manual device validation is required for airplane mode, cold-start downloaded playback, and Bluetooth/lock-screen metadata.

### Agent 4 - Server Sync Longevity And Minimal Friend-Grade Robustness

Goal: make ongoing server sync reliable for a small private friend group.

Primary issues:

- QA item 5: Kitsu token refresh should work for ongoing usage.
- Relevant deferred issue: media/job worker behavior only where it becomes visible to friends.

Likely files:

- `server/src/sync/librarySyncPipeline.ts`
- `server/src/auth/`
- `server/src/kitsu/`
- `server/src/jobs/`
- `server/test/`

Acceptance checks:

- Expired access token with valid refresh token refreshes and sync continues.
- Invalid refresh token produces a clear reauth-required state for the app.
- Sync jobs do not silently fail forever after token expiry.
- Tests cover access-token expiry and refresh failure.
- Avoid broad public-admin/security refactors unless needed for friend-visible reliability.

Suggested verification:

```powershell
Set-Location .\server
npm test
npm run typecheck
```

### Agent 5 - Final Friend-Rollout Verification

Goal: run the final pass after Agents 1-4 complete; do not start before implementation branches are merged or intentionally combined.

Inputs:

- All accepted fixes from Agents 1-4.
- `.planning/QA_TEST_2026-06-30.md`
- This plan.

Acceptance checks:

- Server tests and typecheck pass.
- Android unit tests pass.
- Connected smoke test passes on adb device.
- Exact friend APK installs fresh.
- Manual script from `.planning/QA_TEST_2026-06-30.md` passes.
- Any skipped item is explicitly documented as accepted for private beta.

Minimum final manual script:

1. Fresh install.
2. Confirm Settings shows intended server URL.
3. Sign in.
4. Confirm Home/Library populate without restart.
5. Play a Home track.
6. Open and close Now Playing with Back, scrim tap, close control, and swipe.
7. Use `Play next`, `Add to queue`, and `Replace queue`.
8. Add duplicate songs and confirm separate queue entries.
9. Like a track and confirm Liked Songs updates.
10. Save a track to a playlist and confirm it persists after restart.
11. Search local library and online.
12. Download a track.
13. Stop the API or enable airplane mode and play the downloaded track.
14. Try to stream a non-downloaded track offline and confirm the error is understandable.
15. Lock the phone or connect Bluetooth and confirm metadata/artwork are acceptable.

## Suggested Execution Order

Agents 1-4 can start in parallel. Agent 5 should wait for the implementation work to converge.

If capacity is limited, run in this order:

1. Agent 1 - first-run sync and server URL.
2. Agent 2 - bottom sheets and queue actions.
3. Agent 3 - playlists/downloads/offline.
4. Agent 4 - token refresh.
5. Agent 5 - final friend-rollout verification.

## Non-Goals For This Plan

- Do not implement public multi-tenant security.
- Do not build load testing or horizontal scaling.
- Do not optimize admin job routes unless friend-visible reliability requires it.
- Do not spend time on legacy migration from old signed installs.
- Do not block on Media3 unstable API usage unless lint is required for the chosen release pipeline.
