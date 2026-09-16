package com.takeya.animeongaku.media

import androidx.media3.common.util.UnstableApi
import com.takeya.animeongaku.data.local.DownloadItemDao
import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.LoudnessProfile
import com.takeya.animeongaku.data.local.MusicCatalogDao
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.network.ServerReachabilityMonitor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

enum class PlaybackMode { TV_SIZE, FULL_SIZE, VIDEO, RELATED_AUDIO }

enum class ThemeModePolicy { INHERIT, TV_SIZE, FULL_SIZE }

data class PlaybackIntent(
    val rememberedAudioMode: PlaybackMode = PlaybackMode.TV_SIZE,
    val sessionOverride: PlaybackMode? = null,
    /** Distinguishes a later manual action from a source-provided queue seed. */
    val manualOverride: Boolean = false,
    /** Monotonic queue-local action sequence used to age soft playlist seeds. */
    val actionSequence: Long = 0L,
    /** Sequence at which the queue-level desired mode was seeded or manually changed. */
    val queueDesiredSequence: Long = 0L,
    /** True once a queue has been created; false keeps direct resolver calls backwards compatible. */
    val queueStarted: Boolean = false
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
    val filePath: String,
    val loudness: LoudnessProfile? = null
)

enum class PlaybackSource { LOCAL, SERVER_AUDIO, DIRECT_VIDEO }

enum class RetainedIntentReason {
    PREFERRED_MODE_UNAVAILABLE,
    EXACT_OFFLINE_MEDIA_MISSING,
    REQUIRED_UNAVAILABLE,
    STRICT_MODE_REJECTED
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
    val dislikedModes: Set<PlaybackMode> = emptySet(),
    val title: String,
    val artist: String?,
    val animeOrRelease: String?,
    val artworkUrl: String?,
    val albumTitle: String? = null,
    val animeTitle: String? = null,
    val themeLabel: String? = null,
    val videoSpoiler: Boolean = false,
    val videoNsfw: Boolean = false,
    val loudness: LoudnessProfile? = null
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
        localMedia: Map<MediaKey, LocalMediaFile>,
        preferredThemeMode: PlaybackMode? = null,
        themePreference: UserPreferenceEntity? = null,
        cachedServerMedia: Set<MediaKey> = emptySet(),
    ): ResolvedPlaybackItem = when (val item = entry.item) {
        is PlayableItem.Theme -> resolveTheme(
            entry,
            item,
            intent,
            isOnline,
            localMedia,
            preferredThemeMode,
            themePreference,
            cachedServerMedia,
        )
        is PlayableItem.RelatedSong -> resolveRelatedSong(entry, item, isOnline, localMedia, cachedServerMedia)
    }

    fun resolveVideoFailureFallback(
        entry: QueueEntry,
        intent: PlaybackIntent,
        isOnline: Boolean,
        localMedia: Map<MediaKey, LocalMediaFile>,
        themePreference: UserPreferenceEntity? = null,
        cachedServerMedia: Set<MediaKey> = emptySet(),
    ): ResolvedPlaybackItem {
        val preferred = resolve(
            entry,
            intent,
            isOnline,
            localMedia,
            themePreference = themePreference,
            cachedServerMedia = cachedServerMedia,
        )
        if (entry.item !is PlayableItem.Theme || preferred.preferredMode != PlaybackMode.VIDEO) {
            return preferred
        }
        // Video failure is an audio-only fallback. Preserve dislike flags, but remove the saved
        // audio preference so it cannot redirect this explicit Video intent to Full before the
        // required TV (or strict required) fallback is considered.
        val audioCandidate = resolve(
            entry.copy(
                // The fallback is a new automatic audio admission. A manual Video/unskip
                // exemption must not carry over and allow a disliked audio variant through.
                desiredMode = null,
                manualMode = null,
                replayRequested = false,
                isUnskipped = false,
            ),
            intent.copy(sessionOverride = PlaybackMode.TV_SIZE, manualOverride = false),
            isOnline,
            localMedia,
            themePreference = themePreference?.copy(preferredMode = null),
            cachedServerMedia = cachedServerMedia,
        )
        val requiredMode = entry.baseModePolicy.requiredMode()
        val acceptedAudioMode = requiredMode ?: PlaybackMode.TV_SIZE
        return if (audioCandidate.actualMode == acceptedAudioMode) {
            audioCandidate.copy(
                preferredMode = PlaybackMode.VIDEO,
                retainedIntentReason = audioCandidate.retainedIntentReason
                    ?: RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE
            )
        } else {
            audioCandidate.copy(
                preferredMode = PlaybackMode.VIDEO,
                actualMode = null,
                uri = null,
                mediaKey = null,
                source = null,
                retainedIntentReason = audioCandidate.retainedIntentReason
                    ?: RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE
            )
        }
    }

    private fun resolveTheme(
        entry: QueueEntry,
        item: PlayableItem.Theme,
        intent: PlaybackIntent,
        isOnline: Boolean,
        localMedia: Map<MediaKey, LocalMediaFile>,
        preferredThemeMode: PlaybackMode?,
        themePreference: UserPreferenceEntity?,
        cachedServerMedia: Set<MediaKey>,
    ): ResolvedPlaybackItem {
        val descriptor = item.effectiveModeDescriptor
        require(preferredThemeMode == null || preferredThemeMode == PlaybackMode.TV_SIZE || preferredThemeMode == PlaybackMode.FULL_SIZE)
        val storedPreferredMode = when (themePreference?.preferredMode) {
            "TV_SIZE" -> PlaybackMode.TV_SIZE
            "FULL_SIZE" -> PlaybackMode.FULL_SIZE
            else -> preferredThemeMode
        }
        val requiredMode = entry.baseModePolicy.requiredMode()
        val softMode = entry.baseModePolicy.softMode()
        val queueDesiredMode = entry.desiredMode ?: intent.sessionOverride ?:
            if (intent.queueStarted) PlaybackMode.TV_SIZE else intent.rememberedAudioMode
        val softSeedIsNewer = softMode != null && entry.modeSeedSequence > intent.queueDesiredSequence
        val activeSoftMode = softMode.takeIf { softSeedIsNewer }?.takeUnless {
            intent.manualOverride && entry.modeSeedSequence < intent.actionSequence
        } ?: softMode.takeUnless {
            intent.manualOverride && entry.modeSeedSequence < intent.actionSequence
        }
        // Resolver calls made outside a live queue retain the historical remembered-audio
        // default, while manager-created queues always start at TV unless the source supplied
        // a queue/playlist seed. A playlist policy on a direct entry is itself that source seed.
        val effectiveQueueMode = when {
            softSeedIsNewer -> activeSoftMode
            !intent.queueStarted -> if (entry.desiredMode != null || intent.sessionOverride != null) {
                queueDesiredMode
            } else {
                activeSoftMode ?: intent.rememberedAudioMode
            }
            else -> queueDesiredMode
        }
        val requested = when {
            entry.manualMode != null -> entry.manualMode
            // A queue-level Video request is explicit until a newer soft entry seed replaces it.
            effectiveQueueMode == PlaybackMode.VIDEO -> PlaybackMode.VIDEO
            requiredMode != null -> requiredMode
            storedPreferredMode != null -> storedPreferredMode
            else -> effectiveQueueMode
        }
        val desiredMode = requested ?: PlaybackMode.TV_SIZE
        val tvDisliked = themePreference?.isDislikedTvSize == true
        val fullDisliked = themePreference?.isDislikedFullSize == true
        val dislikedModes = buildSet {
            if (tvDisliked) add(PlaybackMode.TV_SIZE)
            if (fullDisliked) add(PlaybackMode.FULL_SIZE)
        }
        val allowDisliked = entry.manualMode != null || entry.isUnskipped
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
        fun hasCachedServerMedia(key: MediaKey?, url: String?): Boolean =
            key != null && url != null && key in cachedServerMedia
        val physicalModes = buildSet {
            if (hasLocal(tvKey) || hasCachedServerMedia(tvKey, tvUrl) || (isOnline && tvUrl != null)) {
                add(PlaybackMode.TV_SIZE)
            }
            if (hasLocal(fullKey) || hasCachedServerMedia(fullKey, fullUrl) || (isOnline && fullUrl != null)) {
                add(PlaybackMode.FULL_SIZE)
            }
            if (isOnline && videoUrl != null) add(PlaybackMode.VIDEO)
        }
        // `availableModes` is the picker surface: a disliked physical variant remains visible
        // so the user can explicitly choose it. Automatic playback uses `allowedModes` below,
        // which applies the dislike filter unless this occurrence was explicitly unskipped.
        val availableModes = if (requiredMode != null) {
            buildSet {
                if (requiredMode in physicalModes) add(requiredMode)
                if (PlaybackMode.VIDEO in physicalModes && requiredMode in physicalModes) {
                    add(PlaybackMode.VIDEO)
                }
            }
        } else {
            physicalModes
        }

        val audioOrder = when (desiredMode) {
            PlaybackMode.FULL_SIZE -> listOf(PlaybackMode.FULL_SIZE, PlaybackMode.TV_SIZE)
            else -> listOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE)
        }
        val allowedModes = if (allowDisliked) availableModes else availableModes - dislikedModes
        val manualViolatesStrict = requiredMode != null && entry.manualMode != null &&
            entry.manualMode != requiredMode && entry.manualMode != PlaybackMode.VIDEO
        val recordedSelection = entry.lastActualMode?.takeIf {
            (entry.replayRequested || entry.isUnskipped) && entry.manualMode == null && it in allowedModes
        }
        val candidate = when {
            manualViolatesStrict -> null
            // A strict occurrence cannot be satisfied by a Video-only descriptor. Keep this gate
            // ahead of replay so an old recorded Video/source cannot bypass the requirement.
            requiredMode != null && requiredMode !in physicalModes -> null
            recordedSelection != null -> recordedSelection
            desiredMode == PlaybackMode.VIDEO -> when {
                PlaybackMode.VIDEO in allowedModes -> PlaybackMode.VIDEO
                requiredMode != null -> requiredMode.takeIf { it in allowedModes }
                PlaybackMode.TV_SIZE in allowedModes -> PlaybackMode.TV_SIZE
                else -> null
            }
            else -> audioOrder.firstOrNull { it in allowedModes }
        }

        // A required playlist version is a constraint, never permission to ignore the user.
        val actual = candidate.takeUnless {
            requiredMode != null && it != requiredMode && it != PlaybackMode.VIDEO
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
        val loudness = local?.loudness ?: when (actual) {
            PlaybackMode.TV_SIZE -> descriptor?.tvSizeLoudness
            PlaybackMode.FULL_SIZE -> descriptor?.fullSizeLoudness
            else -> null
        }
        val retainedReason = when {
            manualViolatesStrict -> RetainedIntentReason.STRICT_MODE_REJECTED
            requiredMode != null && requiredMode !in physicalModes -> RetainedIntentReason.REQUIRED_UNAVAILABLE
            !isOnline && actual == null -> RetainedIntentReason.EXACT_OFFLINE_MEDIA_MISSING
            actual != desiredMode -> RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE
            else -> null
        }

        return ResolvedPlaybackItem(
            queueId = entry.queueId,
            playableKey = item.key,
            preferredMode = desiredMode,
            actualMode = actual,
            uri = uri,
            mediaKey = actualKey,
            source = source,
            availableModes = availableModes,
            retainedIntentReason = retainedReason,
            dislikedModes = dislikedModes,
            title = item.display.title,
            artist = item.display.artist,
            animeOrRelease = item.display.animeTitle ?: item.display.album,
            artworkUrl = item.display.artworkUrl,
            albumTitle = item.display.album,
            animeTitle = item.display.animeTitle,
            themeLabel = item.theme.themeType.toThemeDisplayLabel(),
            videoSpoiler = descriptor?.videoSpoiler == true,
            videoNsfw = descriptor?.videoNsfw == true,
            loudness = loudness
        )
    }

    private fun resolveRelatedSong(
        entry: QueueEntry,
        item: PlayableItem.RelatedSong,
        isOnline: Boolean,
        localMedia: Map<MediaKey, LocalMediaFile>,
        cachedServerMedia: Set<MediaKey>,
    ): ResolvedPlaybackItem {
        val key = MediaKey.songAudio(item.song.id)
        val local = localMedia[key]?.takeIf { it.filePath.isNotBlank() }
        val serverUri = item.song.audioUrl.takeIf(String::isNotBlank)
        val serverPlayable = isOnline || key in cachedServerMedia
        val onlineUri = serverUri.takeIf { serverPlayable }
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
            animeTitle = item.display.animeTitle,
            loudness = local?.loudness ?: item.song.loudness
        )
    }
}

private fun BaseModePolicy.requiredMode(): PlaybackMode? =
    takeIf { overrideUserPreference }?.let { policy ->
        when (policy.entryPolicy) {
            ThemeModePolicy.TV_SIZE -> PlaybackMode.TV_SIZE
            ThemeModePolicy.FULL_SIZE -> PlaybackMode.FULL_SIZE
            ThemeModePolicy.INHERIT -> playlistDefault
        }
    }

private fun BaseModePolicy.softMode(): PlaybackMode? = when (entryPolicy) {
    ThemeModePolicy.TV_SIZE -> PlaybackMode.TV_SIZE
    ThemeModePolicy.FULL_SIZE -> PlaybackMode.FULL_SIZE
    ThemeModePolicy.INHERIT -> playlistDefault
}

private fun BaseModePolicy.resolvePreferred(intent: PlaybackIntent): PlaybackMode =
    intent.sessionOverride ?: softMode() ?: PlaybackMode.TV_SIZE

private fun String.toLocalUri(): String = when {
    contains("://") -> this
    startsWith("/") -> "file://$this"
    else -> "file:///$this"
}

/** Runtime snapshot adapter; all mode decisions remain inside [PlaybackResolver]. */
@Singleton
@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackResolutionCoordinator @Inject constructor(
    private val resolver: PlaybackResolver,
    private val serverReachabilityMonitor: ServerReachabilityMonitor,
    private val downloadItemDao: DownloadItemDao,
    private val themeModeDao: ThemeModeDao,
    private val musicCatalogDao: MusicCatalogDao,
    private val userPreferenceDao: UserPreferenceDao,
    private val audioCacheProvider: AudioCacheProvider,
    private val serverSettingsStore: ServerSettingsStore,
) {
    suspend fun resolve(entry: QueueEntry, intent: PlaybackIntent): ResolvedPlaybackItem {
        val snapshot = snapshots(listOf(entry)).single()
        return resolver.resolve(
            snapshot.entry,
            intent,
            snapshot.isOnline,
            snapshot.localMedia,
            snapshot.preferredThemeMode,
            snapshot.themePreference,
            snapshot.cachedServerMedia,
        )
    }

    /**
     * Resolves a queue as one runtime snapshot. This avoids one Room query per entry and keeps
     * filesystem validation off the main dispatcher when a queue changes.
     */
    suspend fun resolveAll(
        entries: Collection<QueueEntry>,
        intent: PlaybackIntent,
    ): List<ResolvedPlaybackItem> {
        if (entries.isEmpty()) return emptyList()
        return snapshots(entries.toList()).map { snapshot ->
            resolver.resolve(
                snapshot.entry,
                intent,
                snapshot.isOnline,
                snapshot.localMedia,
                snapshot.preferredThemeMode,
                snapshot.themePreference,
                snapshot.cachedServerMedia,
            )
        }
    }

    suspend fun resolveVideoFailureFallback(
        entry: QueueEntry,
        intent: PlaybackIntent
    ): ResolvedPlaybackItem {
        val snapshot = snapshots(listOf(entry)).single()
        return resolver.resolveVideoFailureFallback(
            snapshot.entry,
            intent,
            snapshot.isOnline,
            snapshot.localMedia,
            snapshot.themePreference,
            snapshot.cachedServerMedia,
        )
    }

    private suspend fun snapshots(entries: List<QueueEntry>): List<ResolutionSnapshot> =
        withContext(Dispatchers.IO) {
            val themeIds = entries.mapNotNull { entry ->
                val theme = entry.item as? PlayableItem.Theme ?: return@mapNotNull null
                theme.theme.id
            }.distinct()
            val songIds = entries.mapNotNull { entry ->
                (entry.item as? PlayableItem.RelatedSong)?.song?.id
            }.distinct()
            val descriptorsByThemeId = if (themeIds.isEmpty()) emptyMap() else {
                themeModeDao.getByThemeIds(themeIds).associateBy { it.themeId }
            }
            val preferredModesByThemeId = if (themeIds.isEmpty()) emptyMap() else {
                userPreferenceDao.getPreferencesByIdsIncludingDeleted(themeIds)
                    .associateBy(UserPreferenceEntity::themeId)
            }
            val songsById = if (songIds.isEmpty()) emptyMap() else {
                musicCatalogDao.getSongs(songIds).associateBy { it.id }
            }
            val hydratedEntries = entries.map { entry ->
                entry.withLatestMediaMetadata(descriptorsByThemeId, songsById)
            }
            val request = buildPlaybackResolutionBatchRequest(hydratedEntries)
            val downloads = if (request.mediaKeys.isEmpty()) emptyList() else {
                downloadItemDao.getByMediaKeys(request.mediaKeys.map { it.value })
            }
            val localMedia = completedLocalMedia(downloads)
            val cachedServerMedia = hydratedEntries
                .flatMap { it.serverAudioCandidates(serverSettingsStore.serverBaseUrl).entries }
                .filterTo(linkedSetOf()) { (mediaKey, url) ->
                    audioCacheProvider.isFullyCached(url, mediaKey)
                }
                .mapTo(linkedSetOf()) { it.key }
            val isOnline = serverReachabilityMonitor.isReachable.value
            hydratedEntries.map { hydratedEntry ->
                val keys = hydratedEntry.possibleMediaKeys()
                val themeItem = hydratedEntry.item as? PlayableItem.Theme
                val localPreference = themeItem?.theme?.id?.let(preferredModesByThemeId::get)
                val snapshotPreference = themeItem?.serverPreference
                val effectivePreference = newestActivePreference(localPreference, snapshotPreference)
                ResolutionSnapshot(
                    entry = hydratedEntry,
                    isOnline = isOnline,
                    localMedia = localMedia.filterKeys { it in keys },
                    preferredThemeMode = effectivePreference
                        ?.preferredMode
                        ?.takeIf { it == "TV_SIZE" || it == "FULL_SIZE" }
                        ?.let { mode ->
                            when (mode) {
                                "TV_SIZE" -> PlaybackMode.TV_SIZE
                                "FULL_SIZE" -> PlaybackMode.FULL_SIZE
                                else -> null
                            }
                        },
                    themePreference = effectivePreference,
                    cachedServerMedia = cachedServerMedia.filterTo(linkedSetOf()) { it in keys },
                )
            }
        }
}

internal fun newestActivePreference(
    localPreference: UserPreferenceEntity?,
    snapshotPreference: UserPreferenceEntity?
): UserPreferenceEntity? {
    val newest = when {
        snapshotPreference == null -> localPreference
        localPreference == null -> snapshotPreference
        snapshotPreference.updatedAt > localPreference.updatedAt -> snapshotPreference
        else -> localPreference
    }
    return newest?.takeUnless { it.deletedAt != null }
}

private data class ResolutionSnapshot(
    val entry: QueueEntry,
    val isOnline: Boolean,
    val localMedia: Map<MediaKey, LocalMediaFile>,
    val preferredThemeMode: PlaybackMode?,
    val themePreference: UserPreferenceEntity?,
    val cachedServerMedia: Set<MediaKey>,
)

internal fun QueueEntry.withLatestMediaMetadata(
    descriptorsByThemeId: Map<Long, ThemeModeEntity>,
    songsById: Map<Long, com.takeya.animeongaku.data.local.SongEntity>,
): QueueEntry {
    val refreshedItem = when (val playable = item) {
        is PlayableItem.Theme -> playable.copy(
            modeDescriptor = descriptorsByThemeId[playable.theme.id] ?: playable.modeDescriptor
        )
        is PlayableItem.RelatedSong -> playable.copy(
            song = songsById[playable.song.id] ?: playable.song
        )
    }
    return copy(item = refreshedItem)
}

internal fun completedLocalMedia(downloads: List<DownloadItemEntity>): Map<MediaKey, LocalMediaFile> =
    downloads.mapNotNull { download ->
        val path = download.filePath?.takeIf(String::isNotBlank) ?: return@mapNotNull null
        if (!download.status.equals("completed", ignoreCase = true)) return@mapNotNull null
        if (!path.contains("://") && !java.io.File(path).isFile) return@mapNotNull null
        val key = MediaKey(download.mediaKey)
        key to LocalMediaFile(key, path, download.loudness)
    }.toMap()

internal fun QueueEntry.possibleMediaKeys(): Set<MediaKey> = when (val playable = item) {
    is PlayableItem.Theme -> buildSet {
        add(MediaKey.themeTv(playable.theme.id))
        playable.effectiveModeDescriptor?.fullSizeSongId?.let { add(MediaKey.songAudio(it)) }
    }
    is PlayableItem.RelatedSong -> setOf(MediaKey.songAudio(playable.song.id))
}

internal fun QueueEntry.serverAudioCandidates(activeServerBaseUrl: String?): Map<MediaKey, String> =
    when (val playable = item) {
        is PlayableItem.Theme -> buildMap {
            val descriptor = playable.effectiveModeDescriptor
            val tvUrl = descriptor?.tvSizeUrl?.takeIf(String::isNotBlank)
                ?: playable.theme.audioUrl.takeIf(String::isNotBlank)
            tvUrl?.let { put(MediaKey.themeTv(playable.theme.id), rewriteServerMediaUrl(it, activeServerBaseUrl)) }
            descriptor?.fullSizeSongId?.let { songId ->
                descriptor.fullSizeUrl?.takeIf(String::isNotBlank)?.let { url ->
                    put(MediaKey.songAudio(songId), rewriteServerMediaUrl(url, activeServerBaseUrl))
                }
            }
        }
        is PlayableItem.RelatedSong -> mapOf(
            MediaKey.songAudio(playable.song.id) to
                rewriteServerMediaUrl(playable.song.audioUrl, activeServerBaseUrl)
        ).filterValues(String::isNotBlank)
    }
