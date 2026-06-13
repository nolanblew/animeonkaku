# I2 Migration Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Android app over to server-only mode, migrate existing local user state to the server once, delete legacy Kitsu/AnimeThemes client code, and fix the two remaining client bugs called out in doc 08.

**Architecture:** The Android app keeps Room as an offline cache, but every network read/write goes through `OngakuApi`. A small one-time migration manager uploads local prefs, play totals, manual playlists, and dynamic playlist specs after a server session exists, then the existing `LibraryPullManager` rewrites catalog URLs from `/v1/library`. Legacy Android Kitsu/AnimeThemes sync classes are deleted after their remaining UI callers are moved to the server-backed repository.

**Tech Stack:** Kotlin, Hilt, Room, WorkManager, Retrofit/Moshi, Media3 cache, JUnit; server verification uses Node/Vitest/TypeScript.

---

## File Structure

- Create `src/app/src/main/java/com/takeya/animeongaku/sync/ServerMigrationManager.kt`
  - Owns the one-time migration orchestration and returns a small result object for UI/tests.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/server/ServerSettingsStore.kt`
  - Add migration completion flags and make them testable via `FakeSharedPreferences`.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/local/PlaylistDao.kt`
  - Add `getManualPlaylists()` for migration.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/local/DynamicPlaylistSpecDao.kt`
  - Add `getAll()` for migration.
- Create `src/app/src/main/java/com/takeya/animeongaku/data/repository/ServerAnimeRepository.kt`
  - Replaces direct AnimeThemes/Kitsu network calls with `OngakuApi` calls and DTO parsing.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/repository/AnimeRepository.kt`
  - Remove sync-only methods after `SyncManager` deletion; keep only online UI methods needed by search/detail screens.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/remote/OngakuApi.kt`
  - Type `search()` and `artist()` responses instead of returning `Any`.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/remote/OngakuModels.kt`
  - Add proxy response DTOs for server search/artist responses.
- Modify `src/app/src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt`
  - Remove legacy Kitsu auth/sync branches; always use server auth/sync and run migration after login.
- Modify `src/app/src/main/java/com/takeya/animeongaku/MainActivity.kt`
  - Remove `LibraryStatusSyncManager` and `StatusSyncService` fallback; always use server pull cadence when configured and local cache otherwise.
- Modify `src/app/src/main/java/com/takeya/animeongaku/AnimeOngakuApp.kt`
  - Keep `LibraryPullScheduler`/`PendingWritesScheduler`; no legacy sync scheduling.
- Modify `src/app/src/main/java/com/takeya/animeongaku/di/NetworkModule.kt`
  - Remove Kitsu Retrofit/Auth providers and `RateLimitInterceptor`; keep `RetryInterceptor` on server HTTP.
- Modify `src/app/src/main/java/com/takeya/animeongaku/di/RepositoryModule.kt`
  - Bind `AnimeRepository` to `ServerAnimeRepository`; remove `UserRepository` binding if no callers remain.
- Delete legacy files after compile-driven cleanup:
  - `src/app/src/main/java/com/takeya/animeongaku/data/remote/KitsuApi.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/data/remote/KitsuAuthApi.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/network/KitsuAuthInterceptor.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/network/RateLimitInterceptor.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/data/auth/KitsuAuthRepository.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/data/auth/KitsuAuthRepositoryImpl.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/data/auth/KitsuToken.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/data/auth/KitsuTokenStore.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/data/repository/UserRepository.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/data/repository/UserRepositoryImpl.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/data/repository/AnimeRepositoryImpl.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/sync/SyncManager.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/sync/LibrarySyncService.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/sync/LibraryStatusSyncManager.kt`
  - `src/app/src/main/java/com/takeya/animeongaku/sync/StatusSyncService.kt`
- Modify `src/app/src/main/AndroidManifest.xml`
  - Remove `LibrarySyncService` and `StatusSyncService`.
- Modify `src/app/src/main/java/com/takeya/animeongaku/media/PreCacheManager.kt`
  - Replace key-only cache check with complete-span check.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/local/DownloadEntity.kt`
  - Add `STATUS_RETRYING`.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/local/DownloadDao.kt`
  - Add `markRetrying()` and include retrying in active/pending queries.
- Modify `src/app/src/main/java/com/takeya/animeongaku/download/DownloadWorker.kt`
  - Mark retrying before `Result.retry()` and failed only when retries are exhausted.
- Modify `src/app/src/main/java/com/takeya/animeongaku/data/local/AppDatabase.kt`
  - Bump Room to 21 with a lightweight `server_migration_state` table if migration state moves into Room; otherwise document why prefs state means no schema data change and keep schema generation stable. Prefer a Room table only if needed by implementation.
- Modify docs:
  - `README.md`
  - `CLAUDE.md`
  - `.planing/FINAL_PLAN.md`

---

### Task 1: Write I2 Migration Tests

**Files:**
- Create: `src/app/src/test/java/com/takeya/animeongaku/ServerMigrationManagerTest.kt`
- Modify: `src/app/src/test/java/com/takeya/animeongaku/ServerStoresTest.kt`

- [x] **Step 1: Add server migration state expectations to `ServerStoresTest`**

Add a test that proves the store starts unmigrated and records completion:

```kotlin
@Test
fun `server settings track one time migration completion`() {
    val store = ServerSettingsStore(FakeSharedPreferences())

    assertFalse(store.isServerMigrationComplete)
    store.markServerMigrationComplete()

    assertTrue(store.isServerMigrationComplete)
}
```

- [x] **Step 2: Add failing migration orchestration tests**

Create `ServerMigrationManagerTest.kt` with tests for the exact migration contract:

```kotlin
@Test
fun `migration skips until server is configured and session exists`() = runBlocking {
    val api = MigrationRecordingOngakuApi()
    val manager = serverMigrationManager(
        settings = ServerSettingsStore(FakeSharedPreferences()),
        api = api,
        session = null
    )

    val result = manager.migrateIfNeeded()

    assertFalse(result.migrated)
    assertEquals(ServerMigrationSkipReason.NotReady, result.skipReason)
    assertFalse(api.anyWriteCalled)
}

@Test
fun `migration uploads prefs play totals manual playlists and dynamic specs once`() = runBlocking {
    val prefs = listOf(UserPreferenceEntity(themeId = 10L, isLiked = true, isDisliked = false))
    val plays = listOf(PlayCountEntity(themeId = 10L, playCount = 3, lastPlayedAt = 1000L))
    val playlists = listOf(PlaylistEntity(id = 7L, name = "Manual", createdAt = 1L, isAuto = false))
    val entries = mapOf(7L to listOf(10L, 11L))
    val specs = listOf(
        DynamicPlaylistSpecEntity(
            playlistId = 7L,
            filterJson = """{"type":"liked"}""",
            mode = "AUTO",
            createdMode = "SIMPLE",
            sortJson = """{"orders":[]}""",
            simpleStateJson = """{"rows":[]}"""
        )
    )
    val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
        serverBaseUrl = "http://192.168.1.5:8080/api"
    }
    val api = MigrationRecordingOngakuApi()
    val manager = serverMigrationManager(
        settings = settings,
        api = api,
        session = ServerSession("token", "123", "nblewtest"),
        preferences = prefs,
        playCounts = plays,
        playlists = playlists,
        playlistEntries = entries,
        specs = specs
    )

    val result = manager.migrateIfNeeded()
    val second = manager.migrateIfNeeded()

    assertTrue(result.migrated)
    assertEquals(OngakuThemePrefPatch(liked = true, disliked = false), api.prefWrites.single().second)
    assertEquals(listOf(10L, 10L, 10L), api.playEvents.map { it.themeId })
    assertEquals(OngakuPlaylistRequest(name = "Manual", entries = listOf(10L, 11L)), api.createdPlaylists.single())
    assertEquals(
        mapOf(
            "filterJson" to mapOf("type" to "liked"),
            "mode" to "AUTO",
            "createdMode" to "SIMPLE",
            "sortJson" to mapOf("orders" to emptyList<Any>()),
            "simpleStateJson" to mapOf("rows" to emptyList<Any>()),
            "schemaVersion" to 1
        ),
        api.updatedSpecs.single().second
    )
    assertTrue(settings.isServerMigrationComplete)
    assertFalse(second.migrated)
    assertEquals(1, api.createPlaylistCallCount)
}
```

- [x] **Step 3: Run the new tests and verify RED**

Run from `src\`:

```powershell
$env:ANDROID_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:JAVA_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\openjdk\jdk-21.0.8'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;C:\Windows\System32;$env:Path"
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.ServerStoresTest" --tests "com.takeya.animeongaku.ServerMigrationManagerTest"
```

Expected: compile/test failure because `ServerMigrationManager`, `isServerMigrationComplete`, and `markServerMigrationComplete()` do not exist.

---

### Task 2: Implement One-Time Server Migration

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/sync/ServerMigrationManager.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/server/ServerSettingsStore.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/PlaylistDao.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/DynamicPlaylistSpecDao.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt`

- [x] **Step 1: Add migration flags to `ServerSettingsStore`**

Add:

```kotlin
val isServerMigrationComplete: Boolean
    get() = prefs.getBoolean(KEY_SERVER_MIGRATION_COMPLETE, false)

fun markServerMigrationComplete() {
    prefs.edit().putBoolean(KEY_SERVER_MIGRATION_COMPLETE, true).apply()
}

fun resetServerMigration() {
    prefs.edit().remove(KEY_SERVER_MIGRATION_COMPLETE).apply()
}
```

with:

```kotlin
private const val KEY_SERVER_MIGRATION_COMPLETE = "ongaku_server_migration_complete"
```

- [x] **Step 2: Add DAO reads**

Add to `PlaylistDao`:

```kotlin
@Query("SELECT * FROM playlists WHERE isAuto = 0 ORDER BY createdAt ASC")
suspend fun getManualPlaylists(): List<PlaylistEntity>
```

Add to `DynamicPlaylistSpecDao`:

```kotlin
@Query("SELECT * FROM dynamic_playlist_spec")
suspend fun getAll(): List<DynamicPlaylistSpecEntity>
```

- [x] **Step 3: Implement `ServerMigrationManager`**

Create the manager with this public surface:

```kotlin
data class ServerMigrationResult(
    val migrated: Boolean,
    val skipReason: ServerMigrationSkipReason? = null,
    val uploadedPrefs: Int = 0,
    val uploadedPlayEvents: Int = 0,
    val uploadedPlaylists: Int = 0,
    val uploadedSpecs: Int = 0
)

enum class ServerMigrationSkipReason {
    NotReady,
    AlreadyComplete
}

@Singleton
class ServerMigrationManager @Inject constructor(
    private val settingsStore: ServerSettingsStore,
    private val tokenStore: ServerTokenStore,
    private val preferenceDao: UserPreferenceDao,
    private val playCountDao: PlayCountDao,
    private val playlistDao: PlaylistDao,
    private val dynamicPlaylistSpecDao: DynamicPlaylistSpecDao,
    private val ongakuApi: OngakuApi,
    private val moshi: Moshi
) {
    suspend fun migrateIfNeeded(): ServerMigrationResult
}
```

Implementation rules:
- Return `NotReady` when `settingsStore.isConfigured` is false or `tokenStore.currentSession()` is null.
- Return `AlreadyComplete` when `settingsStore.isServerMigrationComplete` is true.
- Upload every `UserPreferenceEntity` with `PUT /v1/prefs/themes/{id}` using both liked and disliked values.
- Convert each `PlayCountEntity` into `playCount` synthetic `OngakuPlayEvent` values using `lastPlayedAt` as the event timestamp, chunked in batches of 100.
- Upload manual playlists with `POST /v1/playlists` and current local ordered entries.
- Upload dynamic specs with `PUT /v1/playlists/{id}/spec`.
- Convert dynamic spec JSON string fields into JSON values when possible. If parsing fails, preserve the original string so no local user data is dropped.
- Call `settingsStore.markServerMigrationComplete()` only after all uploads succeed.

- [x] **Step 4: Wire migration after server login**

In `ImportViewModel.signInToServer()`, after `ongakuAuthRepository.login(...)` succeeds and before `performServerSync(false)`, call:

```kotlin
serverMigrationManager.migrateIfNeeded()
```

Inject `ServerMigrationManager` and remove the remaining legacy auth/token dependencies in later cleanup tasks.

- [x] **Step 5: Run migration tests and verify GREEN**

Run the same targeted Gradle command from Task 1. Expected: the new migration tests pass.

---

### Task 3: Replace Direct Android Upstream Reads With Server Repository

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/data/repository/ServerAnimeRepository.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/repository/AnimeRepository.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/remote/OngakuApi.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/remote/OngakuModels.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/search/SearchViewModel.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/library/AnimeDetailViewModel.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/library/ArtistDetailViewModel.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/ServerAnimeRepositoryTest.kt`

- [x] **Step 1: Write failing repository tests**

Create tests proving:
- `searchAnimeThemes()` calls `OngakuApi.search()` and maps proxied AnimeThemes search results into `OnlineSearchResult`.
- `fetchAnimeByKitsuId()` calls `OngakuApi.anime(kitsuId)` and returns server media URLs resolved against the configured base URL.
- `fetchArtistSongs(slug)` calls `OngakuApi.artist(slug)` and maps the proxied artist payload.

Use `FakeSharedPreferences` and a fake `OngakuApi`. Expected RED: `ServerAnimeRepository` does not exist and `OngakuApi.search/artist` are still typed as `Any`.

- [x] **Step 2: Add typed proxy DTOs**

Add DTOs:

```kotlin
data class OngakuSearchResponse(
    val query: String,
    val animeThemes: AnimeThemesSearchResponse = AnimeThemesSearchResponse(),
    val kitsu: Any? = null
)

data class AnimeThemesSingleArtistResponse(
    val artist: ApiArtistProfileWithSongs? = null
)

data class ApiArtistProfileWithSongs(
    val id: Long? = null,
    val name: String? = null,
    val slug: String? = null,
    val images: List<ApiArtistImage> = emptyList(),
    val songs: List<ApiArtistSongWithThemes> = emptyList()
)

data class ApiArtistSongWithThemes(
    val title: String? = null,
    val artists: List<ApiArtist> = emptyList(),
    val animethemes: List<ApiThemeWithAnime> = emptyList()
)

data class ApiThemeWithAnime(
    val id: Long? = null,
    val type: String? = null,
    val sequence: Int? = null,
    val anime: ApiAnime? = null,
    val animethemeentries: List<ApiThemeEntry> = emptyList()
)
```

Change `OngakuApi`:

```kotlin
@GET("v1/search")
suspend fun search(@Query("q") query: String): OngakuSearchResponse

@GET("v1/artists/{slug}")
suspend fun artist(@Path("slug") slug: String): AnimeThemesSingleArtistResponse
```

- [x] **Step 3: Implement `ServerAnimeRepository`**

Keep the interface focused on UI needs:

```kotlin
interface AnimeRepository {
    suspend fun searchAnimeThemes(query: String): OnlineSearchResult
    suspend fun fetchAnimeByKitsuId(kitsuId: String): AnimeThemeSyncResult
    suspend fun fetchArtistSongs(artistSlug: String): List<AnimeThemeEntry>
}
```

`ServerAnimeRepository` should:
- Use `OngakuApi.search(query)` for search.
- Use `OngakuApi.anime(kitsuId)` for anime detail.
- Use `OngakuApi.artist(slug)` for artist detail.
- Reuse the old `ApiAnime.toThemeEntries()` mapping logic, but keep it in a server repository file or mapper file that performs no HTTP requests.
- Reject non-numeric theme ids by returning no `AnimeThemeEntry` for that theme, matching the server-side decision.

- [x] **Step 4: Update UI callers**

Update:
- `SearchViewModel.addOnlineThemeToLibrary()` to call `ongakuApi.addAnime(...)` or rely on `ServerAnimeRepository`/`LibraryPullManager` rather than `UserRepository`.
- `AnimeDetailViewModel.fetchFromApi()` to call `animeRepository.fetchAnimeByKitsuId(kitsuId)`.
- `AnimeDetailViewModel.buildOnlineAnimeEntity()` to use the server detail response data already returned instead of `UserRepository`.
- `ArtistDetailViewModel.fetchFromApi()` to derive artist slug from search results or use the slug already passed through navigation; if only name is available, use `searchAnimeThemes(artistName).artists.firstOrNull()?.slug`.

- [x] **Step 5: Run server repository tests**

Run:

```powershell
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.ServerAnimeRepositoryTest"
```

Expected: PASS.

---

### Task 4: Delete Legacy Sync/Auth/Network Path

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/MainActivity.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/di/NetworkModule.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/di/RepositoryModule.kt`
- Modify: `src/app/src/main/AndroidManifest.xml`
- Delete legacy files listed in File Structure.

- [x] **Step 1: Remove legacy branches from `ImportViewModel`**

The server-only import flow should:
- Initialize from `ongakuAuthRepository.currentSession()`.
- Always call `signInToServer(username, password)` when not linked.
- Always call `performServerSync(forceFullSync)` when linked.
- Keep pause/resume/cancel UI no-ops or remove buttons if compile points require it; no `SyncManager` calls remain.
- Keep text user-facing as Kitsu account sign-in because the server still authenticates against Kitsu.

- [x] **Step 2: Remove legacy app startup sync**

`MainActivity` should only use:

```kotlin
if (serverSettingsStore.isConfigured) {
    requestServerPullIfStale(COLD_START_PULL_INTERVAL_MS)
} else {
    autoPlaylistManager.refreshAutoPlaylists()
}
```

and foreground loops should call only `libraryPullManager.pullIfStale(...)` when configured. Do not start `StatusSyncService`.

- [x] **Step 3: Remove Kitsu/AnimeThemes DI**

`NetworkModule` should:
- Keep `provideBaseOkHttpClient()` with `RetryInterceptor()` and logging only.
- Keep `@Named("ongaku")` client and retrofit.
- Remove `@Named("kitsu")`, `@Named("auth")`, `KitsuApi`, `KitsuAuthApi`, `KitsuAuthRepository`, and `KitsuTokenStore` providers.

`RepositoryModule` should:
- Bind `AnimeRepository` to `ServerAnimeRepository`.
- Remove `UserRepository`.

- [x] **Step 4: Delete legacy source files**

Delete the files listed in File Structure once no references remain.

- [x] **Step 5: Run compile-focused tests**

Run:

```powershell
.\gradlew.bat --no-daemon testDebugUnitTest
```

Expected: compile succeeds; tests that imported legacy DTOs are either removed or rewritten against `OngakuApi` server DTOs.

---

### Task 5: Fix PreCache Partial-Span Bug

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/media/PreCacheManager.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/PreCacheManagerTest.kt`

- [x] **Step 1: Write failing cache-completeness tests**

Add a test around a small helper function rather than the full singleton:

```kotlin
@Test
fun `partial cached span is not treated as complete`() {
    assertFalse(isCacheComplete(contentLength = 1_000L, cachedBytes = 400L))
}

@Test
fun `unknown length falls back to key presence`() {
    assertTrue(isCacheComplete(contentLength = -1L, cachedBytes = 1L))
}
```

Expected RED: helper does not exist.

- [x] **Step 2: Implement complete-span check**

Change `isCached(url)` to:
- Build a `DataSpec` for the URL.
- Ask `CacheDataSource`/upstream for content metadata when available.
- Use `cache.isCached(key, 0, contentLength)` when content length is known.
- Fall back to `cache.keys.contains(url)` only when length is unknown.

If a pure helper is introduced, keep it internal and covered by `PreCacheManagerTest`.

- [x] **Step 3: Run targeted test**

Run:

```powershell
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.PreCacheManagerTest"
```

Expected: PASS.

---

### Task 6: Fix Download Retry Status Bug

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/DownloadEntity.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/data/local/DownloadDao.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/download/DownloadWorker.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/DownloadRetryStatusTest.kt`

- [x] **Step 1: Write failing DAO/status tests**

Add tests around a helper function so retry behavior is covered without a full WorkManager harness:

```kotlin
@Test
fun `failed download with remaining attempts is retrying`() {
    assertEquals(
        DownloadRequestEntity.STATUS_RETRYING,
        downloadFailureStatus(runAttemptCount = 0, maxAttempts = 3)
    )
}

@Test
fun `failed download on final attempt is failed`() {
    assertEquals(
        DownloadRequestEntity.STATUS_FAILED,
        downloadFailureStatus(runAttemptCount = 2, maxAttempts = 3)
    )
}
```

Expected RED: `STATUS_RETRYING` and `downloadFailureStatus` do not exist.

- [x] **Step 2: Add retrying status**

Add:

```kotlin
const val STATUS_RETRYING = "retrying"
```

Include retrying in active/download-id queries:
- `observeActiveCount`
- `getActiveDownloadCount`
- batch total queries
- `observeDownloadingThemeIds`
- `getPendingAndFailedDownloads`

Add:

```kotlin
@Query("UPDATE download_request SET status = '${DownloadRequestEntity.STATUS_RETRYING}', errorMessage = :error, updatedAt = :now WHERE themeId = :themeId")
suspend fun markRetrying(themeId: Long, error: String, now: Long = System.currentTimeMillis())
```

- [x] **Step 3: Update `DownloadWorker`**

Introduce:

```kotlin
internal const val DOWNLOAD_MAX_ATTEMPTS = 3

internal fun downloadFailureStatus(runAttemptCount: Int, maxAttempts: Int = DOWNLOAD_MAX_ATTEMPTS): String =
    if (runAttemptCount + 1 >= maxAttempts) DownloadRequestEntity.STATUS_FAILED
    else DownloadRequestEntity.STATUS_RETRYING
```

Before returning `Result.retry()`, call `markRetrying` when attempts remain and `markFailed` only on final attempt. On final attempt, return `Result.failure()` so WorkManager and Room agree.

- [x] **Step 4: Run targeted test**

Run:

```powershell
.\gradlew.bat --no-daemon testDebugUnitTest --tests "com.takeya.animeongaku.DownloadRetryStatusTest"
```

Expected: PASS.

---

### Task 7: Docs, Schema, Full Verification, PR

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `.planing/FINAL_PLAN.md`
- Maybe modify: `src/app/schemas/com.takeya.animeongaku.data.local.AppDatabase/21.json`

- [x] **Step 1: Update docs**

Update `README.md` and `CLAUDE.md` to state:
- The app requires a self-hosted Anime Ongaku server URL for network sync/search/playback of non-downloaded tracks.
- Android no longer talks directly to Kitsu or AnimeThemes.
- Use server login with Kitsu username/email and password; the server owns Kitsu tokens.
- Existing downloaded files keep working offline.
- Developer verification commands use explicit Windows paths from the memory note.

- [x] **Step 2: Update Room schema snapshot if version changes**

If `AppDatabase.version` changes to 21, run the Android tests/build once to let Room export `21.json`, then stage it. If no entity/table schema changes are made, leave the Room version at 20 and mention in the PR why the I2 migration state lives in encrypted prefs.

- [x] **Step 3: Run full Android verification**

From `src\`:

```powershell
$env:ANDROID_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:JAVA_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\openjdk\jdk-21.0.8'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;C:\Windows\System32;$env:Path"
.\gradlew.bat --no-daemon test
```

Expected: BUILD SUCCESSFUL.

- [x] **Step 4: Run server verification**

From `server\`:

```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit
```

Expected: all Vitest tests pass and TypeScript exits 0.

- [x] **Step 5: Run diff checks**

From repo root:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' diff --check
& 'C:\Program Files\Git\cmd\git.exe' status -sb
```

Expected: no whitespace errors; only intentional files modified plus the stale untracked `.planing/CURRENT_TASK.md`.

- [x] **Step 6: Commit, push, and open stacked PR**

Commit the I2 changes, push `codex/i2-migration-cleanup`, and open a PR stacked on `codex/i1-client-server-integration`.

Use Git/GH direct paths:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' add <intentional-files>
& 'C:\Program Files\Git\cmd\git.exe' commit -m "Implement I2 migration cleanup"
$env:Path = 'C:\Program Files\Git\cmd;C:\Windows\System32;' + $env:Path
& 'C:\Program Files\GitHub CLI\gh.exe' pr create --base codex/i1-client-server-integration --head codex/i2-migration-cleanup --title "Implement I2 migration cleanup" --body-file <body-file>
```

- [x] **Step 7: Update `FINAL_PLAN.md` with PR link**

After PR creation, add the PR link to the I2 status line and commit that status update to the same branch.
