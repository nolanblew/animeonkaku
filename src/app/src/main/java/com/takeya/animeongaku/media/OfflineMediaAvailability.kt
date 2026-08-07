package com.takeya.animeongaku.media

import com.takeya.animeongaku.data.local.DownloadItemDao
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

@Singleton
class OfflineMediaAvailability internal constructor(initialKeys: Set<MediaKey>) {
    private val available = AtomicReference(initialKeys)

    @Inject
    constructor(downloadItemDao: DownloadItemDao) : this(emptySet()) {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            downloadItemDao.observeAll().collectLatest { items ->
                available.set(completedLocalMedia(items).keys)
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
