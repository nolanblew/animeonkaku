# Android playback reliability

## Scope and baseline

Work starts from `main` at `b0a455b` on `codex/android-playback-variants-feedback`.
The four deliverables are uninterrupted reactions, reliable online variant discovery,
song-level full-size requests and incorrect-result reporting, and system media reactions.

## Implementation plan

### Reactions and current playback

Trace both the immediate Room preference write and the subsequent server refresh. A
reaction must not restart the active queue occurrence. Separate updates to metadata,
future queue eligibility, and available variants from explicit source changes. Preserve
queue-entry identity, duplicate songs, position, and play/pause state. Keep deliberate
TV/Full/Video switching under the existing playback-intent boundary.

### Connectivity and variant discovery

Treat these as separate facts: the active network, server reachability, known catalog
variants, downloaded variants, and the source currently playing. Downloaded-playlist
membership must not imply offline-only capabilities. Refresh the first/current song
independently of resolving a long queue. Retry transient catalog failures and refresh on
network changes, including a handoff that remains continuously online. Do not persist
a failed lookup as evidence that a variant does not exist. Recovery should expose
available choices without gratuitously restarting a successfully playing download.

Android documents that the default network determines normal application requests and
that synchronous capability reads inside network callbacks are race-prone. Consume
callback capabilities and track default-network changes instead.[1][2] Validation is
useful evidence of internet access, but configured-server reachability is separate:
a public-internet probe does not establish that a self-hosted endpoint is accessible.

### Full-size requests and incorrect results

Expose understandable song actions and report asynchronous request status. Resolve song
identity against server catalog metadata; never send arbitrary provider URLs from the
phone. Use the fetcher's verified contract for manual review. Keep downloaded files and
existing playable catalog entries available while a replacement is pending. Check
completed-request replay, concurrency, idempotency, and delivery selection explicitly.
Do not reuse destructive administrative re-import as the report action.

### System media reactions

Advertise Like and Dislike through the Media3 session and route them through the same
preference repository as the app. Keep command availability and button state consistent
with the actual current queue item. Cover related songs as well as themes. Validate
against the pinned Media3 version; current examples may use APIs introduced later.
Controller support varies: exposing a session command does not establish that every
Bluetooth receiver or watch renders that command.[3][4]

## Verification matrix

| Area | Required evidence |
| --- | --- |
| Reactions | Like/unlike, dislike/remove dislike, local write plus server refresh, playing/paused, duplicates, TV/Full/Video |
| Downloaded playlists | Play and shuffle first song; subsequent songs; TV-only and Full-only downloads; both downloaded |
| Network recovery | Cold start, cellular, Wi-Fi, Wi-Fi/cellular handoff, airplane mode and return, failed lookup then success, server outage |
| Source stability | Availability/metadata refresh preserves position and source; explicit mode switch still works |
| Requests | Exact selected theme, manual-review contract, active/completed retries, no local deletion, readable failures and progress |
| System controls | Expanded notification and lock screen, correct selected state, same song position, supported rating controller; hardware when available |
| Release checks | Android unit tests, lint, debug build, relevant server tests/typecheck, open non-draft PR and hosted checks |

Physical-device verification remains unavailable: `adb devices -l` showed no physical
phone or watch. A headless, read-only Android emulator was used for the runtime checks below.

## Investigation findings

### Why first-song variants could remain unavailable

The original connectivity callback ignored the supplied network and capabilities, then
queried the current and all networks synchronously. A Wi-Fi/cellular handoff could therefore
read the previous network. Server probing observed only a Boolean; a handoff that stayed
online did not restart probing. The new callback reducer follows the default network and
increments a generation for network, validation, and link changes. Server probes cancel
and restart on those generations. An online cold-start hint is retained until probing
confirms or rejects it, avoiding a temporary empty remote queue before the first probe.

Playback resolution itself was cache-first, but only read `theme_modes` from Room. A
downloaded song with incomplete or stale descriptors had no dedicated current-song
refresh. `PlaybackVariantHydrator` now fetches the existing anime-detail endpoint, writes
the matching theme's modes, and observes current queue occurrence and verified server
generation. It retries failed lookups at 1, 2, 5, 15, then 30 seconds, and refreshes a
successful result every 60 seconds. Missing themes and failed responses are not written
as absent variants. This runs while the application process is alive, including background
playback; it does not depend on the player screen being open.

The prior `selectThemeMode` also ignored a selection identical to saved intent. After an
offline fallback, actual playback could be TV Size while intent remained Full Size;
selecting Full Size again did nothing. Explicit selections now have their own generation
so retries can resolve again without changing queue-entry identity.

### Why reactions could interrupt playback

The preference observer forced complete resolution after every preference emission;
local preference writes and the subsequent server refresh could both trigger this.
Catalog invalidations did the same. The replacement helper treated descriptor changes
as playback changes and could seek Full Size or Video back to zero. Passive refresh now
retains the active source while updating future queue items and available-mode state.
Disliking the current occurrence immediately skips it once, including when both the
local preference write and server reconciliation emit updates. Likes, shuffle, repeat,
queue additions, and passive refresh retain the current source and play/pause state.
Explicit song/playlist starts and mode changes remain separate from passive refresh.

Final integration review also closed two races. Structural queue reuse is disallowed
while a newer preference or availability revision is unresolved, so a shuffle cannot
cancel that refresh and retain stale eligibility. Repeat-all with only the disliked
current item stops rather than restarting the same song. Offline transitions recompute
downloaded/cached choices; position polling no longer restores stale online choices.

### Fetcher capability and correction semantics

The inspected AMF contract accepts `selection_mode: "review"` on job creation and has
operator candidate/file selection endpoints. No AMF API change is needed to require
manual selection. Selection happens in the fetcher's operator UI, not on the Android
phone. A report requests a new one-theme Full Size job, with the original theme's title
and artists: using metadata from the incorrect existing full-song match would search
for the same wrong song again.

Anime Ongaku permits only one active request per anime and scope. A targeted request
must not replay unrelated active work; conflicts are reported explicitly. Existing
media and mappings remain until a new delivery is ready. Reported phone downloads are
retained in an explicitly removable `Reported` group so subsequent catalog/playlist
reconciliation cannot silently delete them.

Request creation and delivery publication share a per-anime transaction lock. Once a
newer request for the same theme exists, a late older delivery remains stored but cannot
replace that theme's mapping.

The Android and server changes must ship together for the new request actions. Older
servers return an understandable unavailable/update message. No fetcher API change or
production deployment was performed as part of this PR.

Contract evidence: `server/src/music/animeMusicFetcher/schemas.ts`,
`server/src/music/requests/{builder,repository,deliveryService}.ts`, and the local
AnimeMusicFetcher `API.md`, `schemas.py`, and `operator_api.py`, inspected September 14,
2026. The live AMF OpenAPI corroborated job review and selection operations.

## Final verification (September 14, 2026)

- Android: **695 unit tests passed**, with no failures or skips. Coverage includes
  network handoffs, first-song hydration/retry, matching Full/Video descriptors,
  same-intent mode retry, duplicate occurrences, stale queue resolutions, passive
  source retention, dislike skip suppression, request submission/status, and reactions.
- Android lint: **0 errors, 126 warnings**. Debug app and instrumented-test APKs built.
  One incremental D8 internal exception required a clean rebuild. Final verification
  used two Gradle workers and a four-processor JVM limit; no build settings were changed.
- Android emulator: **22 instrumented tests passed**. Real ExoPlayer tests cover
  playing/paused source continuity and explicit mode replacement. A real MediaController
  exercises the production reaction callback, command availability/layout, standard
  ratings, clearing, target rejection, and unchanged transport. Room tests verify retained
  reported downloads after catalog/playlist changes. Existing mode/settings, migration,
  and UI tests also passed. An old playlist-settings assertion was updated to the existing
  `Require selected version` label.
- Server: **745 tests passed, 2 skipped**, including disposable PostgreSQL integration
  tests. Typecheck and build passed. The final request timestamp adjustment also passed
  the 17 request/delivery database tests. Full-suite execution used two workers after
  unrestricted parallel database setup hit the existing five-second test timeouts.
- No production fetcher job was submitted. The manual-review contract was verified
  against provider schemas/OpenAPI and covered by request/build/publication tests.
- Physical cellular/Wi-Fi handoffs, the phone's notification/lock-screen rendering,
  and Bluetooth/Wear OS hardware behavior are **not verified**. Emulator protocol tests
  do not establish that every external controller exposes custom actions.

Reproduction commands from `src/` (with the documented Windows SDK/JDK environment):

```powershell
.\gradlew.bat --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx4096m -XX:ActiveProcessorCount=4 -Dfile.encoding=UTF-8' testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
adb -s emulator-5560 shell am instrument -w com.takeya.animeongaku.debug.test/androidx.test.runner.AndroidJUnitRunner
```

Server tests used `vitest run --maxWorkers=2` with `MIGRATION_TEST_DATABASE_URL` pointing
at a fresh local PostgreSQL container. That disposable container was stopped after testing.

## Physical-device follow-up (September 15, 2026)

Testing on an authorized Pixel 7 Pro exposed a download regression that the earlier
emulator checks missed. Downloading the existing 135-entry smart playlist initially
resolved only a small subset, then its download group became empty after the worker
reported success.

The completion path updated `ThemeEntity` through SQLite `REPLACE`. That deletes the
parent row before inserting it, so `theme_modes` was removed by its cascading foreign
key. Subsequent reconciliation could remove the downloaded media. Theme writes now
use Room `Upsert`, and playlist TV downloads also use the theme's canonical audio URL
when a separate mode descriptor has not been hydrated. Auto-playlist entry replacement
is transactional so observers cannot act on its temporary empty state.

A JVM regression covers missing-descriptor TV downloads. An in-memory Room device
regression checks that a download-state update preserves Full Size metadata and user
preferences. These fixtures do not modify the signed-in account.

Verification after the correction:

- **696 Android unit tests passed**; debug app/test APK builds and lint passed.
- **6 physical-device instrumented tests passed**: three isolated Room download tests,
  two real ExoPlayer continuity tests, and the isolated MediaSession reaction test.
- All **135 playlist downloads completed** (361,896,727 bytes). Every recorded file
  existed, and all 135 memberships/files remained after offline use and app restarts.
- The first downloaded song after Play exposed TV/Full/Video online. Full Size advanced
  to 11 seconds; Video rendered and advanced. A shuffled first song also exposed all
  three choices without advancing to a second song.
- Offline Play and a cold-start offline Shuffle both played downloaded TV audio. The
  mode picker restricted itself to TV. Reconnection restored Full/Video while retaining
  TV: playing position advanced from 9,393 to 24,449 ms; a separate paused reconnect
  retained exactly 10,722 ms.
- Shuffle/repeat changes retained the same paused song at exactly 9,552 ms. Earlier
  playing-state checks also advanced without a reset.
- No app crash appeared in the device crash log. The original 141-entry queue/current
  index and playback preferences were restored, with playback paused. Wi-Fi and mobile
  data settings were restored; the 135 requested downloads were retained.

Before the user's live-account restriction, brief Like/Unlike and Dislike checks were
performed; the temporary reactions were restored to neutral. Subsequent testing avoids
reaction, song-preference, and request/report writes. The expanded Pixel media player
visibly displayed Like and Dislike buttons. Actual Wear OS/Bluetooth reaction rendering
and lock-screen interaction remain unverified.

The Pixel reported `NOT_READY` for both SIM slots and no default network with Wi-Fi
disabled. Wi-Fi/offline testing cannot establish real cellular behavior on this device.
No USB reverse tunnel was used. New request/report submissions remain untested against
production because the new server endpoint has not been deployed.

## Sources

1. Android Developers, [Read network state](https://developer.android.com/develop/connectivity/network-ops/reading-network-state), accessed September 14, 2026.
2. Android Developers, [ConnectivityManager.NetworkCallback](https://developer.android.com/reference/android/net/ConnectivityManager.NetworkCallback), accessed September 14, 2026.
3. Android Developers, [Control and advertise playback using a MediaSession](https://developer.android.com/media/media3/session/control-playback), accessed September 14, 2026.
4. Android Developers, [Media controls](https://developer.android.com/media/implement/surfaces/mobile), accessed September 14, 2026.
