# Dynamic Playlists

## Context

Today Anime Ongaku ships two built-in auto-playlists ("Currently Watching", "Liked Songs") via [AutoPlaylistManager](src/app/src/main/java/com/takeya/animeongaku/sync/AutoPlaylistManager.kt). Users cannot build their own filter-based playlists.

**Goal:** let users define a set of metadata filters (genre, air year, season, rating, watch status, theme type, artist, etc.) that auto-populates a playlist. Two authoring modes share one underlying filter tree:
- **Simple mode** — predefined chip/slider sections; within a section multi-select is OR, across sections is AND.
- **Advanced mode** — node-graph editor with arbitrary AND/OR/NOT nesting.

Each playlist is saved as either **Auto-updating** (re-evaluated on sync + daily) or **Snapshot** (one-shot + manual refresh). Result playlists reuse the existing playlist detail UI with a "Smart" badge and "Edit filters" entry.

Prototype screens live in `prototype_ui_filter_playlists/` (simple creator, advanced node builder, preview/save, smart detail view). Color palette + gradient already match our Material3 dark theme.

**Key gap:** most filter dimensions in the prototype (genres, subtype, start/end date, ratings, library-entry updated-at) are not currently fetched from Kitsu. Phase 1 widens that before any UI work.

## User-confirmed decisions

1. **Rating source:** simple mode shows a single "Minimum Rating" section with a **Mine / Average** toggle (default *Mine*). Advanced mode exposes `UserRatingGte` and `AverageRatingGte` as separate leaves.
2. **Time UI (simple mode):** preset chips *+* a "Custom range" option. Custom supports two sub-modes: **relative** (e.g. "last N months") and **exact** (start/end dates). Presets: *Any time*, *Last 6 months*, *Last 2 years*, *Before 2000*, *2000–2010*, *2010–2020*.
3. **Refresh strategy:** sync hook (`SyncManager`) + daily `WorkManager` job with `requiresBatteryNotLow`. Snapshot playlists skip both and expose manual refresh.
4. **Scope:** Auto-updating **and** Snapshot both ship in v1.

**Note on time semantics:** the time filter operates on **two distinct dimensions**:
- *Air date* (anime `startDate`): e.g. "Before 2000", "Retro Anime".
- *Watch date* (library entry `updatedAt`): e.g. "Last 6 months" of *your* activity.
Simple mode exposes one "Time period" section with a sub-toggle **Aired / Watched**; presets default sensibly (Before 2000 → Aired; Last 6 months → Watched).

---

## Architecture

### Data flow
```
FilterNode (tree) ──► FilterEvaluator ──► List<ThemeId>
        ▲                    ▲
        │                    │
  JSON (Moshi)        Room (AnimeEntity, GenreEntity,
        │             ThemeEntity, UserPref, PlayCount, LibraryEntry)
        │
  dynamic_playlist_spec row

DynamicPlaylistManager mirrors AutoPlaylistManager:
  find-or-create PlaylistEntity(isAuto=true)
  → clear entries → insert evaluated entries → markEvaluated
```

`isAuto=true` is retained for dynamic playlists — this automatically inherits the sparkles badge, "no manual add" guard, and stale-anime cleanup protection. Presence of a row in `dynamic_playlist_spec` discriminates "smart" from basic auto.

---

## Phase 1 — Kitsu fetch widening + schema (MEDIUM)

Populate the metadata needed by every filter. Independently mergeable; no user-visible feature yet.

### Schema changes

**[AnimeEntity](src/app/src/main/java/com/takeya/animeongaku/data/local/AnimeEntity.kt)** — add nullable columns:
- `subtype: String?` — `TV | movie | OVA | ONA | special | music`
- `startDate: String?` — ISO `YYYY-MM-DD`
- `endDate: String?`
- `episodeCount: Int?`
- `ageRating: String?`
- `averageRating: Double?` — 0–10 (convert from Kitsu's 0–100)
- `userRating: Double?` — 0–10 (convert from library-entry `ratingTwenty/2`)
- `libraryUpdatedAt: Long?` — epoch millis from library-entry `updatedAt`; drives "Last N months" filter
- `slug: String?`

**New** `data/local/GenreEntity.kt`:
```kotlin
@Entity(tableName = "genres")
data class GenreEntity(
    @PrimaryKey val slug: String,
    val displayName: String,
    val source: String  // "category" | "genre"
)
```

**New** `data/local/AnimeGenreCrossRef.kt`:
```kotlin
@Entity(
    tableName = "anime_genres",
    primaryKeys = ["kitsuId", "slug"],
    foreignKeys = [ForeignKey(entity = AnimeEntity::class, parentColumns=["kitsuId"], childColumns=["kitsuId"], onDelete = CASCADE)],
    indices = [Index("slug")]
)
data class AnimeGenreCrossRef(val kitsuId: String, val slug: String)
```

**New** `data/local/DynamicPlaylistSpecEntity.kt`:
```kotlin
@Entity(
    tableName = "dynamic_playlist_spec",
    foreignKeys = [ForeignKey(entity = PlaylistEntity::class, parentColumns=["id"], childColumns=["playlistId"], onDelete = CASCADE)]
)
data class DynamicPlaylistSpecEntity(
    @PrimaryKey val playlistId: Long,
    val filterJson: String,
    val mode: String,         // "AUTO" | "SNAPSHOT"
    val createdMode: String,  // "SIMPLE" | "ADVANCED" — hint for edit UX
    val lastEvaluatedAt: Long,
    val lastResultCount: Int,
    val schemaVersion: Int
)
```

**New** DAOs: `GenreDao`, `DynamicPlaylistSpecDao` (registered in [AppDatabase.kt](src/app/src/main/java/com/takeya/animeongaku/data/local/AppDatabase.kt)).

**Migration** — bump DB version, add `MIGRATION_N_N+1` in [DatabaseModule.kt](src/app/src/main/java/com/takeya/animeongaku/di/DatabaseModule.kt):
- `ALTER TABLE anime ADD COLUMN ...` × 9 (all nullable; no backfill needed)
- `CREATE TABLE genres ...`
- `CREATE TABLE anime_genres ...` + index on `slug`
- `CREATE TABLE dynamic_playlist_spec ...`

### Kitsu fetch widening

[KitsuApi.kt](src/app/src/main/java/com/takeya/animeongaku/data/remote/KitsuApi.kt) + [KitsuModels.kt](src/app/src/main/java/com/takeya/animeongaku/data/remote/KitsuModels.kt):
- Widen `fields[anime]` to include `subtype,startDate,endDate,episodeCount,ageRating,averageRating,slug`.
- Add `include=anime.categories,anime.genres` on library-entry requests.
- Add `fields[libraryEntries]=status,updatedAt,ratingTwenty`.
- Add `fields[categories]=slug,title` and `fields[genres]=slug,name`.
- Extend DTOs; parse polymorphic `included` array (keyed on `type`) via Moshi polymorphic adapter (existing `Moshi` provider in [NetworkModule.kt](src/app/src/main/java/com/takeya/animeongaku/di/NetworkModule.kt)).

[UserRepositoryImpl](src/app/src/main/java/com/takeya/animeongaku/data/repository/) → return genre cross-refs alongside anime. [SyncManager.kt](src/app/src/main/java/com/takeya/animeongaku/sync/SyncManager.kt) anime construction — populate new fields, persist cross-refs via `GenreDao`.

### Tests
- Room migration test (`MigrationTestHelper`) — v<old>→v<new>, old data intact, new columns NULL, new tables exist.
- Moshi DTO round-trip for new included-polymorphic shape.
- Sync mapping: fake Kitsu response with genre includes → assert `AnimeEntity` + `anime_genres` populated.

---

## Phase 2 — Filter tree model + evaluator (MEDIUM)

Pure logic, no UI, no DB writes. Fully unit-testable.

### Filter tree

`data/filter/FilterNode.kt`:
```kotlin
sealed interface FilterNode {
    // Operators (n-ary And/Or for readability; unary Not)
    data class And(val children: List<FilterNode>) : FilterNode
    data class Or(val children: List<FilterNode>) : FilterNode
    data class Not(val child: FilterNode) : FilterNode

    // Anime metadata leaves
    data class GenreIn(val slugs: List<String>, val matchAll: Boolean = false) : FilterNode
    data class AiredBefore(val year: Int) : FilterNode
    data class AiredAfter(val year: Int) : FilterNode
    data class AiredBetween(val minYear: Int, val maxYear: Int) : FilterNode
    data class SeasonIn(val seasons: List<Season>) : FilterNode
    data class SubtypeIn(val subtypes: List<String>) : FilterNode
    data class AverageRatingGte(val min: Double) : FilterNode   // 0..10
    data class UserRatingGte(val min: Double) : FilterNode

    // Library / user leaves
    data class WatchingStatusIn(val statuses: List<String>) : FilterNode
    data class LibraryUpdatedAfter(val epochMillis: Long) : FilterNode     // exact
    data class LibraryUpdatedWithin(val durationMillis: Long) : FilterNode // relative — resolved at eval

    // Theme leaves
    data class ThemeTypeIn(val types: List<String>) : FilterNode  // "OP" | "ED" | "IN"
    data class ArtistIn(val artistNames: List<String>) : FilterNode // case-insensitive
    data object Liked : FilterNode
    data object Disliked : FilterNode
    data object Downloaded : FilterNode
    data class PlayCountGte(val min: Int) : FilterNode
    data class PlayedSince(val epochMillis: Long) : FilterNode
}

enum class Season { WINTER, SPRING, SUMMER, FALL }
```

**Moshi serialization** — `PolymorphicJsonAdapterFactory` keyed on `"type"` discriminator, registered in [NetworkModule.kt](src/app/src/main/java/com/takeya/animeongaku/di/NetworkModule.kt)'s `provideMoshi()`. One subtype per leaf/operator.

### Evaluator

`data/filter/FilterEvaluator.kt` — **in-memory** evaluator:

```kotlin
class FilterEvaluator @Inject constructor(
    private val animeDao: AnimeDao,
    private val themeDao: ThemeDao,
    private val genreDao: GenreDao,
    private val userPreferenceDao: UserPreferenceDao,
    private val playCountDao: PlayCountDao,
    private val downloadDao: DownloadDao,
    private val clock: Clock
) {
    suspend fun evaluate(filter: FilterNode): List<Long>
    suspend fun count(filter: FilterNode): Int
}

data class EvaluationContext(
    val themes: List<ThemeEntity>,
    val animeByThemesId: Map<Long, AnimeEntity>,
    val genresByKitsuId: Map<String, Set<String>>,
    val likedThemeIds: Set<Long>,
    val dislikedThemeIds: Set<Long>,
    val downloadedThemeIds: Set<Long>,
    val playCountByTheme: Map<Long, Int>,
    val lastPlayedByTheme: Map<Long, Long>,
    val nowMillis: Long
)
```

**Why in-memory not dynamic SQL:** user libraries are bounded (hundreds of anime × a few themes each = low thousands of rows). In-memory is trivially testable, handles `Not(complex)` and nested `Or` without SQL contortions, and eliminates a SQL-injection surface. Generating `@RawQuery` SQL for arbitrary boolean trees is significantly more complex for no measurable perf win at this scale.

**Null handling (documented contract):** for positive leaf predicates, `null` field → no match. Under `Not`, `null` → match. Keeps `And(Not(X), Not(Y))` sensible for exclusion semantics. Covered by tests.

**Ordering:** default comparator = anime title → theme type rank (OP < ED < IN < other) → sequence number (same as [PlaylistDetailViewModel.kt:58-79](src/app/src/main/java/com/takeya/animeongaku/ui/library/PlaylistDetailViewModel.kt) auto sort).

### Tests (`src/app/src/test/java/.../data/filter/`)
- `FilterEvaluatorTest` — one test per leaf + nesting combinators + null-handling contract. ≥30 cases.
- `FilterNodeMoshiTest` — parametrized round-trip for every subtype.
- `And(emptyList())` matches all; `Or(emptyList())` matches none (documented).

---

## Phase 3 — Persistence & DynamicPlaylistManager (SMALL–MEDIUM)

Reuses the `AutoPlaylistManager` pattern. No UI yet.

### Files
- `data/repository/DynamicPlaylistRepository.kt` — serialization + CRUD + preview:
  ```kotlin
  suspend fun createDynamic(name, filter, mode, createdMode): Long
  suspend fun updateDynamic(playlistId, filter)
  suspend fun deleteDynamic(playlistId)
  suspend fun refreshOne(playlistId)          // manual path
  fun observeSpec(playlistId): Flow<DynamicPlaylistSpecEntity?>
  suspend fun previewCount(filter): Int
  suspend fun previewTracks(filter, limit=20): List<PlaylistTrack>
  ```
- `sync/DynamicPlaylistManager.kt` — sibling of [AutoPlaylistManager.kt](src/app/src/main/java/com/takeya/animeongaku/sync/AutoPlaylistManager.kt):
  ```kotlin
  suspend fun refreshAllAutoSuspend()
  suspend fun refreshOne(playlistId)
  ```
  Internally: load spec → parse `filterJson` via Moshi → `evaluator.evaluate(filter)` → `playlistDao.deletePlaylistEntries(id)` + `playlistDao.insertEntries(...)` with `orderIndex` → `specDao.markEvaluated(...)`.
- Register `DynamicPlaylistSpecDao`, `GenreDao`, `FilterEvaluator`, `DynamicPlaylistManager`, `DynamicPlaylistRepository` in Hilt modules.

### SyncManager integration
In [SyncManager.kt](src/app/src/main/java/com/takeya/animeongaku/sync/SyncManager.kt) at both hook points (currently :181, :507), append:
```kotlin
autoPlaylistManager.refreshAutoPlaylistsSuspend()
dynamicPlaylistManager.refreshAllAutoSuspend()   // new
```
Inject `DynamicPlaylistManager` into the constructor.

### Tests
- In-memory Room integration: seed anime/themes, call `refreshOne` with a known filter, assert `playlist_entries` matches expected order.
- Snapshot-mode spec is skipped by `refreshAllAutoSuspend()`.
- Update flow: change filter → rerun → stale entries removed.

---

## Phase 4 — Simple creator UI + preview/save (MEDIUM)

### Routes (add to [AnimeOngakuApp.kt](src/app/src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt) `Routes`)
- `dynamic/simple`
- `dynamic/preview`
- `dynamic/advanced` (stub until Phase 5)
- `dynamic/edit/{playlistId}` (stub until Phase 7)

All four wrapped in a **nested nav graph** so a single scoped ViewModel survives screen transitions.

### Shared scoped ViewModel: `DynamicPlaylistDraftViewModel`
Location: `ui/dynamic/DynamicPlaylistDraftViewModel.kt`, obtained via `hiltViewModel(parentEntry)` keyed on the nested nav graph.

```kotlin
data class DynamicDraftState(
    val createdMode: CreatedMode = SIMPLE,
    val simple: SimpleSectionsState = SimpleSectionsState(),
    val advancedTree: FilterNode = FilterNode.And(emptyList()),
    val draftName: String = "",
    val saveMode: DynamicMode = AUTO,
    val previewCount: Int = 0,
    val previewTracks: List<PlaylistTrack> = emptyList(),
    val isPreviewLoading: Boolean = false,
    val availableGenres: List<GenreEntity> = emptyList(),
    val editingPlaylistId: Long? = null
)

data class SimpleSectionsState(
    val timeMode: TimeMode = TimeMode.ANY,            // preset enum
    val customRange: CustomRange? = null,              // relative or exact
    val timeDimension: TimeDimension = AIRED,          // AIRED | WATCHED
    val seasons: Set<Season> = emptySet(),
    val genreSlugs: Set<String> = emptySet(),
    val genreMatchAll: Boolean = false,
    val minRating: Double? = null,
    val ratingSource: RatingSource = MINE,             // MINE | AVERAGE
    val subtypes: Set<String> = emptySet(),
    val watchingStatuses: Set<String> = emptySet(),
    val themeTypes: Set<String> = emptySet()           // OP/ED/IN
)

sealed interface CustomRange {
    data class Relative(val durationMillis: Long) : CustomRange
    data class Exact(val startYear: Int, val endYear: Int) : CustomRange
}
```

**Live preview pipeline:**
```kotlin
val filter = state.map { it.compileToFilterNode() }.distinctUntilChanged()
val preview = filter
    .debounce(250)
    .mapLatest { repo.previewTracks(it, 20) to repo.previewCount(it) }
    .stateIn(scope, WhileSubscribed(5_000), Empty)
```
`debounce(250)` coalesces chip/slider events; `mapLatest` cancels stale evaluations.

### Screens

**`ui/dynamic/DynamicSimpleCreatorScreen.kt`** — reuses `Brush.verticalGradient(Ink900, Ink800, Ink700)` + `LazyColumn` of section cards. Sections:
1. **Time period** — segmented AIRED/WATCHED toggle, preset chips (Any time / Last 6 months / Last 2 years / Before 2000 / 2000–2010 / 2010–2020), "Custom range…" chip opens a bottom sheet with relative/exact sub-toggle.
2. **Season** — 4 `FilterChip`s.
3. **Genres** — wrapped `FilterChip`s from `GenreDao.observeAllGenres()`, "Match ANY / ALL" segmented toggle.
4. **Minimum rating** — `Slider 0..10` with display "6.5+", "Mine / Average" segmented toggle.
5. **Media type** — TV / movie / OVA / ONA / special chips.
6. **Watching status** — current / completed / on_hold / dropped / plan_to_watch chips.
7. **Theme type** — OP / ED / IN chips.

Sticky bottom card: **LIVE PREVIEW — "Matching $n tracks"**, buttons `[Advanced Builder]` `[Save Playlist]`. Save disabled when tree compiles to `And([])`.

**`ui/dynamic/DynamicPreviewScreen.kt`** — cover-art row (first 3 anime covers from `previewTracks` + "+N" overflow chip), "$n tracks" subtitle, `OutlinedTextField` playlist name, radio group **Auto-updating / Snapshot** with helper text per option, full-width "Create Playlist" button → `repo.createDynamic(...)` → `navController.popUpTo(Library)` + `navigate("playlist/$newId")`.

### Library entry point
[LibraryScreen.kt](src/app/src/main/java/com/takeya/animeongaku/ui/library/LibraryScreen.kt): promote existing "+" FAB into a small speed-dial with two items: **New Playlist** (existing) and **New Smart Playlist** → `navigate("dynamic/simple")`.

### Tests
- ViewModel `Turbine` tests: toggle events compile expected `FilterNode`; debounce collapses rapid inputs; Save path calls repo with correct args.
- Compile tests for `SimpleSectionsState.compileToFilterNode()` — 10+ shape cases.

---

## Phase 5 — Advanced node builder (MEDIUM–LARGE)

**`ui/dynamic/DynamicAdvancedBuilderScreen.kt`** — **scrollable `LazyColumn` of nodes with indentation depth**, NOT a free-form 2D canvas.

**Why list-not-canvas:** free-form canvas in Compose requires manual `pointerInput` for pan/zoom, `drawBehind` for edges, custom hit-testing, and is screen-reader-hostile. An indented list renders the boolean tree canonically, reuses existing chip/card styling, and is trivially accessible. The prototype's "graph" is visually a vertical tree — the indented-list rendering looks the same.

### Node UI model
```kotlin
sealed interface NodeRow {
    data class OperatorHeader(val op: Op, val depth: Int, val path: NodePath, val childCount: Int) : NodeRow
    data class Leaf(val node: FilterNode, val depth: Int, val path: NodePath) : NodeRow
    data class AddChildSlot(val parentPath: NodePath, val depth: Int) : NodeRow
}
typealias NodePath = List<Int>   // child-index path from root
```

Flatten tree → `List<NodeRow>` for `LazyColumn`. Each row:
- Operator header: badge (`AND` pink, `OR` gold, `NOT` red) + chevron + overflow menu (wrap in NOT, delete, change op).
- Leaf: 1-line summary (e.g. "Genre = Action, Romance"), edit / delete icons. Tap → bottom sheet with the matching editor composable (genre chips, rating slider, year range, etc.).
- Add slot: ghost button → "Add filter…" bottom sheet (leaf type picker, then editor).

Tree mutations are path-based pure functions on `FilterNode`:
```kotlin
fun FilterNode.replaceAt(path: NodePath, replacement: FilterNode): FilterNode
fun FilterNode.insertAt(path: NodePath, child: FilterNode): FilterNode
fun FilterNode.removeAt(path: NodePath): FilterNode
fun FilterNode.wrapAt(path: NodePath, wrapper: (FilterNode) -> FilterNode): FilterNode
```
Unit-testable without any Compose.

FAB "+" at root → add top-level filter.

"Save Logic" → advance to `dynamic/preview` (same shared ViewModel, same save flow).

**Simple → Advanced promotion:** pressing "Advanced Builder" in the simple creator compiles `SimpleSectionsState` to a `FilterNode`, assigns to `advancedTree`, flips `createdMode = ADVANCED`. One-way; going back discards the advanced edits (warn before).

### Tests
- Tree transform functions: 20+ cases covering `replace/insert/remove/wrap` at various paths.
- ViewModel tests: promote, edit via path, save.
- Compose snapshot tests (via Paparazzi or Roborazzi if available) for rendering at depths 0–3.

---

## Phase 6 — Snapshot + daily WorkManager (SMALL)

### Snapshot mode
Already modeled (`mode = "SNAPSHOT"`). Only behavioral differences:
- `refreshAllAutoSuspend()` query is `WHERE mode = 'AUTO'` → snapshots untouched.
- `PlaylistDetailScreen` overflow menu (when spec present and `mode == SNAPSHOT`): **Refresh now** → `repo.refreshOne(id)`.

### Daily worker
`work/DynamicPlaylistDailyWorker.kt`:
```kotlin
@HiltWorker
class DynamicPlaylistDailyWorker @AssistedInject constructor(
    @Assisted ctx: Context,
    @Assisted params: WorkerParameters,
    private val manager: DynamicPlaylistManager
) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = runCatching {
        manager.refreshAllAutoSuspend()
        Result.success()
    }.getOrElse { Result.retry() }
}
```

`work/DynamicPlaylistWorkScheduler.kt` schedules a `PeriodicWorkRequestBuilder<...>(24, HOURS)` with `ExistingPeriodicWorkPolicy.KEEP`, unique name `"dynamic_playlist_daily"`, `setRequiresBatteryNotLow(true)`, `setBackoffCriteria(LINEAR, 30 min)`. Called from Application `onCreate` alongside existing WorkManager init.

### Tests
- `WorkManagerTestInitHelper` — schedule, execute, assert manager called.

---

## Phase 7 — Edit flow + detail polish (SMALL)

- Route `dynamic/edit/{playlistId}` — loads spec, pre-populates shared ViewModel (`createdMode` determines which screen to land on), skips create-vs-update branching in the repository.
- [PlaylistDetailScreen.kt](src/app/src/main/java/com/takeya/animeongaku/ui/library/PlaylistDetailScreen.kt) overflow menu gains:
  - **Edit filters** (visible when spec present) → `dynamic/edit/$id`.
  - **Refresh now** (visible when `mode == SNAPSHOT`).
  - **Delete playlist** (already-present behavior applies via `isAuto` hide check — check and un-hide for dynamic playlists so the user can delete them).
- [PlaylistDetailViewModel.kt](src/app/src/main/java/com/takeya/animeongaku/ui/library/PlaylistDetailViewModel.kt): collect `DynamicPlaylistRepository.observeSpec(id)`, expose `isDynamic` + `dynamicMode`.
- Badge differentiation: swap `Icons.Rounded.AutoAwesome` → `Icons.Rounded.AutoFixHigh` (or similar) when `isDynamic`. Subtitle shows "Smart • auto-updating" or "Smart • snapshot · updated <relative-time>".

Per user feedback, editing a snapshot playlist always re-evaluates on save but leaves `mode = SNAPSHOT` intact.

---

## Critical files to touch

| File | Phase | Purpose |
|---|---|---|
| [data/local/AnimeEntity.kt](src/app/src/main/java/com/takeya/animeongaku/data/local/AnimeEntity.kt) | 1 | Add 9 nullable columns |
| [data/local/AppDatabase.kt](src/app/src/main/java/com/takeya/animeongaku/data/local/AppDatabase.kt) | 1 | Register new entities + DAOs, bump version |
| [di/DatabaseModule.kt](src/app/src/main/java/com/takeya/animeongaku/di/DatabaseModule.kt) | 1 | Migration, DAO providers |
| [di/NetworkModule.kt](src/app/src/main/java/com/takeya/animeongaku/di/NetworkModule.kt) | 1, 2 | Moshi polymorphic adapter for `FilterNode` |
| [data/remote/KitsuApi.kt](src/app/src/main/java/com/takeya/animeongaku/data/remote/KitsuApi.kt), [KitsuModels.kt](src/app/src/main/java/com/takeya/animeongaku/data/remote/KitsuModels.kt) | 1 | Widened fields + genre includes |
| [sync/SyncManager.kt](src/app/src/main/java/com/takeya/animeongaku/sync/SyncManager.kt) | 1, 3 | Map new fields + cross-refs; call `DynamicPlaylistManager` |
| `data/local/GenreEntity.kt`, `AnimeGenreCrossRef.kt`, `GenreDao.kt` | 1 | **NEW** |
| `data/local/DynamicPlaylistSpecEntity.kt`, `DynamicPlaylistSpecDao.kt` | 1, 3 | **NEW** |
| `data/filter/FilterNode.kt`, `FilterEvaluator.kt`, `EvaluationContext.kt` | 2 | **NEW** |
| `data/repository/DynamicPlaylistRepository.kt` | 3 | **NEW** |
| `sync/DynamicPlaylistManager.kt` | 3 | **NEW** — pattern: [AutoPlaylistManager.kt](src/app/src/main/java/com/takeya/animeongaku/sync/AutoPlaylistManager.kt) |
| [ui/AnimeOngakuApp.kt](src/app/src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt) | 4, 5, 7 | 4 new routes in nested nav graph |
| [ui/library/LibraryScreen.kt](src/app/src/main/java/com/takeya/animeongaku/ui/library/LibraryScreen.kt) | 4 | FAB speed-dial with "New Smart Playlist" |
| `ui/dynamic/DynamicPlaylistDraftViewModel.kt` | 4 | **NEW** — shared across simple/advanced/preview |
| `ui/dynamic/DynamicSimpleCreatorScreen.kt`, `DynamicPreviewScreen.kt` | 4 | **NEW** |
| `ui/dynamic/DynamicAdvancedBuilderScreen.kt` + node editor bottom sheets | 5 | **NEW** |
| `work/DynamicPlaylistDailyWorker.kt`, `DynamicPlaylistWorkScheduler.kt` | 6 | **NEW** |
| [ui/library/PlaylistDetailScreen.kt](src/app/src/main/java/com/takeya/animeongaku/ui/library/PlaylistDetailScreen.kt), [PlaylistDetailViewModel.kt](src/app/src/main/java/com/takeya/animeongaku/ui/library/PlaylistDetailViewModel.kt) | 7 | "Smart" badge, Edit filters / Refresh now menu items |

---

## Phase dependency graph
```
1 (schema + Kitsu) ──► 2 (filter tree + evaluator) ──► 3 (persistence + manager)
                                                             │
                                                             ├──► 4 (simple UI + save) ──► 6 (snapshot + worker) ──► 7 (edit + polish)
                                                             │
                                                             └──► 5 (advanced UI) ─────────┘
```
Phases 4 and 5 parallelizable after Phase 3.

---

## Verification (end-to-end)

### Per-phase automated tests
- **Phase 1**: `./gradlew test` (Moshi parsing, sync mapping) + `./gradlew connectedAndroidTest --tests "*MigrationTest"` (Room migration on device).
- **Phase 2**: `./gradlew test --tests "com.takeya.animeongaku.data.filter.*"` — evaluator + Moshi.
- **Phase 3**: `./gradlew connectedAndroidTest --tests "*DynamicPlaylistManagerTest"` — Room integration.
- **Phase 4/5**: ViewModel Turbine tests + optional Compose snapshot tests.
- **Phase 6**: `./gradlew connectedAndroidTest --tests "*DynamicPlaylistDailyWorkerTest"`.

### Manual acceptance flows
1. **Simple playlist creation**: Library → "+" → New Smart Playlist → pick "Genres: Romance+Comedy, Rating ≥ 4 (Mine), Status: Completed" → preview shows count → Save → Auto-updating → verify new playlist with Smart badge in Library and detail renders tracks sorted by anime title.
2. **Date-relative freshness**: Create "Last 6 months watched" filter → note count → advance device clock +1 day (or wait for daily worker) → verify playlist re-evaluates. Manually: force-run worker via `adb shell cmd jobscheduler run -f com.takeya.animeongaku`.
3. **Advanced node graph**: create `AND(OR(genre=action, genre=mecha), NOT(subtype=movie))` → verify matches expected subset → save.
4. **Snapshot**: create with Snapshot mode → verify sync does NOT refresh → use "Refresh now" → verify re-evaluation.
5. **Edit filter**: from detail overflow → Edit filters → adjust → Save → playlist contents update, mode preserved.
6. **Upgrade path**: install v<old> with data → upgrade to v<new> → verify existing "Currently Watching" / "Liked Songs" still present; trigger sync → verify new metadata populated on anime rows.

### Runtime checks to validate design
- Add a debug log in `FilterEvaluator.evaluate` with time-taken; confirm <100ms on representative libraries (≤5k themes).
- Spot-check `dynamic_playlist_spec.lastEvaluatedAt` updates after sync + daily worker via DB inspector.

---

## Deferred / out of scope for v1
- Anime-level "has any matching theme" queries in the graph (always operate on themes today).
- Cross-user sharing of filter definitions.
- Import/export filter JSON.
- Filter templates ("Retro openings", "My favorites by year") — could be seeded in a follow-up.
- Soft cap on count of AUTO dynamic playlists (25) — monitor after launch, add only if daily worker shows strain.