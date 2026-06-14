# S4 Library Sync Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the S4 server-side Kitsu library sync pipeline and scheduler so `KITSU_FULL_SYNC`, `KITSU_DELTA_SYNC`, `MAP_THEMES`, `BACKFILL_SCAN`, and `AUTO_PLAYLIST_REFRESH` jobs produce global catalog rows, per-user library rows, media backfill jobs, and auto playlists.

**Architecture:** Add a `server/src/sync/` module with a testable orchestration layer over existing S2 clients and S3 job queue/media schema. Keep upstream parsing in `kitsu/` and `animethemes/`; persistence lives behind `SyncRepository` with a Drizzle implementation. Add job progress support to the jobs table so long sync jobs can expose phase/cursor state and yield to urgent queue work between batches.

**Tech Stack:** TypeScript strict, Fastify, Drizzle/Postgres, Vitest, existing `JobQueue`, `KitsuClient`, `AnimeThemesClient`, and `MediaStore`.

---

## File Structure

- Modify `server/src/db/schema.ts`: add `jobs.progress jsonb` for sync progress.
- Generate a Drizzle migration under `server/drizzle/`.
- Modify `server/src/jobs/types.ts`, `jobQueue.ts`, `pgJobRepository.ts`, and `test/helpers/fakeJobRepository.ts`: expose `progress`, `updateProgress`, and urgent-queue checks.
- Create `server/src/sync/types.ts`: sync repository/client contracts and progress types.
- Create `server/src/sync/librarySyncPipeline.ts`: full/delta Kitsu sync phases, theme mapping fallbacks, checkpoint/yield behavior, backfill scan, auto playlist refresh.
- Create `server/src/sync/drizzleSyncRepository.ts`: Drizzle persistence for catalog/library/genres/themes/playlists/media maintenance.
- Create `server/src/sync/jobHandlers.ts`: adapters from S4 job payloads to `LibrarySyncPipeline`.
- Create `server/src/sync/scheduler.ts`: in-process tickers for per-user delta sync, daily auto playlist/orphan scan, weekly failed-media requeue.
- Create `server/src/sync/index.ts`: exports.
- Modify `server/src/index.ts`: instantiate S4 clients/repository/pipeline/handlers/scheduler and merge handlers with S3 fetch handlers.
- Modify `server/src/api/authRoutes.ts` and `server/src/app.ts`: optional post-login hook to enqueue first full sync for new users.
- Add tests:
  - `server/test/sync.library.test.ts`
  - `server/test/sync.mapping.test.ts`
  - `server/test/sync.backfillPlaylists.test.ts`
  - `server/test/sync.handlersScheduler.test.ts`

---

## Task 1: Job Progress + Urgent Checkpoint Support

**Files:**
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/jobs/types.ts`
- Modify: `server/src/jobs/jobQueue.ts`
- Modify: `server/src/jobs/pgJobRepository.ts`
- Modify: `server/test/helpers/fakeJobRepository.ts`
- Test: `server/test/sync.handlersScheduler.test.ts`

- [x] **Step 1: Write the failing test**

Add a test that creates a queued urgent job and proves `JobQueue.hasUrgentQueued()` returns true, then calls `updateProgress()` and verifies the stored job progress changed.

- [x] **Step 2: Verify RED**

Run:

```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run test/sync.handlersScheduler.test.ts
```

Expected: fail because the test file or methods do not exist.

- [x] **Step 3: Implement job progress**

Add `progress: Record<string, unknown>` to `JobRecord`, repository methods `updateProgress(id, progress)` and `hasQueuedPriorityAtOrBelow(priority)`, fake implementation, Postgres implementation, and `JobQueue.updateProgress()` / `JobQueue.hasUrgentQueued()`.

- [x] **Step 4: Generate migration**

Run:

```powershell
& 'E:\Users\Nolan\npm\npm.cmd' run db:generate
```

Expected: new Drizzle migration adds `progress jsonb DEFAULT '{}'::jsonb NOT NULL` to `jobs`.

- [x] **Step 5: Verify GREEN**

Run the focused test command again. Expected: pass.

---

## Task 2: Full/Delta Library Sync Persistence

**Files:**
- Create: `server/src/sync/types.ts`
- Create: `server/src/sync/librarySyncPipeline.ts`
- Create: `server/src/sync/drizzleSyncRepository.ts`
- Create: `server/src/sync/index.ts`
- Test: `server/test/sync.library.test.ts`

- [x] **Step 1: Write failing tests**

Cover:
- full sync upserts Kitsu anime catalog and `library_entries`, tombstones missing non-manual entries, writes genres, updates `last_sync_at` and `last_status_sync_at`, and enqueues `MAP_THEMES`.
- delta sync uses `last_status_sync_at`, updates changed library rows, does not tombstone absent rows, and still refreshes auto playlists when no entries changed.
- Kitsu auth state `REAUTH_REQUIRED` causes sync to skip without retry-spinning.

- [x] **Step 2: Verify RED**

Run:

```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run test/sync.library.test.ts
```

Expected: fail because sync module does not exist.

- [x] **Step 3: Implement minimal sync orchestration**

Implement `LibrarySyncPipeline.runKitsuSync({ userId, full, job })` over injected `SyncRepository`, `KitsuClientLike`, and `JobQueueLike`. Persist in phases:
1. load user sync auth/timestamps,
2. fetch full or delta Kitsu entries,
3. upsert Kitsu catalog and library rows,
4. tombstone missing rows only for full sync,
5. fetch/upsert categories for touched ids,
6. enqueue `MAP_THEMES` for touched unmapped/stale ids,
7. enqueue `AUTO_PLAYLIST_REFRESH`,
8. update user timestamps and job progress.

- [x] **Step 4: Verify GREEN**

Run focused test. Expected: pass.

---

## Task 3: Theme Mapping Fallbacks

**Files:**
- Modify: `server/src/sync/librarySyncPipeline.ts`
- Modify: `server/src/sync/drizzleSyncRepository.ts`
- Test: `server/test/sync.mapping.test.ts`

- [x] **Step 1: Write failing tests**

Cover:
- direct Kitsu-id mapping allows two Kitsu rows to map to the same AnimeThemes anime id (N:1).
- MAL fallback maps a remaining Kitsu id through `KitsuClient.getAnimeMappings()` and `AnimeThemesClient.fetchByMalIds()`.
- title fallback only accepts exact normalized `animeName` or `animeNameEn` matches and rejects candidates explicitly linked to another Kitsu id.
- all fallbacks failing marks `mapping_state=UNMATCHED`.
- yielding to an urgent job between mapping batches re-enqueues `MAP_THEMES` with remaining ids and stops current work.

- [x] **Step 2: Verify RED**

Run:

```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run test/sync.mapping.test.ts
```

Expected: fail on missing mapping behavior.

- [x] **Step 3: Implement fallback chain**

Implement `runMapThemes({ kitsuIds, job })`:
1. direct `fetchByKitsuIds`,
2. MAL id lookup/fetch for still unmapped,
3. strict title search over catalog title variants for still unmapped,
4. save `animethemes_anime`, `themes`, `theme_artists`, `artists`, and `kitsu_anime.animethemes_anime_id`,
5. mark remaining ids `UNMATCHED`,
6. enqueue `BACKFILL_SCAN` and `AUTO_PLAYLIST_REFRESH`.

- [x] **Step 4: Verify GREEN**

Run focused test. Expected: pass.

---

## Task 4: Backfill Scan + Auto Playlists + Maintenance

**Files:**
- Modify: `server/src/sync/librarySyncPipeline.ts`
- Modify: `server/src/sync/drizzleSyncRepository.ts`
- Test: `server/test/sync.backfillPlaylists.test.ts`

- [x] **Step 1: Write failing tests**

Cover:
- `BACKFILL_SCAN` enqueues one MAINTENANCE `FETCH_AUDIO:{themeId}` job for each library-referenced theme missing READY audio.
- auto playlist refresh recomputes Kitsu Library, Currently Watching, and Liked Songs with deterministic order indexes.
- FAILED audio media requeue turns failed audio rows into missing/queued work.
- orphan scan deletes files not referenced by READY `media_files` rows.

- [x] **Step 2: Verify RED**

Run:

```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run test/sync.backfillPlaylists.test.ts
```

Expected: fail on missing behavior.

- [x] **Step 3: Implement backfill and playlist methods**

Add pipeline methods `runBackfillScan`, `runAutoPlaylistRefresh`, `requeueFailedMedia`, and `scanOrphanFiles`; add matching repository methods.

- [x] **Step 4: Verify GREEN**

Run focused test. Expected: pass.

---

## Task 5: Job Handlers, Scheduler, Bootstrap, and New-User Sync

**Files:**
- Create: `server/src/sync/jobHandlers.ts`
- Create: `server/src/sync/scheduler.ts`
- Modify: `server/src/sync/index.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/api/authRoutes.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/sync.handlersScheduler.test.ts`

- [x] **Step 1: Write failing tests**

Cover:
- each S4 job type validates payload and calls the matching pipeline method.
- scheduler tick enqueues `KITSU_DELTA_SYNC` for active users with NORMAL priority.
- daily scheduler tick enqueues `AUTO_PLAYLIST_REFRESH` and runs orphan scan.
- weekly scheduler tick requeues failed media.
- new user login enqueues HIGH `KITSU_FULL_SYNC:{userId}`.

- [x] **Step 2: Verify RED**

Run:

```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run test/sync.handlersScheduler.test.ts
```

Expected: fail on missing job handlers/scheduler/auth hook.

- [x] **Step 3: Implement integration**

Create handler factory and scheduler. In `index.ts`, instantiate real `KitsuClient`, `AnimeThemesClient`, `DrizzleSyncRepository`, `LibrarySyncPipeline`, merge S4 handlers with `FETCH_AUDIO`/`FETCH_IMAGE`, start scheduler, and stop it in shutdown.

- [x] **Step 4: Verify GREEN**

Run focused test. Expected: pass.

---

## Final Verification

- [x] Run all server tests:

```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
```

- [x] Run server typecheck:

```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit
```

- [x] Run Docker build:

```powershell
$env:Path='C:\Program Files\Docker\Docker\resources\bin;C:\Windows\System32;' + $env:Path; & 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose build
```

- [x] Run Android unit tests:

```powershell
$env:ANDROID_HOME='F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\android-sdk'; $env:ANDROID_SDK_ROOT=$env:ANDROID_HOME; $env:JAVA_HOME='F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\openjdk\jdk-21.0.8'; $env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;C:\Windows\System32;$env:Path"; .\gradlew.bat --no-daemon test
```

- [x] Commit implementation, push branch, open PR to `feature/server-initiative`, then update `FINAL_PLAN.md` S4 with the PR link in a follow-up commit.
