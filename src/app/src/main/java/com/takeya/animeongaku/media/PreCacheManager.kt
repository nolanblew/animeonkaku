package com.takeya.animeongaku.media

import android.util.Log
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheKeyFactory
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.ContentMetadata
import com.takeya.animeongaku.download.DownloadPreferences
import com.takeya.animeongaku.network.ConnectivityMonitor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

@UnstableApi
@Singleton
class PreCacheManager @Inject constructor(
    private val audioCacheProvider: AudioCacheProvider,
    private val nowPlayingManager: NowPlayingManager,
    private val playbackResolutionCoordinator: PlaybackResolutionCoordinator,
    private val downloadPreferences: DownloadPreferences,
    private val connectivityMonitor: ConnectivityMonitor,
) {
    companion object {
        private const val TAG = "PreCacheManager"
        private const val MAX_PRE_CACHE_TRACKS = 2
        private const val EVICTION_INTERVAL_MS = 6L * 60 * 60 * 1000 // 6 hours
        private const val STALE_THRESHOLD_MS = 48L * 60 * 60 * 1000 // 48 hours
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var preCacheJob: Job? = null
    private var evictionJob: Job? = null

    fun start() {
        observeQueue()
        startPeriodicEviction()
    }

    fun stop() {
        scope.cancel()
    }

    private fun observeQueue() {
        scope.launch {
            nowPlayingManager.state
                .distinctUntilChangedBy { state ->
                    Triple(
                        state.currentEntry?.queueId,
                        state.upcomingEntries.take(MAX_PRE_CACHE_TRACKS).map { it.queueId },
                        state.playbackIntent,
                    )
                }
                .collect { state ->
                    // Cancel any in-flight pre-cache work
                    preCacheJob?.cancel()
                    preCacheJob = scope.launch {
                        val resolved = playbackResolutionCoordinator.resolveAll(
                            state.upcomingEntries.take(MAX_PRE_CACHE_TRACKS),
                            state.playbackIntent,
                        )
                        preCacheTracks(upcomingPlaybackUrls(resolved, MAX_PRE_CACHE_TRACKS))
                    }
                }
        }
    }

    private suspend fun preCacheTracks(audioUrls: List<String>) {
        if (!shouldPreCacheOnNetwork(
                wifiOnly = downloadPreferences.wifiOnly,
                isUnmetered = connectivityMonitor.isUnmetered.value,
            )
        ) {
            Log.d(TAG, "Skipping pre-cache on a metered network")
            return
        }
        for (url in audioUrls) {
            kotlin.coroutines.coroutineContext.ensureActive()

            if (isCached(url)) {
                Log.d(TAG, "Already cached: $url")
                continue
            }

            Log.d(TAG, "Pre-caching: $url")
            try {
                val dataSpec = DataSpec.Builder()
                    .setUri(url)
                    .build()
                val dataSource = audioCacheProvider.preCacheDataSourceFactory
                    .createDataSource() as CacheDataSource
                CacheWriter(
                    dataSource,
                    dataSpec,
                    /* temporaryBuffer= */ null,
                    /* progressListener= */ null
                ).cache()
                Log.d(TAG, "Pre-cached successfully: $url")
            } catch (e: java.util.concurrent.CancellationException) {
                throw e // Propagate cancellation
            } catch (e: Exception) {
                Log.w(TAG, "Failed to pre-cache: $url", e)
                // Don't retry immediately — move on to next track
            }
        }
    }

    private fun isCached(url: String): Boolean {
        val cache = audioCacheProvider.cache
        val dataSpec = DataSpec.Builder()
            .setUri(url)
            .build()
        val key = CacheKeyFactory.DEFAULT.buildCacheKey(dataSpec)
        val contentLength = ContentMetadata.getContentLength(cache.getContentMetadata(key))

        if (contentLength >= 0) {
            val cachedBytes = if (cache.isCached(key, 0, contentLength)) contentLength else 0L
            return isCacheComplete(contentLength, cachedBytes)
        }

        return isCacheComplete(
            contentLength = contentLength,
            cachedBytes = if (cache.keys.contains(key)) 1L else 0L
        )
    }

    private fun startPeriodicEviction() {
        evictionJob = scope.launch {
            while (isActive) {
                runEviction()
                delay(EVICTION_INTERVAL_MS)
            }
        }
    }

    private suspend fun runEviction() {
        try {
            val cache = audioCacheProvider.cache
            val state = nowPlayingManager.state.value
            val resolved = playbackResolutionCoordinator.resolveAll(
                state.nowPlayingEntries,
                state.playbackIntent,
            )
            val nowPlayingUrls = protectedPlaybackUrls(resolved)

            val now = System.currentTimeMillis()
            val keysToEvict = mutableListOf<String>()

            for (key in cache.keys.toList()) {
                // Protect songs in the current now-playing queue
                if (key in nowPlayingUrls) continue

                // Check last access time via cache spans
                val spans = cache.getCachedSpans(key)
                if (spans.isEmpty()) {
                    keysToEvict.add(key)
                    continue
                }
                val lastTouchTime = spans.maxOf { it.lastTouchTimestamp }
                if (now - lastTouchTime > STALE_THRESHOLD_MS) {
                    keysToEvict.add(key)
                }
            }

            for (key in keysToEvict) {
                cache.removeResource(key)
                Log.d(TAG, "Evicted stale cache: $key")
            }

            if (keysToEvict.isNotEmpty()) {
                Log.d(TAG, "Evicted ${keysToEvict.size} stale cache entries")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Eviction error", e)
        }
    }
}

internal fun upcomingPlaybackUrls(
    state: NowPlayingState,
    maxTracks: Int,
    activeServerBaseUrl: String?
): List<String> = state.upcomingItems
    .take(maxTracks)
    .map { it.playbackUriString(activeServerBaseUrl) }

internal fun protectedPlaybackUrls(
    state: NowPlayingState,
    activeServerBaseUrl: String?
): Set<String> = state.nowPlayingItems
    .map { it.playbackUriString(activeServerBaseUrl) }
    .toSet()

/** Resolver-owned paths are the only safe pre-cache inputs: local files and direct video URLs
 * must never be placed in the server-audio cache. */
internal fun upcomingPlaybackUrls(
    resolved: List<ResolvedPlaybackItem>,
    maxTracks: Int,
): List<String> = resolved
    .asSequence()
    .filter { it.isPlayable && it.source == PlaybackSource.SERVER_AUDIO }
    .mapNotNull { it.uri }
    .take(maxTracks)
    .toList()

internal fun protectedPlaybackUrls(
    resolved: Collection<ResolvedPlaybackItem>,
): Set<String> = resolved
    .asSequence()
    .filter { it.isPlayable && it.source == PlaybackSource.SERVER_AUDIO }
    .mapNotNull { it.uri }
    .toSet()

internal fun isCacheComplete(contentLength: Long, cachedBytes: Long): Boolean {
    return if (contentLength >= 0L) {
        cachedBytes >= contentLength
    } else {
        cachedBytes > 0L
    }
}
