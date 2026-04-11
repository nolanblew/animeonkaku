# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**Anime Ongaku** is a native Android music player for anime opening/ending themes. It syncs with Kitsu.io accounts to auto-populate a library, fetching audio from AnimeThemes.moe.

## Build Commands

All commands run from the `src/` directory:

```bash
./gradlew assembleDebug        # Build debug APK
./gradlew installDebug         # Build and install on device/emulator
./gradlew test                 # Run unit tests
./gradlew connectedAndroidTest # Run instrumented tests
./gradlew lint                 # Run lint checks
./gradlew assembleRelease      # Build signed APK (requires src/app/keystore.properties)
```

**Run a single test class:**
```bash
./gradlew test --tests "com.takeya.animeongaku.NowPlayingManagerTest"
```

**Requirements:** JDK 21, `google-services.json` in `src/app/` for Firebase.

## Architecture

The app uses MVVM + Repository pattern with Hilt DI, Jetpack Compose UI, and Media3/ExoPlayer for playback.

### Layers

```
Compose UI → ViewModel (StateFlow) → Repository → Room DB / Retrofit APIs
                                              ↕
                                    Media Engine (ExoPlayer)
```

**Media Engine** has three components that must be understood together:
- `NowPlayingManager` — owns queue state (list of tracks, current index, shuffle/repeat mode)
- `MediaControllerManager` — bridges `NowPlayingManager` ↔ `MediaController` (ExoPlayer); syncs track changes bidirectionally
- `MediaPlaybackService` — foreground service providing the `MediaSession` and ExoPlayer instance

**Sync pipeline:**
1. `SyncManager` fetches anime list from Kitsu API in 50-item batches
2. Maps Kitsu anime IDs → AnimeThemes.moe slugs to resolve audio/video URLs
3. Stores results in Room; `AutoPlaylistManager` creates "Currently Watching" playlist

**Download pipeline:**
- `DownloadManager` (singleton) coordinates UI state
- `DownloadWorker` (WorkManager) handles actual file downloads with retry
- Respects WiFi-only preference via WorkManager network constraints

### Key Directories

| Path | Contents |
|------|----------|
| `src/app/src/main/java/com/takeya/animeongaku/` | All source code |
| `ui/` | Jetpack Compose screens and ViewModels |
| `data/` | Room entities, DAOs, repositories, API models |
| `media/` | ExoPlayer integration and playback state |
| `download/` | Offline download management |
| `sync/` | Kitsu library synchronization services |
| `di/` | Hilt modules (NetworkModule, DatabaseModule, etc.) |
| `src/app/schemas/` | Room migration schema snapshots |

### Patterns

**ViewModels** expose `StateFlow` using `SharingStarted.WhileSubscribed(5_000)`.

**Network layer** uses named `OkHttpClient` qualifiers (`"base"`, `"kitsu"`) with custom interceptors: `RateLimitInterceptor`, `RetryInterceptor`, `KitsuAuthInterceptor`.

**Authentication** stores OAuth2 tokens in `EncryptedSharedPreferences` (AES256-GCM) via `KitsuTokenStore`.

**Artwork** uses a multi-resolution fallback system — `primaryArtworkUrl()` helper is the canonical way to get cover art URLs across UI and data layers.

**Debug builds** use dynamic version names: `dev-{date}-{git-hash}` via `BuildConfig.DISPLAY_VERSION`.

### Dependencies (versions in `src/gradle/libs.versions.toml`)

- UI: Jetpack Compose BOM 2024.09.00, Material3
- Media: Media3/ExoPlayer 1.3.1
- DB: Room 2.8.4
- Network: Retrofit 2.11.0, OkHttp 4.12.0, Moshi 1.15.1
- DI: Hilt 2.59
- Images: Coil 2.6.0
- Work: WorkManager 2.10.1
- Firebase: Crashlytics + Analytics (BoM 34.10.0)
