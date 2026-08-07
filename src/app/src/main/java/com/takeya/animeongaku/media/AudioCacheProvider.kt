package com.takeya.animeongaku.media

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.server.ServerSettingsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@UnstableApi
@Singleton
class AudioCacheProvider @Inject constructor(
    @ApplicationContext private val context: Context,
    private val serverTokenStore: ServerTokenStore,
    private val serverSettingsStore: ServerSettingsStore
) {
    companion object {
        private const val CACHE_DIR_NAME = "audio_cache"
        private const val MAX_CACHE_BYTES = 250L * 1024 * 1024 // 250 MB
        private const val CONNECT_TIMEOUT_MS = 30_000
        private const val READ_TIMEOUT_MS = 30_000
    }

    val cache: SimpleCache by lazy {
        val cacheDir = File(context.cacheDir, CACHE_DIR_NAME)
        if (!cacheDir.exists()) cacheDir.mkdirs()
        SimpleCache(
            cacheDir,
            LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES)
        )
    }

    /** Opens SimpleCache outside a playback/UI-critical path during application startup. */
    fun warmUp() {
        cache
    }

    private val serverHttpDataSourceFactory: DataSource.Factory by lazy {
        OkHttpDataSource.Factory(
            buildServerMediaHttpClient(
                activeServerBaseUrl = { serverSettingsStore.serverBaseUrl },
                accessToken = { serverTokenStore.currentToken() },
                connectTimeoutMs = CONNECT_TIMEOUT_MS.toLong(),
                readTimeoutMs = READ_TIMEOUT_MS.toLong()
            )
        )
    }

    private val directHttpDataSourceFactory: DataSource.Factory by lazy {
        DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(CONNECT_TIMEOUT_MS)
            .setReadTimeoutMs(READ_TIMEOUT_MS)
            .setAllowCrossProtocolRedirects(true)
    }

    private val localDataSourceFactory: DataSource.Factory by lazy {
        DefaultDataSource.Factory(context, directHttpDataSourceFactory)
    }

    private val cachedServerAudioDataSourceFactory: DataSource.Factory by lazy {
        CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(serverHttpDataSourceFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    }

    /**
     * DataSource.Factory for ExoPlayer — reads from cache first, falls back to
     * DefaultDataSource which handles all URI schemes (file://, content://, http://).
     */
    val playerDataSourceFactory: DataSource.Factory by lazy {
        OriginAwareMediaDataSourceFactory(
            activeServerBaseUrl = { serverSettingsStore.serverBaseUrl },
            serverAudioFactory = cachedServerAudioDataSourceFactory,
            directRemoteFactory = directHttpDataSourceFactory,
            localFactory = localDataSourceFactory
        )
    }

    /**
     * DataSource.Factory for the pre-fetcher — writes to cache only.
     * Used by CacheWriter to download tracks ahead of time.
     */
    val preCacheDataSourceFactory: DataSource.Factory by lazy {
        CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(serverHttpDataSourceFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    }
}
