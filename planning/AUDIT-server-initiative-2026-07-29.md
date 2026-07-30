# Final remediation audit — `feature/server-initiative` vs `main`

**Date:** 2026-07-29  
**Branch:** `feature/server-initiative`  
**Original audited tip:** `29fe375`  
**Remediated tip:** `8fb1860`  
**Rollback tag:** `checkpoint/server-initiative-pre-audit-remediation-2026-07-29`  
**Base:** `main` / `origin/main` @ `6cf1af9`  
**Change size:** 204 commits, 710 files, +117,425 / -5,322

## Bottom line

All 18 prioritized findings have been remediated and verified at `8fb1860`. The architecture remains a good fit for a small private deployment: the server owns upstream access and cached media; Android remains local-first for library and playback; and the remediation favors direct, low-complexity reliability fixes over unnecessary distributed-system complexity.

The rollback point is preserved by the annotated tag above. The detailed sections below are retained as the historical rationale for the changes; they no longer describe outstanding merge blockers.

### Remediation summary

- Server background work now contains transient failures, cancels cooperative deadline-bound work, and prevents overlapping retries.
- Library/theme/catalog deltas now use an early watermark, publish only changed descriptor/catalog data, and use bounded set-based catalog/search queries.
- Android playback now preserves paused restore intent, retries controller connection failures, resolves queues in batches off the main thread, persists atomically, and reduces continuous work.
- Media pre-cache/download/persistence paths now use the selected URI, respect availability/policy, throttle writes, and safely recover atomic media publication.
- Admin/job/AMF paths now have bounded retention/listing, session expiry, production password validation, post-listen backfill, graph-poll concurrency, and operational logging.

## Verification performed

| Check | Result |
|---|---|
| Server TypeScript | `tsc -p tsconfig.json --noEmit`: green |
| Server real-PostgreSQL suite | 571 passed, 2 skipped; 70 files passed, 1 skipped |
| Android unit tests | 555 / 555 passed |
| Android build checks | `lintDebug` and `assembleDebug`: green |
| Focused persistence regression | 17 / 17 passed |
| Physical device | Pixel 7 Pro: QA passed with 0 crash markers |

Physical-device QA used a data-preserving `install -r` and covered cold paused restore/no autoplay, play/pause/seek/Next, TV Size/video/Related playback, downloads, offline cached playback, and duplicate queue entries. An initial paused-restore regression was found (`101452ms -> 0`) and fixed. The retest preserved the exact paused position (`160014ms -> 160014ms`) with zero drift and no `FATAL` or `ANR` markers. Full mode was unavailable for the initial reachable item; the retest exercised Uruwashi Full Size instead. Download workers queued serially through WorkManager, as expected.

Device evidence is retained under `artifacts/device-qa-2026-07-29`.

### Final status of prioritized findings

| # | Status | Remediation |
|---|---|---|
| 1 | Resolved | Worker/scheduler error boundaries, logging, and continuation tests |
| 2 | Resolved | Recoverable `MediaController` connection handling and bounded retry |
| 3 | Resolved | Explicit playback intent and paused-restore/rebuild protection |
| 4 | Resolved | Batched resolution plus off-main file/artwork work |
| 5 | Resolved | Delta watermark captured before reads |
| 6 | Resolved | Incremental catalog/theme descriptor publication and conditional Room replacement |
| 7 | Resolved | Set-based catalog/search reads and bounded SQL candidate filtering |
| 8 | Resolved | Pre-cache uses resolved playable URI and skips local/unavailable work |
| 9 | Resolved | Download progress writes are throttled to displayed progress/terminal state |
| 10 | Resolved | Atomic now-playing persistence with recovery-safe replacement |
| 11 | Resolved | Position sampling is playback-scoped and lower frequency |
| 12 | Resolved | Serialized foreground pulls at the reduced active-refresh cadence |
| 13 | Resolved | Localized AMF backfill starts after the listener is ready |
| 14 | Resolved | Teardown no longer blocks on synchronous persistence |
| 15 | Resolved | One shared debounced local-search query and stale online-result suppression |
| 16 | Resolved | Splash waits for readiness with a bounded maximum, not a fixed delay |
| 17 | Resolved | Related-music lambdas close over a stable non-null release |
| 18 | Resolved | SQL-limited job listing, scoped sync status reads, and terminal-job retention |

## Historical prioritized findings

| # | Finding | Tier | Severity | Effort |
|---|---|---|---|---|
| 1 | Background worker and scheduler rejections can stop the worker or process | Server | High | Low |
| 2 | `MediaController` connection failure can crash Android on the main thread | Android | High | Low |
| 3 | Queue reconciliation can unexpectedly start paused playback | Android | High | Low-Medium |
| 4 | Queue rebuilding does per-item DB work and main-thread filesystem/bitmap work | Android | High | Medium |
| 5 | Delta cursor race can silently omit a library-entry/anime update | Server/Both | Medium-High | Low-Medium |
| 6 | Every foreground delta poll transfers and rewrites the full music catalog and complete theme list | Both | Medium-High | Medium |
| 7 | Catalog and music search paths use avoidable N+1/full-catalog work | Server | Medium-High | Medium |
| 8 | Pre-cache protects the legacy URL rather than the URI actually selected | Android | Medium-High | Low |
| 9 | Download progress writes to Room every 8 KB | Android | Medium-High | Low |
| 10 | Now-playing persistence is not atomic | Android | Medium | Low |
| 11 | Playback position is polled every 100 ms forever | Android | Medium | Low |
| 12 | The foreground refresh loop is too aggressive even after catalog repair | Both | Medium | Low |
| 13 | AMF backfill performs network work before the server listens | Server | Low-Medium | Low |
| 14 | Playback-service teardown blocks the main thread | Android | Low-Medium | Low |
| 15 | Local search launches six query pipelines for each keystroke | Android | Low-Medium | Low |
| 16 | A fixed one-second splash delay slows every cold start | Android | Low | Trivial |
| 17 | Deferred `selected!!` reads can crash the related-music screen | Android | Low | Trivial |
| 18 | Completed jobs are never pruned and the admin API loads all before slicing | Server | Low | Low |

## Historical detailed findings

### 1. Background worker and scheduler rejections can stop the worker or process

**Where:** `server/src/jobs/jobWorker.ts:89,97-129`; `server/src/sync/scheduler.ts:37-39`

`JobWorker.start()` launches `void this.loop()`. Within `runOnce()`, `claimNext()` is outside the handler `try`, the missing-handler `failRetryable()` is outside it, and the error path can itself throw while calling `failRetryable()`. Any of those failures reject the top-level loop. There is no enclosing catch/restart.

The scheduler similarly uses `setInterval(() => void asyncOperation())` for periodic sync and maintenance. A database outage or unexpected repository error can therefore produce an unhandled rejection. Under the deployed Node runtime this can terminate the process; even if process policy changes, the job loop itself stays dead until restart.

This is exactly the sort of ordinary transient failure that matters more than exotic edge cases for a self-hosted server.

**Recommendation:**

- wrap the worker loop boundary in `try/catch`, log, delay with a small cap/backoff, and continue unless explicitly stopped;
- catch each timer callback at its boundary;
- wrap failure-state persistence so a second database error cannot escape;
- add tests where `claimNext`, a scheduler repository call, and `failRetryable` reject once, then prove later work still runs.

### 2. `MediaController` connection failure can crash Android on the main thread

**Where:** `src/app/src/main/java/com/takeya/animeongaku/media/MediaControllerManager.kt:300-318`

The controller future listener runs on the main executor and calls:

```kotlin
val ctrl = future.get()
```

without catching `ExecutionException`, `CancellationException`, or other connection failures. A service startup problem, Media3 failure, or future cancellation therefore becomes an uncaught main-thread exception. The manager also has no retry/rebind path, so merely swallowing the error would leave playback unusable.

**Recommendation:** catch the failure, leave controller readiness false, expose a recoverable error state, and retry with a short bounded backoff while the app is active. Add a test using a failed/cancelled controller future.

### 3. Queue reconciliation can unexpectedly start paused playback

**Where:** `MediaControllerManager.kt:300-315,562-620`; `AnimeOngakuApp.kt:63-68`

`commitQueueSync()` rebuilds Media3 items and then unconditionally sets `playWhenReady = true` whenever the current item changes or the controller has no current item. This conflicts with the explicit `autoPlay = false` restore path.

There is also a startup ordering race:

1. controller readiness becomes true;
2. queue/preference collectors can begin their initial synchronization;
3. application restore repopulates `NowPlayingManager` before the asynchronous controller restore completes;
4. normal queue reconciliation can rebuild the queue and set `playWhenReady = true`;
5. the restore path may pause it afterward.

This can produce a brief or sustained cold-start auto-play. Mode/filter changes that rebuild the current item have the same underlying problem: queue structure is being used to decide playback intent.

**Recommendation:** carry an explicit playback-intent flag through reconciliation. Preserve the controller's previous `playWhenReady` state for structural rebuilds; only user play actions or explicit bootstrap operations should force it true. Gate normal sync until initial restore has completed, and test a persisted paused queue plus a paused mode/filter rebuild.

### 4. Queue rebuilding does per-item DB work and main-thread filesystem/bitmap work

**Where:** `MediaControllerManager.kt:71,392-477,668-699`; `PlaybackResolution.kt:293-326`

The manager scope is `Dispatchers.Main.immediate`. A desired queue is resolved entry by entry. For each theme entry the resolver can query the theme-mode DAO and download DAO separately. After those suspensions, `File(path).isFile` checks run in the inherited main-thread context. Media-item assembly also performs `includedEntries.first { ... }` for each resolved item, making that portion quadratic.

Artwork loads are concurrent, but the resulting bitmap is cropped on the main scope and the request does not constrain decode size. Four large poster decodes/crops during a queue rebuild are enough to cause visible jank and allocation pressure on mid-range devices.

The likely failure mode is not a deterministic crash; it is sluggish play/skip/queue operations, skipped frames, and occasional ANR or memory pressure—directly in the product's most important workflow.

**Recommendation:**

- load all mode descriptors and completed downloads for the queue in one query per table;
- move file validation and bitmap transformation to `Dispatchers.IO`/`Default` as appropriate;
- request a notification-sized artwork decode (for example 512 px) rather than the source dimensions;
- index entries by queue ID rather than repeatedly using `first`;
- benchmark queue build time with 100 entries, duplicates, local files, and mixed playback modes.

### 5. Delta cursor race can silently omit a library-entry/anime update

**Where:** `server/src/api/drizzleClientApiService.ts:163-178,497-508`

`getLibrary()` first queries changed library rows and only later sets `serverTime`:

```ts
const animeRows = await this.libraryAnimeRows(userId, sinceDate);
// more queries
return {
  serverTime: this.now().getTime(),
  anime,
  themes: await this.libraryThemes(...),
};
```

If a sync commits a library-row update after `libraryAnimeRows()` completes but before `serverTime` is captured, that update is absent from this response. The Android client advances its cursor to the later `serverTime` (`LibraryPullManager.kt:152`); the next request uses strict `gt(updatedAt, since)` comparisons, so the skipped row does not reappear until it is touched again or a forced full pull (`pullNow(forceFull = true)`) resets the cursor.

Queries made after the watermark have the opposite issue—some changes can be returned and then returned again—which is mostly harmless. The missing-row window is not.

**Blast radius, verified:** the window only covers `libraryEntries`/`kitsuAnime` rows (library status, titles, artwork). It cannot lose themes—`libraryThemes()` deliberately returns *every* active theme on every delta (see finding 6)—and prefs, song prefs, and playlists are all queried *after* the watermark inside `getChanges()`, putting them on the safe duplicate side. The window is milliseconds wide (the `activeLibraryMappings` + `genreMap` queries), the consequence is a stale library row rather than data loss, and the background Kitsu sync re-touching the row heals it. Real, cheap to fix, but not in the same class as findings 1–4.

**Recommendation:** capture one watermark before any delta query, preferably from the database clock, and use it for the response. For a strict snapshot, bound every query to `(since, watermark]` inside a consistent transaction. The low-complexity version—capturing before reads and tolerating duplicates—is already enough to prevent permanent omission. Add a concurrency test that inserts an update between the first query and cursor capture.

### 6. Every foreground delta poll transfers and rewrites the full music catalog and complete theme list

**Where:** `server/src/api/drizzleClientApiService.ts:497-508,1080-1090`; `LibraryPullManager.kt:54-70,111-113`; `RoomLibraryPullCache.kt:84-98,137+`; `MainActivity.kt:122-148`; `server/docker-compose.yml:15`

`getChanges(userId, since)` always awaits `getMusicCatalog(userId)`; it does not use `since` for that field. Android then calls `replaceMusicCatalog`, which deletes/reinserts the catalog tables in a transaction. `MainActivity` performs this foreground pull every 60 seconds.

This is not dormant in the supplied deployment: Compose sets `MUSIC_CATALOG_ENABLED` to `true` by default. A user who leaves the app open repeatedly downloads and rewrites an unchanged catalog, invalidating Room observers and doing unnecessary server/phone work.

**The same shape exists for themes, by design.** `libraryThemes()` carries an explicit comment: catalog visibility has no cursor of its own, so *every* active theme is returned on *every* delta request (only tombstones are since-filtered). The client maps all of them and, on each pull, `applyLibraryPull` deletes and reinserts `theme_artist_cross_refs` for every theme and upserts every row of `themes` and `theme_modes` (`RoomLibraryPullCache.kt:88-98`). Room invalidation is table-based, not value-based, so even a no-change pull invalidates every Flow observing those tables — library lists, search, the resolver's mode descriptors — once a minute while the app is foregrounded. Server-side, each such pull also runs `themeArtistMap`/`audioMediaMap`/`themeCatalogModes` over the entire theme set.

**Recommendation:** give the catalog *and* the mode-descriptor visibility their own revision/cursor or `ETag` (a feature-flag flip bumps the revision, which was the stated reason for the always-full theme snapshot), omit both from changes when unchanged, and only rewrite Room data when the revision changes. A simpler acceptable first fix is to return the full catalog/theme snapshot only on `since == null`, skip the client-side rewrite when the payload hash is unchanged, and provide a separate explicit refresh endpoint/version check.

### 7. Catalog and music search paths use avoidable N+1/full-catalog work

**Where:** `drizzleClientApiService.ts:126-160,1554+`; `server/src/db/client.ts:7`

`getMusicCatalog()` gets the user's anime rows and starts one `getAnimeMusic()` call per anime. Each call performs its own anime lookup and release/track join. The promises are launched together but queue behind a PostgreSQL pool whose configured maximum is **5**, so this becomes serialized waves of round trips as the library grows.

`searchMusic()` first loads all ready tracks into Node, filters them in JavaScript, and then calls `readyMusicReleases(..., releaseId)` separately for up to 25 releases. That makes user-visible search time proportional to the complete cached catalog plus the selected-release fan-out.

For fewer than ten users, a single set-based query is enough; no caching framework is needed.

**Recommendation:** fetch all ready release/track rows for the user's AnimeThemes IDs in one joined query and group in memory. For search, filter in SQL and hydrate the selected release IDs with one `IN (...)` query. Record query count and latency for a realistically sized library.

### 8. Pre-cache protects the legacy URL rather than the URI actually selected

**Where:** `PreCacheManager.kt:175-188`; `PlaybackResolution.kt`

Upcoming and protected cache keys are derived with `PlayableItem.playbackUriString(activeServerBaseUrl)`. Actual playback goes through `PlaybackResolver`, which can select TV-size audio, full-size audio, video, a related-music track, or a downloaded local file.

For any non-legacy selection, pre-cache may fetch and protect an object that is never played while the real next URI is cold or evictable. This wastes bandwidth/cache space and defeats the gapless-start benefit precisely for the new full-song and playback-mode features.

**Recommendation:** feed the already resolved desired queue/URI into pre-cache. Skip local files and protect the actual current/next remote cache keys. Test TV-size, full-size, video, related music, and local download selections.

### 9. Download progress writes to Room every 8 KB

**Where:** `DownloadWorker.kt:259-275`

The download loop uses an 8 KB buffer and calls `downloadItemDao.updateProgress()` after every chunk. A 5 MB file therefore causes roughly 640 transactions/invalidations; six concurrent downloads can create thousands of writes while the UI and player share the database.

This is unnecessary flash/CPU work and can make download-heavy playback or browsing feel rough.

**Recommendation:** update only when the displayed integer percentage changes and/or at a 250-500 ms interval, with a forced final update. Keep byte counting in memory.

### 10. Now-playing persistence is not atomic

**Where:** `NowPlayingPersistence.kt:79-91`

The persisted queue is written directly with `file.writeText(json)`, which truncates the destination before the new contents are complete. Process death, storage failure, or a kill during service teardown can leave invalid JSON. Restore then falls back to no state, losing the user's queue and position.

**Recommendation:** write a sibling temporary file, flush/close it, then atomically replace the destination. Preserve or validate the prior file until replacement succeeds. Add a test for an interrupted write/corrupt primary and optional backup recovery.

### 11. Playback position is polled every 100 ms forever

**Where:** `MediaControllerManager.kt:773-793`

A singleton main-scope coroutine wakes ten times per second for the lifetime of the process, including while paused and in the background, to copy controller position into state. This creates continuous main-thread wakeups and recomposition pressure for precision the UI does not need.

**Recommendation:** run only while playing and observed/foregrounded, use player events for discontinuities, and sample position around 250-500 ms for the UI. Update immediately on seek and item change.

### 12. The foreground refresh loop is too aggressive even after catalog repair

**Where:** `MainActivity.kt:122-148`; authenticated server request path

While the process is foregrounded, Android calls the changes route every 60 seconds. Even after removing the full-catalog payload, each request performs authentication/session persistence and several delta queries. Library changes are not time-critical enough to justify a one-minute permanent loop for this deployment.

**Recommendation:** use a 5-15 minute cadence, refresh immediately on login/resume and after relevant local writes, and retain WorkManager for eventual background convergence. Serialize pulls in `LibraryPullManager`; its current stale-check and pull sequence has no mutex, so startup/manual/worker triggers can overlap and race cursor writes.

### 13. AMF backfill performs network work before the server listens

**Where:** `server/src/index.ts:95-103,349`

Startup iterates localized-catalog backfill targets and can submit/query Anime Music Fetcher before `app.listen()`. With slow or unavailable AMF, restart readiness is coupled to the number of outstanding targets and upstream timeout behavior. Health checks cannot pass during this work.

**Recommendation:** start listening after essential database migration/configuration, then enqueue backfill through the durable worker. Readiness should represent the server's ability to serve cached/local data, not completion of optional upstream repair.

### 14. Playback-service teardown blocks the main thread

**Where:** `MediaPlaybackService.kt:128-150`

`onTaskRemoved`/`onDestroy` persist state with `runBlocking(Dispatchers.IO)`. The file operation runs on IO, but the Android lifecycle callback's main thread still waits for it. The full queue is serialized again during a time-sensitive shutdown path, and direct non-atomic output makes blocking less valuable than intended.

**Recommendation:** make normal debounced persistence authoritative, use atomic replacement, and keep the teardown snapshot compact/bounded. If a final synchronous flush remains, avoid doing it twice and enforce a very small timeout.

### 15. Local search launches six query pipelines for each keystroke

**Where:** `SearchViewModel.kt:84-120`

Six derived flows subscribe directly to `_query` with `flatMapLatest`. Every character typed launches separate Room searches for anime, themes, artists, songs, releases, and music. Cancellation prevents stale display but does not eliminate database work already dispatched.

**Recommendation:** normalize and `debounce(200-300 ms)` once, `distinctUntilChanged()`, then share that query flow among result pipelines. Empty-query behavior can remain immediate.

### 16. A fixed one-second splash delay slows every cold start

**Where:** `MainActivity.kt:45-51`

The splash condition is held for exactly one second regardless of whether initialization completed in 50 ms. This makes an otherwise healthy local-first app feel slow on every launch.

**Recommendation:** bind the splash to required startup state with a short maximum timeout. Do not add an artificial minimum unless required for branding.

### 17. Deferred `selected!!` reads can crash the related-music screen

**Where:** `ui/library/RelatedMusicScreen.kt:127-169`

The composable checks selected state and then repeatedly reads `selected!!` inside lazy item and click lambdas. Those lambdas execute later; selection can be cleared or replaced between composition and execution, producing an NPE.

**Recommendation:** capture `val release = selected ?: return` for the relevant composition branch and close over that non-null value. This is a trivial defensive fix with no added architecture.

### 18. Completed jobs are never pruned and the admin API loads all before slicing

**Where:** `server/src/jobs/pgJobRepository.ts:129+`; `server/src/admin/service.ts:71`

The jobs repository has no retention cleanup. Admin `listJobs()` asks the repository for every row, sorts in PostgreSQL, materializes all rows in Node, and only then takes 250. Dedupe limits repeated identical work but not unique requests over the lifetime of the installation.

This is not an immediate issue for a private deployment, but it is cheap to prevent.

**Recommendation:** apply `LIMIT 250` in SQL and add conservative retention, such as deleting completed/cancelled jobs older than 30-90 days while retaining failures longer.

## Historical smaller observations

These do not warrant blocking the branch by themselves:

- `withTimeout()` in `jobWorker.ts` is a `Promise.race`; it marks a timed-out job retryable but does not cancel the underlying handler. A slow AMF poll can continue while a retry is later claimed. Pass an `AbortSignal` where supported or make every timed handler explicitly idempotent and prevent reclaim until the old operation is known to have stopped.
- `SimpleCache` is initialized lazily from the playback service. Its first index/open can land on a play request; initialization off the critical UI path would reduce first-play variance.
- `RetryInterceptor` uses blocking sleeps on OkHttp dispatcher threads and retries broad 5xx responses. At this scale it will not exhaust the dispatcher, but it can add roughly a second of latency to legitimate terminal 5xx responses such as unavailable media. Narrow retryable status/error classes when convenient.
- The default admin password remains an obvious placeholder. Security is intentionally low priority here, but refusing the known default outside development is a nearly free guardrail.
- Some server warnings use raw `console.warn`, so they do not appear in the in-app recent-log store. Route operational warnings through the shared logger for a useful private-server dashboard.
- The server test suite's exact-millisecond flake should be repaired (inject `now`, per the verification section); an intermittently red default test command quickly stops being trusted.
- `SearchViewModel.kt:263` still mints synthetic theme IDs via `abs(entry.themeId.hashCode()).toLong()` and `saveThemeToDb` upserts them into Room. Unreachable in practice (the server rejects non-numeric IDs), but a collision would overwrite a real theme row and `abs(Int.MIN_VALUE)` is negative. Replace the fallback with skipping the entry.
- `PreCacheManager` downloads full upcoming tracks with no network-type check, while `DownloadWorker` honors the WiFi-only preference via WorkManager constraints. Inconsistent with stated user intent on metered connections.
- `MediaStore.fetchToMediaFile`'s catch block deletes `finalPath` (`mediaStore.ts:122-124`). This is safe today only because `findReadyCached` short-circuits READY rows — and `repo.find` is an *optional* interface method. If a repo without `find` were ever wired in, a transient fetch error would delete good cached media. Add an explicit guard.
- `writeAndHash` opens its temp file without the `wx` flag and names it with `Date.now()` (`mediaStore.ts:57,412`), while `copyAndHash` correctly uses `wx` + UUID. Align both.
- The AMF graph poll walks provider jobs sequentially under `POLL_AMF_MUSIC_BATCH`'s 2-minute job timeout (`jobWorker.ts:56`; `handlers.ts:102-125`). A large graph against a slow provider times out and restarts the walk from scratch.
- A perpetually non-terminal AMF batch always carries `lastError: "AMF batch is still active"` from its `RetryableJobError` — normal state rendered as an error in the admin jobs view. Consider a distinct sentinel.
- Admin dashboard sessions (`admin/routes.ts:57`) live in an in-memory `Set` that is only ever added to; cookie `Max-Age` expires client-side only. Unbounded but negligible at this scale.
- `DownloadWorker.getNextBatch` excludes processed items via an ever-growing `NOT IN (:excludedMediaKeys)` list. minSdk 35 SQLite tolerates it, but a `createdAt` cursor would be cleaner.

## Strengths worth preserving

- Android no longer calls Kitsu or AnimeThemes directly; upstream ownership is centralized behind stable server APIs.
- Stable media endpoints support range requests and allow playback from cached media during third-party outages.
- Queue entries have independent identities, and unit tests cover duplicates, shuffle/unshuffle, history, single/multi inserts, and persistence semantics.
- Room migrations are exported and exercised; server migrations and repository behavior also have substantial coverage.
- WorkManager download constraints, bounded download concurrency, checksums, and temporary-file promotion are sensible foundations.
- The server uses durable PostgreSQL jobs and idempotency/dedupe concepts rather than relying solely on in-memory timers.
- Authentication material is kept on the server, while Android stores only the server session token in encrypted preferences.
- Circuit-breaker/retry/health instrumentation and the admin dashboard are appropriate for a small self-hosted service, provided background-loop failures are contained.

## Final conclusion and limitations

The original merge gate has been satisfied by the remediation and verification recorded above. The exact-millisecond server test was deflaked by injecting a fixed clock; the server suite, Android unit/build checks, focused persistence checks, and Pixel 7 Pro pass are green.

The remaining items are low-risk limitations rather than unresolved audit findings:

- Pre-cache is not rerun solely when connectivity or download availability changes; normal queue/playback activity still refreshes its protected set.
- OkHttp retry backoff remains synchronous on the dispatcher thread. Retryability is now narrowed and terminal unavailable audio is excluded.
- A benign JobScheduler warning was observed after a successful `DownloadWorker` run.
- No safe test was available for a third-party-specific outage. Cached/offline playback was exercised instead; the server-side cache design remains the intended outage boundary.
