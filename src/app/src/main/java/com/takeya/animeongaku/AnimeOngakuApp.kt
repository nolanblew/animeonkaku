package com.takeya.animeongaku

import android.app.Application
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
class AnimeOngakuApp : Application() {

    @Inject lateinit var preCacheManager: PreCacheManager
    @Inject lateinit var nowPlayingPersistence: NowPlayingPersistence
    @Inject lateinit var mediaControllerManager: MediaControllerManager
    @Inject lateinit var nowPlayingManager: NowPlayingManager
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
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
    }
}
