package com.takeya.animeongaku.media

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheKeyFactory
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.ContentMetadataMutations
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.server.ServerSettingsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

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
        private const val PRE_CACHE_COMPLETE_METADATA = "anime_ongaku.precache_complete"
    }

    val cache: SimpleCache by lazy {
        val cacheDir = File(context.cacheDir, CACHE_DIR_NAME)
        if (!cacheDir.exists()) cacheDir.mkdirs()
        SimpleCache(
            cacheDir,
            LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES)
        )
    }

    private val _cachedMediaKeys = MutableStateFlow<Set<MediaKey>>(emptySet())
    val cachedMediaKeys: StateFlow<Set<MediaKey>> = _cachedMediaKeys.asStateFlow()

    internal fun canonicalServerMediaUrl(url: String): String =
        rewriteServerMediaUrl(url, serverSettingsStore.serverBaseUrl)

    internal fun isFullyCached(url: String, mediaKey: MediaKey? = null): Boolean {
        val canonicalUrl = canonicalServerMediaUrl(url)
        val dataSpec = DataSpec.Builder().setUri(canonicalUrl).build()
        val cacheKey = CacheKeyFactory.DEFAULT.buildCacheKey(dataSpec)
        val metadata = cache.getContentMetadata(cacheKey)
        val contentLength = ContentMetadata.getContentLength(metadata)
        val cachedBytes = cache.getCachedSpans(cacheKey).sumOf { it.length }
        val complete = isCacheComplete(
            contentLength = contentLength,
            cachedBytes = cachedBytes,
            preCacheCompleted = metadata.get(PRE_CACHE_COMPLETE_METADATA, 0L) == 1L,
        )
        if (mediaKey != null) {
            _cachedMediaKeys.value = if (complete) {
                _cachedMediaKeys.value + mediaKey
            } else {
                _cachedMediaKeys.value - mediaKey
            }
        }
        return complete
    }

    internal fun markPreCacheComplete(url: String, mediaKey: MediaKey?) {
        val canonicalUrl = canonicalServerMediaUrl(url)
        val dataSpec = DataSpec.Builder().setUri(canonicalUrl).build()
        val cacheKey = CacheKeyFactory.DEFAULT.buildCacheKey(dataSpec)
        cache.applyContentMetadataMutations(
            cacheKey,
            ContentMetadataMutations().set(PRE_CACHE_COMPLETE_METADATA, 1L),
        )
        if (mediaKey != null) _cachedMediaKeys.value = _cachedMediaKeys.value + mediaKey
    }

    internal fun removeResource(cacheKey: String) {
        cache.removeResource(cacheKey)
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
