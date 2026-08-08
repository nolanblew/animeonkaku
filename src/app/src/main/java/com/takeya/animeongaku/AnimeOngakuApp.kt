package com.takeya.animeongaku

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.media3.common.util.UnstableApi
import androidx.work.Configuration
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.work.DynamicPlaylistWorkScheduler
import com.takeya.animeongaku.work.LibraryPullScheduler
import com.takeya.animeongaku.work.PendingWritesScheduler
import com.takeya.animeongaku.download.DownloadPreferences
import com.takeya.animeongaku.data.auth.SessionStorageMigrator
import com.takeya.animeongaku.media.NowPlayingPersistence
import com.takeya.animeongaku.media.AudioCacheProvider
import com.takeya.animeongaku.media.MediaControllerManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PreCacheManager
import com.takeya.animeongaku.updater.AppUpdateScheduler
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
@androidx.annotation.OptIn(UnstableApi::class)
class AnimeOngakuApp : Application(), Configuration.Provider, ImageLoaderFactory {

    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var imageLoader: ImageLoader
    @Inject lateinit var preCacheManager: PreCacheManager
    @Inject lateinit var audioCacheProvider: AudioCacheProvider
    @Inject lateinit var nowPlayingPersistence: NowPlayingPersistence
    @Inject lateinit var mediaControllerManager: MediaControllerManager
    @Inject lateinit var nowPlayingManager: NowPlayingManager
    @Inject lateinit var downloadManager: DownloadManager
    @Inject lateinit var downloadPreferences: DownloadPreferences
    @Inject lateinit var dynamicPlaylistWorkScheduler: DynamicPlaylistWorkScheduler
    @Inject lateinit var libraryPullScheduler: LibraryPullScheduler
    @Inject lateinit var pendingWritesScheduler: PendingWritesScheduler
    @Inject lateinit var sessionStorageMigrator: SessionStorageMigrator
    @Inject lateinit var appUpdateScheduler: AppUpdateScheduler

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    // Coil resolves its singleton loader from the Application when it implements
    // ImageLoaderFactory, so every AsyncImage uses the server-media-rebasing loader.
    override fun newImageLoader(): ImageLoader = imageLoader

    override fun onCreate() {
        super.onCreate()
        sessionStorageMigrator.migrateIfNeeded()
        dynamicPlaylistWorkScheduler.schedule()
        libraryPullScheduler.schedule()
        pendingWritesScheduler.schedule()
        appUpdateScheduler.schedule()
        preCacheManager.start()
        scope.launch(Dispatchers.IO) {
            audioCacheProvider.warmUp()
        }
        
        // Silent restore on app startup
        scope.launch {
            if (!nowPlayingManager.isActive) {
                val restored = nowPlayingPersistence.restore()
                if (restored != null) {
                    mediaControllerManager.restore(restored, autoPlay = false)
                }
            }
        }

        // Retry failed downloads once per day
        val now = System.currentTimeMillis()
        val lastRetry = downloadPreferences.lastRetryCheckAt
        val oneDayMs = 24L * 60 * 60 * 1000
        if (now - lastRetry > oneDayMs) {
            downloadPreferences.lastRetryCheckAt = now
            downloadManager.retryFailedDownloads()
        }
    }
}
