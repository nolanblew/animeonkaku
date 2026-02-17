package com.takeya.animeongaku

import android.app.Application
import com.takeya.animeongaku.media.PreCacheManager
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class AnimeOngakuApp : Application() {

    @Inject lateinit var preCacheManager: PreCacheManager

    override fun onCreate() {
        super.onCreate()
        preCacheManager.start()
    }
}
