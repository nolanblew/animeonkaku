package com.takeya.animeongaku.media

import com.takeya.animeongaku.data.local.DownloadItemDao
import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.network.ConnectivityMonitor
import javax.inject.Inject
import javax.inject.Singleton

enum class PlaybackMode { TV_SIZE, FULL_SIZE, VIDEO, RELATED_AUDIO }

enum class ThemeModePolicy { INHERIT, TV_SIZE, FULL_SIZE }

data class PlaybackIntent(
    val rememberedAudioMode: PlaybackMode = PlaybackMode.TV_SIZE,
    val sessionOverride: PlaybackMode? = null
) {
    init {
        require(rememberedAudioMode == PlaybackMode.TV_SIZE || rememberedAudioMode == PlaybackMode.FULL_SIZE) {
            "Remembered audio mode must be TV_SIZE or FULL_SIZE"
        }
        require(sessionOverride != PlaybackMode.RELATED_AUDIO) {
            "RELATED_AUDIO is resolver-owned and cannot be a Theme session override"
        }
    }
}

@JvmInline
value class MediaKey(val value: String) {
    companion object {
        fun themeTv(themeId: Long) = MediaKey(DownloadItemEntity.tvSizeMediaKey(themeId))
        fun songAudio(songId: Long) = MediaKey(DownloadItemEntity.songMediaKey(songId))
    }
}

data class LocalMediaFile(
    val mediaKey: MediaKey,
    val filePath: String
)

enum class PlaybackSource { LOCAL, SERVER_AUDIO, DIRECT_VIDEO }

enum class RetainedIntentReason {
    PREFERRED_MODE_UNAVAILABLE,
    EXACT_OFFLINE_MEDIA_MISSING
}

data class ResolvedPlaybackItem(
    val queueId: Long,
    val playableKey: PlayableKey,
    val preferredMode: PlaybackMode,
    val actualMode: PlaybackMode?,
    val uri: String?,
    val mediaKey: MediaKey?,
    val source: PlaybackSource?,
    val availableModes: Set<PlaybackMode>,
    val retainedIntentReason: RetainedIntentReason?,
    val title: String,
    val artist: String?,
    val animeOrRelease: String?,
    val artworkUrl: String?,
    val albumTitle: String? = null,
    val animeTitle: String? = null,
    val videoSpoiler: Boolean = false,
    val videoNsfw: Boolean = false
) {
    val isPlayable: Boolean get() = actualMode != null && uri != null
    val modeState: PlaybackModeState
        get() = PlaybackModeState(preferredMode, actualMode, retainedIntentReason)
}

data class PlaybackModeState(
    val preferredMode: PlaybackMode,
    val actualMode: PlaybackMode?,
    val retainedIntentReason: RetainedIntentReason?
)

/** Pure, single-authority mode/availability/source resolver. */
class PlaybackResolver @Inject constructor() {
    fun resolve(
        entry: QueueEntry,
        intent: PlaybackIntent,
        isOnline: Boolean,
        localMedia: Map<MediaKey, LocalMediaFile>
    ): ResolvedPlaybackItem = when (val item = entry.item) {
        is PlayableItem.Theme -> resolveTheme(entry, item, intent, isOnline, localMedia)
        is PlayableItem.RelatedSong -> resolveRelatedSong(entry, item, isOnline, localMedia)
    }

    fun resolveVideoFailureFallback(
        entry: QueueEntry,
        intent: PlaybackIntent,
        isOnline: Boolean,
        localMedia: Map<MediaKey, LocalMediaFile>
    ): ResolvedPlaybackItem {
        val preferred = resolve(entry, intent, isOnline, localMedia)
        if (entry.item !is PlayableItem.Theme || preferred.preferredMode != PlaybackMode.VIDEO) {
            return preferred
        }
        val tvCandidate = resolve(
            entry,
            intent.copy(sessionOverride = PlaybackMode.TV_SIZE),
            isOnline,
            localMedia
        )
        return if (tvCandidate.actualMode == PlaybackMode.TV_SIZE) {
            tvCandidate.copy(
                preferredMode = PlaybackMode.VIDEO,
                retainedIntentReason = RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE
            )
        } else {
            tvCandidate.copy(
                preferredMode = PlaybackMode.VIDEO,
                actualMode = null,
                uri = null,
                mediaKey = null,
                source = null,
                retainedIntentReason = RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE
            )
        }
    }

    private fun resolveTheme(
        entry: QueueEntry,
        item: PlayableItem.Theme,
        intent: PlaybackIntent,
        isOnline: Boolean,
        localMedia: Map<MediaKey, LocalMediaFile>
    ): ResolvedPlaybackItem {
        val descriptor = item.modeDescriptor
        val preferred = entry.baseModePolicy.resolvePreferred(intent)
        val tvKey = MediaKey.themeTv(item.theme.id)
        val fullKey = descriptor?.fullSizeSongId?.let(MediaKey::songAudio)
        val tvUrl = if (descriptor != null) {
            descriptor.tvSizeUrl.takeIf(String::isNotBlank)
        } else {
            item.theme.audioUrl.takeIf(String::isNotBlank)
        }
        val fullUrl = descriptor?.fullSizeUrl?.takeIf(String::isNotBlank)
        val videoUrl = descriptor?.videoUrl?.takeIf(String::isNotBlank)

        fun hasLocal(key: MediaKey?): Boolean = key != null && localMedia[key]?.filePath?.isNotBlank() == true
        val availableModes = buildSet {
            if (hasLocal(tvKey) || (isOnline && tvUrl != null)) add(PlaybackMode.TV_SIZE)
            if (hasLocal(fullKey) || (isOnline && fullUrl != null)) add(PlaybackMode.FULL_SIZE)
            if (isOnline && videoUrl != null) add(PlaybackMode.VIDEO)
        }

        val actual = if (!isOnline) {
            preferred.takeIf { it in availableModes && it != PlaybackMode.VIDEO }
        } else {
            when (preferred) {
                PlaybackMode.TV_SIZE -> when {
                    PlaybackMode.TV_SIZE in availableModes -> PlaybackMode.TV_SIZE
                    PlaybackMode.FULL_SIZE in availableModes -> PlaybackMode.FULL_SIZE
                    else -> null
                }
                PlaybackMode.FULL_SIZE -> when {
                    PlaybackMode.FULL_SIZE in availableModes -> PlaybackMode.FULL_SIZE
                    PlaybackMode.TV_SIZE in availableModes -> PlaybackMode.TV_SIZE
                    else -> null
                }
                PlaybackMode.VIDEO -> when {
                    PlaybackMode.VIDEO in availableModes -> PlaybackMode.VIDEO
                    PlaybackMode.TV_SIZE in availableModes -> PlaybackMode.TV_SIZE
                    else -> null
                }
                PlaybackMode.RELATED_AUDIO -> null
            }
        }

        val actualKey = when (actual) {
            PlaybackMode.TV_SIZE -> tvKey
            PlaybackMode.FULL_SIZE -> fullKey
            else -> null
        }
        val local = actualKey?.let(localMedia::get)?.takeIf { it.filePath.isNotBlank() }
        val uri = local?.filePath?.toLocalUri() ?: when (actual) {
            PlaybackMode.TV_SIZE -> tvUrl
            PlaybackMode.FULL_SIZE -> fullUrl
            PlaybackMode.VIDEO -> videoUrl
            else -> null
        }
        val source = when {
            local != null -> PlaybackSource.LOCAL
            actual == PlaybackMode.VIDEO -> PlaybackSource.DIRECT_VIDEO
            actual != null -> PlaybackSource.SERVER_AUDIO
            else -> null
        }
        val retainedReason = when {
            !isOnline && actual == null -> RetainedIntentReason.EXACT_OFFLINE_MEDIA_MISSING
            actual != preferred -> RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE
            else -> null
        }

        return ResolvedPlaybackItem(
            queueId = entry.queueId,
            playableKey = item.key,
            preferredMode = preferred,
            actualMode = actual,
            uri = uri,
            mediaKey = actualKey,
            source = source,
            availableModes = availableModes,
            retainedIntentReason = retainedReason,
            title = item.display.title,
            artist = item.display.artist,
            animeOrRelease = item.display.animeTitle ?: item.display.album,
            artworkUrl = item.display.artworkUrl,
            albumTitle = item.display.album,
            animeTitle = item.display.animeTitle,
            videoSpoiler = descriptor?.videoSpoiler == true,
            videoNsfw = descriptor?.videoNsfw == true
        )
    }

    private fun resolveRelatedSong(
        entry: QueueEntry,
        item: PlayableItem.RelatedSong,
        isOnline: Boolean,
        localMedia: Map<MediaKey, LocalMediaFile>
    ): ResolvedPlaybackItem {
        val key = MediaKey.songAudio(item.song.id)
        val local = localMedia[key]?.takeIf { it.filePath.isNotBlank() }
        val onlineUri = item.song.audioUrl.takeIf { isOnline && it.isNotBlank() }
        val uri = local?.filePath?.toLocalUri() ?: onlineUri
        val available = if (uri != null) setOf(PlaybackMode.RELATED_AUDIO) else emptySet()
        return ResolvedPlaybackItem(
            queueId = entry.queueId,
            playableKey = item.key,
            preferredMode = PlaybackMode.RELATED_AUDIO,
            actualMode = PlaybackMode.RELATED_AUDIO.takeIf { uri != null },
            uri = uri,
            mediaKey = key,
            source = when {
                local != null -> PlaybackSource.LOCAL
                onlineUri != null -> PlaybackSource.SERVER_AUDIO
                else -> null
            },
            availableModes = available,
            retainedIntentReason = if (!isOnline && local == null) {
                RetainedIntentReason.EXACT_OFFLINE_MEDIA_MISSING
            } else null,
            title = item.display.title,
            artist = item.display.artist,
            animeOrRelease = item.display.animeTitle ?: item.display.album,
            artworkUrl = item.display.artworkUrl,
            albumTitle = item.display.album,
            animeTitle = item.display.animeTitle
        )
    }
}

private fun BaseModePolicy.resolvePreferred(intent: PlaybackIntent): PlaybackMode =
    intent.sessionOverride ?: when (entryPolicy) {
        ThemeModePolicy.TV_SIZE -> PlaybackMode.TV_SIZE
        ThemeModePolicy.FULL_SIZE -> PlaybackMode.FULL_SIZE
        ThemeModePolicy.INHERIT -> playlistDefault ?: intent.rememberedAudioMode
    }

private fun String.toLocalUri(): String = when {
    contains("://") -> this
    startsWith("/") -> "file://$this"
    else -> "file:///$this"
}

/** Runtime snapshot adapter; all mode decisions remain inside [PlaybackResolver]. */
@Singleton
class PlaybackResolutionCoordinator @Inject constructor(
    private val resolver: PlaybackResolver,
    private val connectivityMonitor: ConnectivityMonitor,
    private val downloadItemDao: DownloadItemDao,
    private val themeModeDao: ThemeModeDao
) {
    suspend fun resolve(entry: QueueEntry, intent: PlaybackIntent): ResolvedPlaybackItem {
        val snapshot = snapshot(entry)
        return resolver.resolve(snapshot.entry, intent, snapshot.isOnline, snapshot.localMedia)
    }

    suspend fun resolveVideoFailureFallback(
        entry: QueueEntry,
        intent: PlaybackIntent
    ): ResolvedPlaybackItem {
        val snapshot = snapshot(entry)
        return resolver.resolveVideoFailureFallback(
            snapshot.entry,
            intent,
            snapshot.isOnline,
            snapshot.localMedia
        )
    }

    private suspend fun snapshot(entry: QueueEntry): ResolutionSnapshot {
        val hydratedEntry = entry.withModeDescriptor(themeModeDao)
        val keys = hydratedEntry.possibleMediaKeys()
        val downloads = if (keys.isEmpty()) emptyList() else {
            downloadItemDao.getByMediaKeys(keys.map { it.value })
        }
        return ResolutionSnapshot(
            entry = hydratedEntry,
            isOnline = connectivityMonitor.isOnline.value,
            localMedia = completedLocalMedia(downloads).filterKeys { it in keys }
        )
    }
}

private data class ResolutionSnapshot(
    val entry: QueueEntry,
    val isOnline: Boolean,
    val localMedia: Map<MediaKey, LocalMediaFile>
)

private suspend fun QueueEntry.withModeDescriptor(themeModeDao: ThemeModeDao): QueueEntry {
    val themeItem = item as? PlayableItem.Theme ?: return this
    if (themeItem.modeDescriptor != null) return this
    val descriptor = themeModeDao.getByThemeIds(listOf(themeItem.theme.id)).firstOrNull()
    return copy(item = themeItem.copy(modeDescriptor = descriptor))
}

internal fun completedLocalMedia(downloads: List<DownloadItemEntity>): Map<MediaKey, LocalMediaFile> =
    downloads.mapNotNull { download ->
        val path = download.filePath?.takeIf(String::isNotBlank) ?: return@mapNotNull null
        if (!download.status.equals("completed", ignoreCase = true)) return@mapNotNull null
        val key = MediaKey(download.mediaKey)
        key to LocalMediaFile(key, path)
    }.toMap()

private fun QueueEntry.possibleMediaKeys(): Set<MediaKey> = when (val playable = item) {
    is PlayableItem.Theme -> buildSet {
        add(MediaKey.themeTv(playable.theme.id))
        playable.modeDescriptor?.fullSizeSongId?.let { add(MediaKey.songAudio(it)) }
    }
    is PlayableItem.RelatedSong -> setOf(MediaKey.songAudio(playable.song.id))
}
