# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Anime Ongaku** is a native Android music player for anime opening/ending themes. The Android app is now a thin client for a self-hosted Anime Ongaku server. The server authenticates against Kitsu, syncs library metadata, fetches/caches AnimeThemes media, and exposes stable media URLs to Android.

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

**Requirements:** JDK 21, `google-services.json` in `src/app/` for Firebase. Network sync/search/playback of non-downloaded tracks requires a configured Anime Ongaku server URL.

**Windows verification paths that worked in this workspace:**
```powershell
$env:ANDROID_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:JAVA_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\openjdk\jdk-21.0.8'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;C:\Windows\System32;$env:Path"
.\gradlew.bat --no-daemon test
```

Server checks run from `server/`:
```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit
```

## Architecture

The app uses MVVM + Repository pattern with Hilt DI, Jetpack Compose UI, and Media3/ExoPlayer for playback.

### Layers

```
Compose UI → ViewModel (StateFlow) → Repository → Room DB / OngakuApi
                                              ↕
                                    Media Engine (ExoPlayer)
```

**Media Engine** has three components that must be understood together:
- `NowPlayingManager` — owns queue state (list of tracks, current index, shuffle/repeat mode)
- `MediaControllerManager` — bridges `NowPlayingManager` ↔ `MediaController` (ExoPlayer); syncs track changes bidirectionally
- `MediaPlaybackService` — foreground service providing the `MediaSession` and ExoPlayer instance

**Sync pipeline:**
1. Android signs in through the Anime Ongaku server using a Kitsu username/email and password.
2. The server owns Kitsu tokens, syncs the library, maps AnimeThemes metadata, and caches media.
3. `LibraryPullManager` pulls `/v1/library` deltas into Room and rewrites media/artwork URLs to server endpoints.
4. `AutoPlaylistManager` refreshes local Room-derived playlists such as "Currently Watching".

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
| `sync/` | Server pull, pending write, migration, and local playlist refresh services |
| `di/` | Hilt modules (NetworkModule, DatabaseModule, etc.) |
| `src/app/schemas/` | Room migration schema snapshots |

### Patterns

**ViewModels** expose `StateFlow` using `SharingStarted.WhileSubscribed(5_000)`.

**Network layer** uses named `OkHttpClient` qualifiers (`"base"`, `"ongaku"`) with `RetryInterceptor`, `OngakuBaseUrlInterceptor`, and `OngakuAuthInterceptor`. Android must not call Kitsu or AnimeThemes directly.

**Authentication** stores the server bearer session in `EncryptedSharedPreferences` (AES256-GCM) via `ServerTokenStore`. The server owns Kitsu OAuth tokens.

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
