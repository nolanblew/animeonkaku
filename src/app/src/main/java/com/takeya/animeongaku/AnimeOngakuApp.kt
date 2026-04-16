package com.takeya.animeongaku

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.work.DynamicPlaylistWorkScheduler
import com.takeya.animeongaku.download.DownloadPreferences
import com.takeya.animeongaku.media.NowPlayingPersistence
import com.takeya.animeongaku.media.MediaControllerManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PreCacheManager
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class AnimeOngakuApp : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var preCacheManager: PreCacheManager
    @Inject lateinit var nowPlayingPersistence: NowPlayingPersistence
    @Inject lateinit var mediaControllerManager: MediaControllerManager
    @Inject lateinit var nowPlayingManager: NowPlayingManager
    @Inject lateinit var downloadManager: DownloadManager
    @Inject lateinit var downloadPreferences: DownloadPreferences
    @Inject lateinit var dynamicPlaylistWorkScheduler: DynamicPlaylistWorkScheduler
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()
        dynamicPlaylistWorkScheduler.schedule()
        preCacheManager.start()
        
        // Silent restore on app startup
        scope.launch {
            if (nowPlayingManager.state.value.nowPlaying.isEmpty()) {
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
