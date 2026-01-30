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
*   **Kitsu Integration**:
    *   User Login/Search (Find Kitsu user).
    *   **Import Library**: Fetch user's "Currently Watching" and "Completed" anime.
    *   **Auto-Match**: Map Kitsu Anime IDs to AnimeThemes resources to build the initial music library.
*   **Custom Playlists**: Users can create, rename, and manage local playlists.
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

### C. Data Flow (Import Process)
1.  User enters Kitsu Username.
2.  App fetches Kitsu User ID.
3.  App fetches User's Library Entries (List of Kitsu Anime IDs).
4.  **Batch Processing**: App queries AnimeThemes to find matches for these Kitsu IDs.
5.  Matched Anime + Themes are stored in the local `Room` database as the user's "Library".
6.  User can now play music associated with their watched shows.

## 5. Android 15 Specifics
*   **Foreground Service**:
    *   Type: `mediaPlayback`.
    *   Must show a persistent notification.
    *   Permission: `FOREGROUND_SERVICE_MEDIA_PLAYBACK`.
*   **Edge-to-Edge**: Full support for gesture navigation and status bar transparency.

## 6. Implementation Plan

### Phase 1: Foundation & Player
*   [ ] Setup Android Project (Hilt, Navigation, Room).
*   [ ] Implement `MediaService` using Media3/ExoPlayer.
*   [ ] Create a basic "Player UI" to test audio streaming from a hardcoded URL.

### Phase 2: Data Layer (APIs)
*   [ ] Setup Apollo Client for AnimeThemes.
*   [ ] Setup Retrofit for Kitsu.
*   [ ] **Implement Network Interceptors**: Add Rate Limiting and Retry/Backoff logic.
*   [ ] Create Repositories for `AnimeRepository`, `UserRepository`.

### Phase 3: The "Import" Feature
*   [ ] Implement Kitsu Login Screen (Username/Password).
*   [ ] Implement Kitsu User Search UI (Public/Backup).
*   [ ] Implement "Sync" Logic (Kitsu Library -> AnimeThemes Map).
*   [ ] Save mapped results to local DB.

### Phase 4: Library & Playlists
*   [ ] Build "Library" Screen (Display imported anime).
*   [ ] Implement "Create Playlist" functionality.
*   [ ] Implement "Download" (ExoPlayer DownloadService).
*   [ ] **Implement Offline State**: Handle empty states and "No Connection" UI.

### Phase 5: UI Polish (Glassmorphism)
*   [ ] Apply blur effects (`Modifier.blur` or native render effects if available/performant).
*   [ ] Style Player UI to match "YouTube Music" aesthetic.
*   [ ] Transitions and Animations.

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
