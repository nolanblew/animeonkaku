<div align="center">
  <img src="assets/icon.png" width="150" height="150" alt="Anime Ongaku Icon">
  <h1>Anime Ongaku</h1>
  <p>A dedicated Android music player for Anime Openings and Endings</p>
</div>

## What It Does

Anime Ongaku is a native Android music player designed for anime opening and ending themes. By connecting to your Kitsu account, it can sync your anime library and fetch matching music tracks from AnimeThemes.

Features include:

- **Library sync**: Connect your Kitsu account to import watched and currently watching anime.
- **Auto-playlists**: Automatically generate and update playlists from shows you are currently watching.
- **Offline playback**: Download tracks for offline listening, with an optional Wi-Fi-only download setting.
- **Background playback and media controls**: Support Android media sessions, lock-screen controls, background playback, and Android Auto through Media3/ExoPlayer.
- **Smart queueing**: YouTube Music-style up-next queue with shuffle, repeat, and suggested autoplay behavior.
- **Custom playlists**: Create, manage, and add tracks to custom playlists.

## How It Works

- **UI architecture**: Jetpack Compose, Material 3, ViewModels, and StateFlow.
- **Media engine**: AndroidX Media3/ExoPlayer with a foreground playback service.
- **Data layer**: Room Database for local caching, plus Kotlin Coroutines and Flows for reactive UI updates.
- **APIs**: Kitsu API for user library sync and AnimeThemes API for song metadata, artist information, and audio streaming URLs.

## Local Development

Open and build the `src/` Gradle project, not the repository root.

### Prerequisites

- Android Studio with the Android SDK installed.
- JDK 21.
- A debug or release device/emulator running Android 15 / API 35 or newer.
- Optional for local debug builds: `src/app/google-services.json`. The Gradle file only applies the Google Services and Crashlytics plugins when this file is present, so local debug builds can compile without it. GitHub Actions still expects `GOOGLE_SERVICES_BASE64` so CI can create the file.

### First-Time Setup on Windows

```powershell
git clone https://github.com/nolanblew/animeonkaku.git
cd .\animeonkaku\src
.\gradlew.bat assembleDebug
```

To run on a connected device or emulator:

```powershell
.\gradlew.bat installDebug
```

Useful local checks:

```powershell
.\gradlew.bat testDebugUnitTest
.\gradlew.bat lint
```

## Signing and Upgrade Compatibility

Android package upgrades require the same `applicationId` and the same signing certificate.

This app currently uses `applicationId = "com.takeya.animeongaku"` for both debug and release builds. The signing key is what determines whether one installed package can upgrade another:

- **Release builds** are upgrade-compatible with GitHub release builds when they are signed with the same release keystore and credentials.
- **Debug builds** are signed by Gradle with the local Android debug keystore, usually `%USERPROFILE%\.android\debug.keystore`. Debug builds from two different PCs are not guaranteed to upgrade each other unless those PCs use the same debug keystore.
- **Debug and release builds are not normally upgrade-compatible with each other**, because they are signed by different keys. If Android reports `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, uninstall the existing package first or install a package signed by the same key as the existing install.

Do not regenerate the release key unless you intentionally want to create a new signing identity. A new release key will not upgrade installs signed by the current key.

## Building Debug Packages

From `src/`:

```powershell
.\gradlew.bat assembleDebug
```

The APK is written to:

```text
src/app/build/outputs/apk/debug/
```

To make debug builds upgrade-compatible across PCs, copy the original PC's Android debug keystore to the same location on the other PC before building:

```text
%USERPROFILE%\.android\debug.keystore
```

That only affects debug builds. It does not make debug builds compatible with release builds.

## Building Release Packages Locally

The repository does not keep a raw `release.keystore` or `keystore.properties` file in `src/app/`. Those files are intentionally ignored. The repository currently includes `src/app/release.keystore.b64`, which can be decoded by maintainers who also have the matching signing passwords.

The local release path uses the same signing inputs as GitHub Actions:

1. Decode the existing base64 keystore to a private local path.
2. Provide the signing credentials through environment variables.
3. Run the release Gradle tasks from `src/`.

PowerShell example:

```powershell
cd .\src

$keystorePath = Join-Path $env:TEMP "animeonkaku-release.keystore"

[IO.File]::WriteAllBytes(
  $keystorePath,
  [Convert]::FromBase64String((Get-Content -Raw ".\app\release.keystore.b64").Trim())
)

$env:KEYSTORE_FILE = $keystorePath
$env:STORE_PASSWORD = "<release store password>"
$env:KEY_ALIAS = "<release key alias>"
$env:KEY_PASSWORD = "<release key password>"

.\gradlew.bat assembleRelease bundleRelease
```

The APK and AAB are written to:

```text
src/app/build/outputs/apk/release/
src/app/build/outputs/bundle/release/
```

After the build, remove the environment variables from the current PowerShell session if you are done with them:

```powershell
Remove-Item Env:\KEYSTORE_FILE
Remove-Item Env:\STORE_PASSWORD
Remove-Item Env:\KEY_ALIAS
Remove-Item Env:\KEY_PASSWORD
Remove-Item -LiteralPath $keystorePath -ErrorAction SilentlyContinue
```

You can alternatively decode or copy the keystore to `src/app/release.keystore` and create `src/app/keystore.properties` if you prefer file-based local signing. Because Gradle reads it from `src/app/keystore.properties`, use a path relative to `src/app/`:

```properties
storeFile=release.keystore
storePassword=<release store password>
keyAlias=<release key alias>
keyPassword=<release key password>
```

`src/app/keystore.properties` and `src/app/release.keystore` are ignored by git. Keep any decoded keystore outside version control.

## GitHub Release Workflow

The manual `Release` workflow builds signed release APK and AAB artifacts.

Required repository secrets:

- `KEYSTORE_BASE64`: Base64 content for the current release keystore. This should match the keystore represented by `src/app/release.keystore.b64`.
- `STORE_PASSWORD`: Release keystore password.
- `KEY_ALIAS`: Release key alias.
- `KEY_PASSWORD`: Release key password.
- `GOOGLE_SERVICES_BASE64`: Base64 content for `google-services.json`.

The workflow decodes the keystore to `src/release.keystore`, sets `KEYSTORE_FILE` to that path, and runs:

```bash
./gradlew assembleRelease bundleRelease
```

It can also bump `versionCode` and `versionName`, commit that version bump, tag the release, and attach the generated APK/AAB artifacts.

## Notes for a Second Development PC

- Clone the repo and build debug packages normally with `.\gradlew.bat assembleDebug`.
- For release packages that upgrade GitHub releases, use the existing release keystore material and the existing release signing credentials.
- For debug packages that upgrade debug installs from another PC, copy the original PC's Android debug keystore before building.
- If switching an installed device between debug and release signatures, uninstall the existing package first.
