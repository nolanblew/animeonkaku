package com.takeya.animeongaku.media

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
        val preferredMode = playbackIntent.sessionOverride ?: when (entry.baseModePolicy.entryPolicy) {
            ThemeModePolicy.TV_SIZE -> PlaybackMode.TV_SIZE
            ThemeModePolicy.FULL_SIZE -> PlaybackMode.FULL_SIZE
            ThemeModePolicy.INHERIT ->
                entry.baseModePolicy.playlistDefault ?: playbackIntent.rememberedAudioMode
        }
        val fullRequired = preferredMode == PlaybackMode.FULL_SIZE
        if (fullRequired) item.modeDescriptor?.fullSizeSongId?.let(MediaKey::songAudio)
        else MediaKey.themeTv(item.theme.id)
    }
}

internal fun isExactOfflineAvailable(
    entry: QueueEntry,
    availableKeys: Set<MediaKey>,
    playbackIntent: PlaybackIntent = PlaybackIntent()
): Boolean = requiredOfflineMediaKey(entry, playbackIntent)?.let(availableKeys::contains) == true
