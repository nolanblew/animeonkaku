# I1 Implementation Plan -- Client Reads From Server

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a server URL is configured, Android pulls library/user state from the self-hosted API and uses server media URLs for playback/downloads, while blank server URL keeps the legacy direct-Kitsu path.

**Architecture:** Add a small server-pull data source that maps `OngakuApi.library()` DTOs into the existing Room cache. Reuse current UI/media/download components by preserving `ThemeEntity`/`AnimeEntity` shapes and only changing URL/source data when server mode is enabled.

**Tech Stack:** Kotlin, Hilt, Room, Retrofit/OkHttp, WorkManager, Media3, JUnit.

---

## File Structure

- Create `src/app/src/main/java/com/takeya/animeongaku/sync/LibraryPullMapper.kt`: pure DTO-to-entity and relative-URL mapping helpers.
- Create `src/app/src/main/java/com/takeya/animeongaku/sync/LibraryPullManager.kt`: orchestrates `GET /v1/library?since=`, applies Room changes in a transaction, reconciles server prefs/auto playlists, and updates `ServerSettingsStore.serverPullCursor`.
- Create `src/app/src/main/java/com/takeya/animeongaku/work/LibraryPullWorker.kt`: periodic background server pull.
- Create `src/app/src/main/java/com/takeya/animeongaku/work/LibraryPullScheduler.kt`: schedules 6 h network-connected pulls only when server mode is configured.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/local/*Dao.kt`: add focused delete/upsert helpers needed by the pull manager.
- Modify `src/app/src/main/java/com/takeya/animeongaku/media/AudioCacheProvider.kt`: add server bearer headers to Media3 HTTP requests so protected `/v1/media/audio/{id}` works.
- Modify `src/app/src/main/java/com/takeya/animeongaku/download/DownloadWorker.kt`: request server audio warming and send bearer auth for server downloads.
- Modify `src/app/src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt`: in server mode, poll `/v1/sync/status`, then pull `/v1/library` when the server sync completes.
- Modify `src/app/src/main/java/com/takeya/animeongaku/MainActivity.kt` and `AnimeOngakuApp.kt`: replace legacy status-sync triggers with gated server pulls and schedule the worker.
- Modify `server/README.md`: add the manual I1 end-to-end script.
- Test with `src/app/src/test/java/com/takeya/animeongaku/LibraryPullMapperTest.kt`, `LibraryPullManagerTest.kt`, and focused updates to existing tests where needed.

## Task 1: Pure Library Pull Mapping

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/sync/LibraryPullMapper.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/LibraryPullMapperTest.kt`

- [x] **Step 1: Write failing mapper tests**

Add tests that call:

```kotlin
val baseUrl = "http://192.168.1.5:8080/api/"
val anime = dto.toAnimeEntity(baseUrl)
val theme = dto.toThemeEntity(baseUrl, existingDownloadedTheme)
val artistRefs = dto.toArtistCrossRefs()
val genreRows = animeDto.toGenreRows()
```

Assert that relative media paths become `http://192.168.1.5:8080/api/v1/media/...`, downloaded `ThemeEntity.isDownloaded/localFilePath` are preserved, artists keep `asCharacter`/`alias`, and genre display names are stable.

- [x] **Step 2: Run RED**

Run:

```powershell
$env:ANDROID_HOME='F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\android-sdk'; $env:ANDROID_SDK_ROOT=$env:ANDROID_HOME; $env:JAVA_HOME='F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\openjdk\jdk-21.0.8'; $env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;C:\Windows\System32;$env:Path"; .\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.LibraryPullMapperTest"
```

Expected: compile fails because `LibraryPullMapper` does not exist.

- [x] **Step 3: Implement mapper**

Implement functions with these signatures:

```kotlin
fun OngakuAnimeDto.toAnimeEntity(serverBaseUrl: String): AnimeEntity
fun OngakuThemeDto.toThemeEntity(serverBaseUrl: String, existing: ThemeEntity?): ThemeEntity
fun OngakuThemeDto.toArtistCrossRefs(): List<ThemeArtistCrossRef>
fun OngakuAnimeDto.toGenreRows(): Pair<List<GenreEntity>, List<AnimeGenreCrossRef>>
fun resolveServerUrl(serverBaseUrl: String, value: String?): String?
```

- [x] **Step 4: Run GREEN**

Run the same focused mapper test command. Expected: pass.

## Task 2: Transactional Server Pull

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/sync/LibraryPullManager.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/ThemeDao.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/ArtistDao.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/GenreDao.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/UserPreferenceDao.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/PlayCountDao.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/LibraryPullManagerTest.kt`

- [x] **Step 1: Write failing manager tests**

Use an in-memory Room database, fake `OngakuApi`, and `ServerSettingsStore(FakeSharedPreferences())`. Cover:

```kotlin
pullNow(forceFull = true)
```

Expected effects: anime/themes upsert, tombstoned anime/themes removed, existing downloaded theme fields preserved, server prefs replace local liked/disliked rows, play counts mirror server totals, and `serverPullCursor` equals response `serverTime`.

- [x] **Step 2: Run RED**

Run:

```powershell
$env:ANDROID_HOME='F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\android-sdk'; $env:ANDROID_SDK_ROOT=$env:ANDROID_HOME; $env:JAVA_HOME='F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\openjdk\jdk-21.0.8'; $env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;C:\Windows\System32;$env:Path"; .\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.LibraryPullManagerTest"
```

Expected: compile fails because `LibraryPullManager` does not exist.

- [x] **Step 3: Add DAO helpers**

Add only the methods the manager uses:

```kotlin
ThemeDao.deleteByIds(themeIds: List<Long>)
ArtistDao.deleteCrossRefsForThemes(themeIds: List<Long>)
GenreDao.deleteForAnimeIds(kitsuIds: List<String>)
UserPreferenceDao.upsertAll(preferences: List<UserPreferenceEntity>)
PlayCountDao.upsertAll(playCounts: List<PlayCountEntity>)
```

- [x] **Step 4: Implement `LibraryPullManager`**

Inject `AppDatabase`, `OngakuApi`, `ServerSettingsStore`, DAOs, `AutoPlaylistManager`, and `DynamicPlaylistManager`. If server mode is not configured, return `LibraryPullResult.Skipped`. Otherwise fetch `library(since = null)` for `forceFull` or cursor `0`, apply changes in `database.withTransaction`, then fetch/reconcile `themePrefs()` and `autoPlaylists()`.

- [x] **Step 5: Run GREEN**

Run the focused manager tests. Expected: pass.

## Task 3: Pull Scheduling and Lifecycle Gating

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/work/LibraryPullWorker.kt`
- Create: `src/app/src/main/java/com/takeya/animeongaku/work/LibraryPullScheduler.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/AnimeOngakuApp.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/MainActivity.kt`

- [x] **Step 1: Write failing lifecycle test or compile guard**

Add a unit-level scheduler test if WorkManager test dependencies are already present. If not, keep this compile-verified and rely on full Gradle tests.

- [x] **Step 2: Implement worker/scheduler**

`LibraryPullWorker.doWork()` calls `LibraryPullManager.pullNow(forceFull = false)`, retries while attempts are below 3, and succeeds when server mode is disabled. `LibraryPullScheduler.schedule()` enqueues unique 6 h periodic work with `NetworkType.CONNECTED`.

- [x] **Step 3: Gate activity triggers**

In `MainActivity`, if `ServerSettingsStore.isConfigured`, call `libraryPullManager.pullIfStale(5 min)` on cold start, `pullIfStale(60 min)` on warm resume, and run the 2 h foreground loop against `LibraryPullManager`; otherwise keep `StatusSyncService` legacy behavior.

## Task 4: Server Sync Polling in Import UI

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/sync/ServerSyncStatusMapper.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/ServerSyncStatusMapperTest.kt`

- [x] **Step 1: Write failing status mapper tests**

Assert `RUNNING` plus phases like `KITSU_FULL_SYNC`, `MAP_THEMES`, `BACKFILL_SCAN`, and terminal `IDLE`/`FAILED` map to existing `SyncState` and `SyncPhase` values.

- [x] **Step 2: Implement status mapper and polling**

Server mode `performServerSync()` posts `/v1/sync`, polls `/v1/sync/status` every 2 seconds while `state == "RUNNING" || state == "QUEUED"`, updates a server-side `SyncState`, and calls `libraryPullManager.pullNow(forceFull = true)` after completion.

- [x] **Step 3: Keep legacy path intact**

Blank server URL must keep the existing `SyncManager` flow and `LibrarySyncService.start(...)` behavior.

## Task 5: Playback and Download Auth

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/media/AudioCacheProvider.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/download/DownloadWorker.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/PlaybackMediaItemsTest.kt`

- [x] **Step 1: Write failing auth/header tests where practical**

At minimum, assert server `ThemeEntity.audioUrl` is used when not downloaded and `file://localPath` still wins when downloaded.

- [x] **Step 2: Add Media3 bearer headers**

Inject `ServerTokenStore` into `AudioCacheProvider` and set `Authorization: Bearer <token>` on the HTTP data source factory when a token exists.

- [x] **Step 3: Warm server audio before downloads**

Inject `OngakuApi` and `ServerSettingsStore` into `DownloadWorker`; before `downloadFile`, call `ongakuApi.requestAudio(themeId)` when server mode is configured. Ensure the download request carries auth for server URLs and still follows 302 to origin.

## Task 6: Server README Manual E2E Script

**Files:**
- Modify: `server/README.md`

- [x] **Step 1: Add I1 manual script**

Document: fresh compose up, configure app Server URL, login using Kitsu credentials, full sync, play a PENDING track, replay after server cache, offline download, airplane-mode playback, and cross-device like visibility.

## Task 7: Full Verification and PR

**Files:**
- Modify: `.planing/FINAL_PLAN.md` after PR creation.

- [x] **Step 1: Run all checks**

Run Android `gradlew.bat --no-daemon test`, server Vitest, server typecheck, and `docker compose build`.

- [ ] **Step 2: Commit and push**

Commit I1 implementation, push `codex/i1-client-server-integration`, open a stacked PR, then add the PR link under I1 in `FINAL_PLAN.md`.
