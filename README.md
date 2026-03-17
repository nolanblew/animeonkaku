<div align="center">
  <img src="assets/icon.png" width="150" height="150" alt="Anime Ongaku Icon">
  <h1>Anime Ongaku</h1>
  <p>A dedicated Android music player for Anime Openings and Endings</p>
</div>

## 🎵 What it does
Anime Ongaku (Anime Music) is a native Android music player designed specifically for listening to your favorite anime OP and ED themes. By connecting to your Kitsu account, it automatically syncs with your anime library and fetches the corresponding music tracks using the AnimeThemes API. 

Features include:
- **Full Library Sync**: Connect your Kitsu account to import your watched and currently watching anime.
- **Auto-Playlists**: Automatically generates and updates a playlist of songs from your "Currently Watching" shows.
- **Offline Playback**: Download your favorite tracks for offline listening, with an optional Wi-Fi only download setting.
- **Background Playback & Media Controls**: Fully supports standard Android media sessions, lock screen controls, and background playback via Media3/ExoPlayer.
- **Smart Queueing**: YouTube Music-style up-next queue with shuffle, repeat, and suggested autoplay functionality.
- **Custom Playlists**: Create, manage, and add tracks to custom playlists.

## ⚙️ How it works
- **UI Architecture**: Built entirely in Jetpack Compose using Material 3 and modern Android architecture guidelines (MVI pattern with ViewModels).
- **Media Engine**: Powered by AndroidX Media3 (ExoPlayer) with seamless audio caching and background service integration.
- **Data Layer**: Backed by Room Database for fast local caching, combined with Kotlin Coroutines and Flows for reactive UI updates.
- **APIs**: Uses Kitsu API for user library sync and AnimeThemes API for song metadata, artist information, and audio streaming URLs.

## 🚀 Setting up for local development
To build and run Anime Ongaku on a new computer:

### Prerequisites
1. **Android Studio**: Install the latest stable version of Android Studio.
2. **JDK 21**: The project requires Java 21 to compile.
3. **Firebase Configuration**: The app uses Firebase for Crashlytics and Analytics. You must provide a valid `google-services.json` file.

### Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/anime_ongaku.git
   cd anime_ongaku/src
   ```
2. Place your `google-services.json` file inside the `src/app/` directory.
3. Open the `src` folder in Android Studio.
4. Let Gradle sync and resolve dependencies.
5. Click **Run** (Shift + F10) to build and deploy the debug APK to your emulator or physical device.

## 📦 Building a Release
There are two ways to generate a signed release version of the app (APK or AAB):

### 1. Locally via Command Line
To build a release locally, you need a keystore file and its credentials.

1. Ensure your `release.keystore` is placed in the `src/app/` directory (Note: it is ignored by git).
2. Create a file named `keystore.properties` in `src/app/` with the following content:
   ```properties
   storeFile=release.keystore
   storePassword=your_store_password
   keyAlias=your_key_alias
   keyPassword=your_key_password
   ```
3. Open a terminal in the `src` directory and run:
   ```bash
   # To build a signed APK
   ./gradlew assembleRelease
   
   # To build a signed App Bundle (AAB) for Google Play
   ./gradlew bundleRelease
   ```
4. The output artifacts will be located in:
   - `src/app/build/outputs/apk/release/`
   - `src/app/build/outputs/bundle/release/`

### 2. Automatically via GitHub Actions
We have configured a manual GitHub Actions workflow to handle releases, which can automatically increment the version number and create a GitHub Release with the attached APK/AAB.

#### Running the workflow:
1. Go to the **Actions** tab in your GitHub repository.
2. Select the **Release** workflow from the left sidebar.
3. Click the **Run workflow** dropdown.
4. *Optional*: You can provide a specific Version Name (e.g., `1.0.2`) and Version Code (e.g., `3`). 
   - **Auto-increment**: If you leave the inputs empty, the workflow will automatically bump the patch version (e.g., `1.0.0` -> `1.0.1`), increment the version code, and commit the changes back to the repository.
5. Click **Run workflow**.
6. Once completed, a new GitHub Release will be created under the "Releases" section with the signed artifacts ready for download.
