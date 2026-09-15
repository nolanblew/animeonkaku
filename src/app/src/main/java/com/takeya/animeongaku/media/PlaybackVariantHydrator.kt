package com.takeya.animeongaku.media

import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.remote.OngakuAnimeDetailResponse
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.network.ServerReachabilityMonitor
import com.takeya.animeongaku.network.ServerReachabilityState
import com.takeya.animeongaku.sync.toThemeModeEntity
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

internal data class PlaybackVariantTarget(
    val queueId: Long,
    val themeId: Long,
    val kitsuId: String
)

internal data class PlaybackVariantHydrationKey(
    val target: PlaybackVariantTarget,
    val networkGeneration: Long
)

internal fun currentPlaybackVariantTarget(state: NowPlayingState): PlaybackVariantTarget? {
    val entry = state.currentEntry ?: return null
    val item = entry.item as? PlayableItem.Theme ?: return null
    val kitsuId = item.anime?.kitsuId
        ?: item.theme.animeId?.let(state.animeMap::get)?.kitsuId
        ?: return null
    if (kitsuId.isBlank()) return null
    return PlaybackVariantTarget(entry.queueId, item.theme.id, kitsuId)
}

internal fun playbackVariantHydrationKeys(
    nowPlaying: Flow<NowPlayingState>,
    reachability: Flow<ServerReachabilityState>
): Flow<PlaybackVariantHydrationKey?> = combine(
    nowPlaying.map(::currentPlaybackVariantTarget).distinctUntilChanged(),
    reachability
) { target, server ->
    target?.takeIf { server.reachable && server.verifiedForNetwork }?.let {
        PlaybackVariantHydrationKey(it, server.networkGeneration)
    }
}.distinctUntilChanged()

internal suspend fun collectPlaybackVariantHydration(
    keys: Flow<PlaybackVariantHydrationKey?>,
    refresh: suspend (PlaybackVariantTarget) -> Boolean,
    failureRetryDelaysMs: List<Long> = listOf(1_000L, 2_000L, 5_000L, 15_000L, 30_000L),
    successfulRefreshIntervalMs: Long = 60_000L
) {
    require(failureRetryDelaysMs.isNotEmpty() && failureRetryDelaysMs.all { it > 0L })
    require(successfulRefreshIntervalMs > 0L)
    keys.collectLatest { key ->
        if (key == null) return@collectLatest
        var failureCount = 0
        while (currentCoroutineContext().isActive) {
            val refreshed = try {
                refresh(key.target)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (_: Exception) {
                false
            }
            if (refreshed) {
                failureCount = 0
                delay(successfulRefreshIntervalMs)
            } else {
                val delayIndex = failureCount.coerceAtMost(failureRetryDelaysMs.lastIndex)
                failureCount++
                delay(failureRetryDelaysMs[delayIndex])
            }
        }
    }
}

@Singleton
class PlaybackVariantMetadataStore internal constructor(
    private val fetchAnime: suspend (String) -> OngakuAnimeDetailResponse,
    private val upsertModes: suspend (List<ThemeModeEntity>) -> Unit,
    private val serverBaseUrl: () -> String
) {
    @Inject constructor(
        api: OngakuApi,
        themeModeDao: ThemeModeDao,
        serverSettingsStore: ServerSettingsStore
    ) : this(api::anime, themeModeDao::upsertAll, { serverSettingsStore.serverBaseUrl.orEmpty() })

    /** Missing themes and failed/cancelled requests leave the last known descriptor untouched. */
    internal suspend fun refresh(target: PlaybackVariantTarget): Boolean {
        val response = fetchAnime(target.kitsuId)
        val matchingTheme = response.themes.firstOrNull { !it.deleted && it.id == target.themeId }
            ?: return false
        upsertModes(listOf(matchingTheme.toThemeModeEntity(serverBaseUrl())))
        return true
    }
}

/** Keeps the current queue occurrence's variant metadata fresh, including background playback. */
@Singleton
class PlaybackVariantHydrator @Inject constructor(
    private val nowPlayingManager: NowPlayingManager,
    private val serverReachabilityMonitor: ServerReachabilityMonitor,
    private val metadataStore: PlaybackVariantMetadataStore
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val started = AtomicBoolean(false)

    fun start() {
        if (!started.compareAndSet(false, true)) return
        scope.launch {
            collectPlaybackVariantHydration(
                keys = playbackVariantHydrationKeys(
                    nowPlaying = nowPlayingManager.state,
                    reachability = serverReachabilityMonitor.state
                ),
                refresh = metadataStore::refresh
            )
        }
    }
}
