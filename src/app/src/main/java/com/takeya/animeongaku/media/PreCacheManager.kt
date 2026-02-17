package com.takeya.animeongaku.media

import android.util.Log
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

@UnstableApi
@Singleton
class PreCacheManager @Inject constructor(
    private val audioCacheProvider: AudioCacheProvider,
    private val nowPlayingManager: NowPlayingManager
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
                .map { state ->
                    // Only react to changes in upcoming tracks or queue version
                    val upcoming = state.upcomingTracks.take(MAX_PRE_CACHE_TRACKS)
                    upcoming.map { it.audioUrl }
                }
                .distinctUntilChanged()
                .collect { upcomingUrls ->
                    // Cancel any in-flight pre-cache work
                    preCacheJob?.cancel()
                    preCacheJob = scope.launch {
                        preCacheTracks(upcomingUrls)
                    }
                }
        }
    }

    private suspend fun preCacheTracks(audioUrls: List<String>) {
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
        val keys = cache.keys
        // SimpleCache uses the URI as the cache key by default
        return keys.contains(url)
    }

    private fun startPeriodicEviction() {
        evictionJob = scope.launch {
            while (isActive) {
                runEviction()
                delay(EVICTION_INTERVAL_MS)
            }
        }
    }

    private fun runEviction() {
        try {
            val cache = audioCacheProvider.cache
            val nowPlayingUrls = nowPlayingManager.state.value.nowPlaying
                .map { it.audioUrl }
                .toSet()

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
