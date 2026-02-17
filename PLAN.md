# Anime Ongaku - Project Plan (Iteration 1)

## 1. Project Overview
**Goal**: Create a modern, "YouTube Music"-style anime music player for Android.
**Core Functionality**: Listen to Anime OPs, EDs, and OSTs.
**Key Differentiator**: Import user watch lists from **Kitsu** to automatically populate the library with themes from watched shows.
**Target OS**: Android 15 (API Level 35+) - Utilizing latest media standards.

## 2. Core Features (Iteration 1)

### A. Music Playback (The Core)
*   **Audio/Video Playback**: Support for playing anime themes (WebM/MP4 audio streams).
*   **Background Playback**: Music continues when the app is minimized or screen is off.
*   **Media Session Integration**: System media controls (Notification shade, Lock screen).
*   **Offline Mode**: Download tracks for offline playback.

### B. Library & Content
*   **AnimeThemes.moe Integration**: Primary source for metadata, audio, and video links.
*   **Kitsu Sync** (not "import" — it's an ongoing sync, not a one-time action):
    *   User Login (email/password OAuth2) or public username lookup.
    *   **Initial Sync**: Fetch user's full "Currently Watching" and "Completed" anime library.
    *   **Delta Sync**: On subsequent syncs, only fetch *new* entries the user has added since last sync. Never remove anime from the local library — additive only.
    *   **Auto-Match**: Map Kitsu Anime IDs to AnimeThemes resources to populate themes.
    *   **Sync lives in Settings/Account area**, not as a playlist or library item. The Library screen shows the *result* of syncing (anime, songs, playlists) — not the sync mechanism itself.
*   **Custom Playlists**: Users can create, rename, and manage local playlists. Playlists are independent of Kitsu sync — users can create playlists even without a Kitsu account.
*   **Favorites/Library**: "Liked" songs or "Added to Library".

### C. UI/UX
*   **Aesthetic**: "YouTube Music" inspired. Dark mode, immersive.
*   **Glassmorphism**: Heavy use of blur effects, translucent overlays, and gradients.
*   **Navigation**:
    *   **Home**: Recommendations (Random/Trending from API), Quick Picks.
    *   **Explore**: Search/Browse AnimeThemes.
    *   **Library**: Playlists, Imported Kitsu Anime, Downloads.
*   **Player UI**:
    *   Large album art (or video preview).
    *   Standard controls (Play, Pause, Next, Prev, Shuffle, Loop).
    *   Lyrics (if available via API, otherwise placeholder).

## 3. Architecture & Tech Stack

*   **Language**: Kotlin
*   **UI Framework**: Jetpack Compose (Material3)
*   **Architecture Pattern**: MVVM (Model-View-ViewModel) + Clean Architecture principles.
*   **Dependency Injection**: Hilt
*   **Asynchronous**: Coroutines + Flow

### Key Libraries
*   **Media Playback**: `androidx.media3` (ExoPlayer, MediaSession).
*   **Networking**:
    *   `Retrofit` (REST for Kitsu).
    *   `Apollo Kotlin` (GraphQL for AnimeThemes.moe).
*   **Image Loading**: `Coil` (Async Image Loading).
*   **Local Database**: `Room` (Persisting Playlists, Downloaded Tracks metadata, Kitsu Sync cache).
*   **Navigation**: `androidx.navigation:navigation-compose`.

## 4. API Integration Strategy

### A. Kitsu (REST API)
*   **Endpoint**: `https://kitsu.io/api/edge/`
*   **Key Operations**:
    1.  **Find User**: `GET /users?filter[name]={username}` -> Get `id`.
    2.  **Get Library**: `GET /users/{id}/library-entries?filter[status]=current,completed&include=anime`
        *   Pagination strategies needed (limit 500).
        *   Extract `anime.id` (Kitsu ID) and `anime.titles`.

### B. AnimeThemes (GraphQL API)
*   **Endpoint**: `https://api.animethemes.moe/graphql`
*   **Strategy**:
    *   **Search/Mapping**: We need to resolve Kitsu IDs to AnimeThemes Anime.
    *   **Query**: Query `Anime` resources filtering by `Resource` (External Site = 'Kitsu', External ID = {kitsu_id}).
    *   **Content**: Fetch `Themes` (OP/ED), `Artists`, and `Entries` (Video/Audio URLs).

### C. Data Flow (Sync Process)

#### Initial Sync (First Time)
1.  User connects Kitsu account (login or public username).
2.  App fetches Kitsu User ID.
3.  App fetches **all** library entries (`filter[status]=current,completed`, paginated, `sort=-updatedAt`).
4.  **Batch Processing**: App queries AnimeThemes REST API to find theme matches for Kitsu IDs.
5.  Matched Anime + Themes are stored in Room. `lastSyncedAt` timestamp is saved.
6.  User can now play music from their watched shows.

#### Delta Sync (Subsequent Syncs)
1.  App fetches library entries sorted by `-updatedAt` (most recently changed first).
2.  For each page of results, compare Kitsu anime IDs against local Room DB.
3.  **New entries** (Kitsu ID not in local DB) are collected for AnimeThemes mapping.
4.  **Early termination**: Once an entire page contains only already-known IDs, stop paginating — everything older is already synced.
5.  Only new anime + their themes are inserted into Room. **Nothing is ever deleted** from the local library.
6.  `lastSyncedAt` is updated.

#### Key Principles
*   **Additive only**: Sync never removes anime or themes from the user's library. Even if the user drops a show on Kitsu, it stays in Anime Ongaku.
*   **Sync is not a playlist**: The sync mechanism is accessed from the Library screen's Kitsu connection card or a future Settings/Account screen — not mixed into the playlist list.
*   **Playlists are independent**: Users can create and manage playlists without ever connecting Kitsu. Playlists are populated from whatever themes exist in the local DB (from sync or future manual search/add).

## 5. Android 15 Specifics
*   **Foreground Service**:
    *   Type: `mediaPlayback`.
    *   Must show a persistent notification.
    *   Permission: `FOREGROUND_SERVICE_MEDIA_PLAYBACK`.
*   **Edge-to-Edge**: Full support for gesture navigation and status bar transparency.

## 6. Implementation Plan

### Phase 1: Foundation & Player
*   [x] Setup Android Project (Hilt, Navigation, Room, Compose, Media3).
*   [x] Implement `MediaPlaybackService` using Media3/ExoPlayer with foreground service.
*   [x] AndroidManifest: INTERNET, POST_NOTIFICATIONS, FOREGROUND_SERVICE_MEDIA_PLAYBACK permissions.
*   [x] Edge-to-edge enabled in `MainActivity`.
*   [x] Custom theme with dark/light color schemes, Google Fonts (Bebas Neue, Manrope).
*   [x] Bottom navigation (Home, Explore, Library) with NavHost routing.
*   [x] Player screen with full playback controls (play/pause, next/prev, shuffle, repeat, seek, 10s rewind).
*   [x] Player queue system via `PlayerViewModel` (supports single theme, library queue, playlist queue).
*   [x] `rememberMediaController()` composable to connect UI to `MediaPlaybackService`.
*   [x] Real-time player UI state tracking (position, duration, metadata, isPlaying).
*   [x] **BUG**: Player re-sends `setMediaItems` on every recomposition of `queueSignature`/`startIndex` — causes playback restart when navigating back to player.
*   [x] **BUG**: Player auto-plays on navigation even when user hasn't pressed play (calls `prepare()` immediately).
*   [x] **MISSING**: No mini-player / persistent playback bar on bottom nav screens — music stops being visible when leaving player.
*   [x] **MISSING**: No notification artwork (MediaMetadata missing `artworkUri`).

### Phase 2: Data Layer (APIs)
*   [x] Setup Retrofit for Kitsu (REST) with Moshi JSON parsing.
*   [x] Setup OkHttp for AnimeThemes REST API (manual OkHttp calls, not Apollo GraphQL despite dependency).
*   [x] Apollo Client configured but **NOT actually used** — all AnimeThemes calls use raw OkHttp REST.
*   [x] `RateLimitInterceptor` — 350ms minimum delay between requests.
*   [x] `RetryInterceptor` — exponential backoff with jitter, retries on 408/429/5xx.
*   [x] `KitsuAuthInterceptor` — auto-attaches Bearer token + refreshes expired tokens.
*   [x] `KitsuAuthRepository` — login (OAuth2 password grant), token refresh, encrypted token storage.
*   [x] `KitsuTokenStore` — EncryptedSharedPreferences for secure token persistence.
*   [x] `UserRepository` — find user by slug, get authenticated user, paginated library fetch, anime details backfill.
*   [x] `AnimeRepository` — batch map Kitsu IDs → AnimeThemes anime via REST, extract themes with audio URLs.
*   [x] `ArtistRepository` — fetch artist images from AnimeThemes REST API, cache in Room.
*   [x] **CLEANUP**: Removed unused Apollo dependency, GraphQL models, and provider.
*   [x] **MISSING**: AnimeThemes search API integration added (Explore screen rewritten with live search).
*   [x] **MISSING**: GraphQL queries no longer needed — Apollo removed, all calls use REST.

### Phase 3: Kitsu Sync (Reworked)
*   [x] Kitsu login screen with email/password mode (OAuth2 password grant).
*   [x] Kitsu public user search by username (slug-based lookup).
*   [x] Full initial sync flow: login → fetch library → batch map to AnimeThemes → save to Room.
*   [x] Progress reporting UI (library pages, theme mapping batches).
*   [x] Error handling with readable messages for auth failures, HTTP errors.
*   [x] Sign-out functionality (clears token).
*   [x] Backfill missing artwork from Kitsu API after initial sync.
*   [x] Save `AnimeEntity` and `ThemeEntity` to Room database.
*   [x] **REWORK**: Implement delta sync — sort by `-updatedAt`, compare against local DB, early-terminate when all entries on a page are already known.
*   [x] **REWORK**: Store `lastSyncedAt` timestamp in Room or SharedPreferences.
*   [x] **REWORK**: Additive-only — never delete anime/themes from local DB during sync, only insert new ones.
*   [x] **REWORK**: Only map *new* Kitsu IDs to AnimeThemes (skip IDs already in `AnimeEntity` table).
*   [x] **REWORK**: Move "Sync with Kitsu" out of the playlist list — it should be a dedicated card/button in the Library screen header, not a playlist row.
*   [x] **REWORK**: Remove the "Anime Imports" playlist row from Library Playlists tab — synced anime belong in the Animes tab, not as a fake playlist.
*   [x] **REWORK**: Allow playlist creation without Kitsu sync — playlists should work independently (already partially works, but UI implies sync is required).

### Phase 4: Library & Playlists
*   [x] Library screen with tabs: Playlists, Songs, Animes, Artists.
*   [x] "Sync with Kitsu" card linking to Import screen.
*   [x] Create playlist dialog.
*   [x] Playlist detail screen: view tracks, add tracks (search dialog), remove tracks, reorder (move up/down).
*   [x] Songs tab: list all synced themes with play action.
*   [x] Animes tab: list all synced anime with theme counts.
*   [x] Artists tab: list unique artists with track counts and images (fetched from AnimeThemes).
*   [x] Artist image caching in Room (`ArtistImageEntity`).
*   [x] **MISSING**: No "Liked Music" / Favorites functionality — placeholder row removed (deferred to future).
*   [x] **MISSING**: No delete playlist functionality.
*   [x] **MISSING**: No rename playlist functionality.
*   [ ] Implement "Download" (ExoPlayer DownloadService) — **deferred, online-only for now**.
*   [ ] **Implement Offline State**: Handle "No Connection" UI — **deferred, online-only for now**.

### Phase 5: Home Screen & Explore
*   [x] Home screen layout with Quick Picks, Featured Playlists, Top Songs sections.
*   [x] Home screen shows synced themes and anime from Room database.
*   [x] **BUG**: Quick Picks / Top Songs are just `themes.take(6)` / `themes.take(10)` — now shuffled.
*   [x] **BUG**: Featured Playlists shows `anime.take(4)` — now shows real user playlists.
*   [x] **MISSING**: Chip filters (OPs, EDs) are now functional with toggle behavior.
*   [x] **REMOVED**: Search/Notifications buttons removed from Home top bar (were non-functional).
*   [x] **STATIC**: Explore screen rewritten with live search (no more hardcoded placeholder).
*   [x] **MISSING**: Explore search functionality (search AnimeThemes by name).
*   [ ] **MISSING**: Explore browse categories (new releases, charts, genres) — deferred.

### Phase 6: UI Polish (Glassmorphism)
*   [x] Dark theme with custom color palette (Ink, Rose, Ember, Gold, Mist).
*   [x] Glass-style cards with translucent backgrounds and subtle borders throughout.
*   [x] Player screen: backdrop glow effects (Canvas radial gradients), album art card shows anime poster art.
*   [x] Animated play button color transitions.
*   [x] Seek bar with animated color.
*   [ ] **MISSING**: No actual blur effects (`Modifier.blur` or RenderEffect) — glass effect is simulated with alpha.
*   [x] **MISSING**: Screen transition animations added (fade for tabs, slide-up for player).
*   [ ] **MISSING**: No loading skeletons / shimmer placeholders while data loads.

### Phase 7: Critical Bugs & Polish (Pre-MVP)
*   [x] Fix player recomposition bug (queue re-sent on every nav to player).
*   [x] Add mini-player bar to bottom nav screens so playback persists visually.
*   [x] Add artwork URI to MediaMetadata for notification/lock screen art.
*   [x] Make Home screen data dynamic (shuffle/random picks, real playlists).
*   [x] Implement Explore search (query AnimeThemes by anime name).
*   [x] Wire up chip filters on Home screen.
*   [x] Add empty state handling when no data is synced (guide user to Import).

### Phase 8: Library Tab Improvements
*   [x] Animes tab: click into anime → detail screen showing all themes for that anime with play action.
*   [x] Artists tab: click into artist → detail screen showing all songs by that artist with play action.
*   [x] Songs tab: thumbnails use anime cover art lookup (works after 422 fix).
*   [x] Add DAO queries: themes by animeId, themes by artistName.

### Phase 9: UI Cleanup & Consistency
*   [x] Compact all list rows: smaller thumbnails (44dp), tighter padding (8dp), softer borders (0.12 alpha).
*   [x] Consistent tap-to-play: tapping any song row plays it; removed separate Play buttons/text.
*   [x] Removed non-functional UI: MoreVert on non-playlist rows, Sort/GridView in Library header, Favorite in player, hardcoded tag chips.
*   [x] Player album art: shows anime poster art full-bleed with gradient fade; fallback shows initials.
*   [x] Player top bar: simplified to just collapse button + "NOW PLAYING" label.
*   [x] Explore search results: tap-to-play, compact rows.
*   [x] Unified glass-card alpha (0.5) and border alpha (0.12) across all screens.

### Phase 10: Sync Process Improvements
*   [x] Persist linked Kitsu account: store username/userId + tokens locally after sign-in.
*   [x] Two-state sync screen: if not linked → show sign-in form; if linked → show "Sync" button directly.
*   [x] Handle expired/invalid tokens: attempt refresh, show "Please sign in again" if refresh fails.
*   [x] Add "…" overflow menu on sync screen with: Re-sync All (full overwrite, no delete), Unlink Account.
*   [x] Re-sync All: resets `lastSyncedAt` to 0 and performs full sync (additive overwrite).
*   [x] Unlink Account: clears tokens, username, userId, and `lastSyncedAt` via `clearAll()`.
*   [x] Remove "Open Player" button and "Find User" flow from Import screen (simplify to sign-in only).

### Phase 11: Library & Player Bug Fixes
*   [x] Auto-playlist: create/update "Kitsu Library" playlist after every sync with all theme IDs.
*   [x] Anime 0 themes: added debug logging for `animeThemesId` mapping to diagnose join issue.
*   [x] Artist detail 0 songs: fixed `URLEncoder.encode` → `Uri.encode` (spaces as `%20` not `+`).
*   [x] Artist detail missing icon: added `ArtistImageDao` to `ArtistDetailViewModel`, show image in header.
*   [x] Player auto-start: changed `playWhenReady` from `false` to `true`.
*   [x] Player loading: added buffering spinner overlay on album art and `isBuffering` state tracking.
*   [x] Player errors: added `onPlayerError` listener, display error message below track info.

### Phase 12: Library & Detail Screen Redesign
*   [x] Fix "0 themes" root cause: added `name` to `ApiAnime`, title-based fallback mapping when resource-based mapping fails.
*   [x] Fix "0 themes" display: replaced in-memory groupBy with SQL-based `observeAllWithThemeCount()` DAO query.
*   [x] Navigate anime detail by `kitsuId` (actual PK) instead of nullable `animeThemesId`. VM uses `flatMapLatest` to resolve themes.
*   [x] Redesign `AnimeDetailScreen`: hero cover image with gradient overlay, title overlaid, Play/Shuffle buttons, numbered theme list.
*   [x] Redesign `ArtistDetailScreen`: Apple Music style hero with circular artist image, Play/Shuffle, numbered song list, "Appears In" anime section.
*   [x] Redesign `LibraryScreen`: grid-based `LazyVerticalGrid` for Animes (cover art cards) and Artists (circular image cards); list-based for Playlists/Songs.
*   [x] Fix back navigation: `selectedTab` uses `rememberSaveable` so tab persists when returning from detail screens.
*   [x] Library route now supports `?tab=` query param for tab restoration.
*   [x] Code cleanup: `AnimeItem` now includes `kitsuId`, `PlaylistRow` renamed to `ListRow`, added `GridCard` and `ArtistGridCard` composables.

### Phase 13: Now Playing Queue System
> Full spec: [NOW_PLAYING_SPEC.md](NOW_PLAYING_SPEC.md)
*   [ ] Create `NowPlayingManager` singleton — central queue state (originalQueue, nowPlaying, currentIndex, history, playNextStack, shuffle state).
*   [ ] Refactor `PlayerScreen` + `PlayerViewModel` to read from `NowPlayingManager` instead of nav-based queue params.
*   [ ] Remove `themeId`/`playlistId`/`queue` nav arguments — Player route becomes simple `"player"`.
*   [ ] Update all Play/Shuffle buttons (Anime, Artist, Playlist, Home, Library Songs) to set context playlist via `NowPlayingManager.play(...)`.
*   [ ] Implement shuffle logic: enable shuffles remaining songs (not current, not play-next); disable restores original context order.
*   [ ] Add ⋮ overflow menu to every song row across all screens (Home, Explore, Library Songs, Anime Detail, Artist Detail, Playlist Detail).
*   [ ] Build `SongOptionsSheet` modal bottom sheet: header (art + title), top buttons (Play Next, Save to Playlist), list item (Add to Queue).
*   [ ] Implement "Play Next" — inserts after current track, LIFO stacking, unaffected by shuffle toggle.
*   [ ] Implement "Add to Queue" — appends to end, shuffled in on shuffle toggle.
*   [ ] Build "Up Next" screen: history (dimmed, scrollable up, tap to rewind), current track (highlighted), upcoming tracks.
*   [ ] Queue persists across navigation — no queue loss on back press or screen change.
*   [ ] MiniPlayer + notification reflect `NowPlayingManager` state.

### Phase 14: Library Search (Future — Not Yet Implemented)
*   [ ] Add search bar to Library screen header.
*   [ ] Fuzzy search across songs, anime, artists, and playlists.
*   [ ] Support multi-script matching (Romaji, English, Japanese titles).
*   [ ] Results grouped by type (Anime, Songs, Artists, Playlists) with tap-to-navigate.
*   [ ] Future: Offline search — search only downloaded items when no connection.

## 7. Data Models (Simplified Schema)

**Anime**
*   id (AnimeThemes ID)
*   kitsuId (Nullable)
*   title
*   thumbnailUrl

**Theme**
*   id
*   animeId
*   type (OP/ED)
*   sequence (e.g., OP1, ED2)
*   songTitle
*   artistName
*   audioUrl
*   videoUrl
*   isDownloaded (Boolean)
*   localFilePath (Nullable)

**Playlist**
*   id
*   name
*   createdAt

**PlaylistEntry**
*   playlistId
*   themeId
*   orderIndex
