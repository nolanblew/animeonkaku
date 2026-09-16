package com.takeya.animeongaku.media

import androidx.media3.common.util.UnstableApi
import com.takeya.animeongaku.data.local.DownloadItemDao
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@Singleton
@androidx.annotation.OptIn(UnstableApi::class)
class OfflineMediaAvailability internal constructor(initialKeys: Set<MediaKey>) {
    private val available = AtomicReference(initialKeys)
    private val _availableKeys = MutableStateFlow(initialKeys)
    val availableKeys: StateFlow<Set<MediaKey>> = _availableKeys.asStateFlow()

    @Inject
    constructor(
        downloadItemDao: DownloadItemDao,
        audioCacheProvider: AudioCacheProvider,
    ) : this(emptySet()) {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            combine(downloadItemDao.observeAll(), audioCacheProvider.cachedMediaKeys) { items, cached ->
                completedLocalMedia(items).keys + cached
            }.collectLatest { keys ->
                available.set(keys)
                _availableKeys.value = keys
            }
        }
    }

    fun snapshot(): Set<MediaKey> = available.get()
}

internal fun requiredOfflineMediaKey(
    entry: QueueEntry,
    playbackIntent: PlaybackIntent = PlaybackIntent()
): MediaKey? = when (val item = entry.item) {
    is PlayableItem.RelatedSong -> MediaKey.songAudio(item.song.id)
    is PlayableItem.Theme -> {
        val preferredMode = entry.offlineDesiredMode(playbackIntent)
        val fullRequired = preferredMode == PlaybackMode.FULL_SIZE
        if (fullRequired) item.effectiveModeDescriptor?.fullSizeSongId?.let(MediaKey::songAudio)
        else MediaKey.themeTv(item.theme.id)
    }
}

internal fun isExactOfflineAvailable(
    entry: QueueEntry,
    availableKeys: Set<MediaKey>,
    playbackIntent: PlaybackIntent = PlaybackIntent()
): Boolean = requiredOfflineMediaKey(entry, playbackIntent)?.let(availableKeys::contains) == true

/** Admission check uses the same ordered audio fallback as playback, rather than only the seed. */
internal fun isOfflinePlayable(
    entry: QueueEntry,
    availableKeys: Set<MediaKey>,
    playbackIntent: PlaybackIntent = PlaybackIntent()
): Boolean = when (val item = entry.item) {
    is PlayableItem.RelatedSong -> MediaKey.songAudio(item.song.id) in availableKeys
    is PlayableItem.Theme -> {
        val required = entry.baseModePolicy.requiredModeForOffline()
        val tv = MediaKey.themeTv(item.theme.id) in availableKeys
        val full = item.effectiveModeDescriptor?.fullSizeSongId?.let(MediaKey::songAudio)
            ?.let(availableKeys::contains) == true
        when {
            required == PlaybackMode.TV_SIZE -> tv
            required == PlaybackMode.FULL_SIZE -> full
            required != null -> false
            entry.offlineDesiredMode(playbackIntent) == PlaybackMode.VIDEO -> tv
            else -> tv || full
        }
    }
}

private fun QueueEntry.offlineDesiredMode(playbackIntent: PlaybackIntent): PlaybackMode =
    baseModePolicy.requiredModeForOffline()
        ?: entryManualOrSessionMode(playbackIntent)
        ?: (item as? PlayableItem.Theme)?.serverPreference?.preferredMode?.let { mode ->
            when (mode) {
                "TV_SIZE" -> PlaybackMode.TV_SIZE
                "FULL_SIZE" -> PlaybackMode.FULL_SIZE
                else -> null
            }
        }
        ?: baseModePolicy.softModeForOffline()
        ?: desiredMode
        ?: PlaybackMode.TV_SIZE

private fun QueueEntry.entryManualOrSessionMode(playbackIntent: PlaybackIntent): PlaybackMode? =
    manualMode ?: playbackIntent.sessionOverride

private fun BaseModePolicy.requiredModeForOffline(): PlaybackMode? =
    takeIf { overrideUserPreference }?.let { policy ->
        when (policy.entryPolicy) {
            ThemeModePolicy.TV_SIZE -> PlaybackMode.TV_SIZE
            ThemeModePolicy.FULL_SIZE -> PlaybackMode.FULL_SIZE
            ThemeModePolicy.INHERIT -> playlistDefault
        }
    }

private fun BaseModePolicy.softModeForOffline(): PlaybackMode? = when (entryPolicy) {
    ThemeModePolicy.TV_SIZE -> PlaybackMode.TV_SIZE
    ThemeModePolicy.FULL_SIZE -> PlaybackMode.FULL_SIZE
    ThemeModePolicy.INHERIT -> playlistDefault
}
