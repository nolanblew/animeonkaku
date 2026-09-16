package com.takeya.animeongaku.media

import android.content.Context
import android.util.Log
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.LoudnessProfile
import com.takeya.animeongaku.data.local.MusicCatalogDao
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.server.ServerSettingsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class PersistedQueueEntry(
    val queueId: Long = 0L,
    val themeId: Long = 0L,
    val itemType: String? = null,
    val itemId: Long? = null,
    val releaseId: Long? = null,
    val animeKitsuId: String? = null,
    val relationshipType: String? = null,
    val baseMode: String? = null,
    val playlistDefaultMode: String? = null,
    val overrideUserPreference: Boolean = false,
    val desiredMode: String? = null,
    val lastActualMode: String? = null,
    val manualMode: String? = null,
    val modeSeedSequence: Long = 0L,
    val replayRequested: Boolean = false,
    val isUnskipped: Boolean = false,
    val serverPreferredMode: String? = null,
    val serverPreferenceUpdatedAt: Long = 0L,
    val serverPreferenceLiked: Boolean = false,
    val serverPreferenceDisliked: Boolean = false,
    val serverPreferenceDislikedTvSize: Boolean = false,
    val serverPreferenceDislikedFullSize: Boolean = false,
    val serverPreferencePresent: Boolean = false,
    val themeMetadata: PersistedThemeMetadata? = null,
    val songMetadata: PersistedSongMetadata? = null,
    val releaseMetadata: PersistedReleaseMetadata? = null,
    val animeMetadata: PersistedAnimeMetadata? = null,
    val modeMetadata: PersistedThemeModeMetadata? = null,
    val roomModeBaselineMetadata: PersistedThemeModeMetadata? = null,
    val localFilePath: String? = null
)

@JsonClass(generateAdapter = true)
data class PersistedThemeMetadata(
    val id: Long,
    val animeId: Long? = null,
    val title: String,
    val artistName: String? = null,
    val audioUrl: String,
    val videoUrl: String? = null,
    val isDownloaded: Boolean = false,
    val localFilePath: String? = null,
    val themeType: String? = null,
    val source: String = ThemeEntity.SOURCE_KITSU
)

@JsonClass(generateAdapter = true)
data class PersistedLoudnessMetadata(
    val integratedLufs: Double? = null,
    val truePeakDbtp: Double? = null,
    val loudnessRangeLu: Double? = null,
    val gainDb: Double? = null,
    val policyVersion: Int? = null,
    val state: String? = null
)

@JsonClass(generateAdapter = true)
data class PersistedSongMetadata(
    val id: Long,
    val title: String,
    val artistCredit: String,
    val durationSeconds: Int? = null,
    val audioUrl: String,
    val fileSize: Long? = null,
    val titleEnglish: String? = null,
    val titleRomaji: String? = null,
    val titleJapanese: String? = null,
    val artistNamesJson: String = "[]",
    val loudness: PersistedLoudnessMetadata? = null
)

@JsonClass(generateAdapter = true)
data class PersistedReleaseMetadata(
    val id: Long,
    val title: String,
    val artistCredit: String,
    val releaseDate: String? = null,
    val year: Int? = null,
    val artworkUrl: String? = null,
    val titleEnglish: String? = null,
    val titleRomaji: String? = null,
    val titleJapanese: String? = null,
    val artistNamesJson: String = "[]"
)

@JsonClass(generateAdapter = true)
data class PersistedAnimeMetadata(
    val kitsuId: String,
    val animeThemesId: Long? = null,
    val title: String? = null,
    val titleEn: String? = null,
    val titleRomaji: String? = null,
    val titleJa: String? = null,
    val thumbnailUrl: String? = null,
    val thumbnailUrlLarge: String? = null,
    val coverUrl: String? = null,
    val coverUrlLarge: String? = null,
    val syncedAt: Long = 0L,
    val isManuallyAdded: Boolean = false,
    val watchingStatus: String? = null,
    val subtype: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val episodeCount: Int? = null,
    val ageRating: String? = null,
    val averageRating: Double? = null,
    val userRating: Double? = null,
    val libraryUpdatedAt: Long? = null,
    val watchedAt: Long? = null,
    val slug: String? = null
)

@JsonClass(generateAdapter = true)
data class PersistedThemeModeMetadata(
    val themeId: Long,
    val tvSizeUrl: String,
    val tvSizeDurationSeconds: Int? = null,
    val tvSizeFileSize: Long? = null,
    val fullSizeSongId: Long? = null,
    val fullSizeUrl: String? = null,
    val fullSizeDurationSeconds: Int? = null,
    val fullSizeFileSize: Long? = null,
    val fullSizeSourceReleaseId: Long? = null,
    val videoUrl: String? = null,
    val videoMimeType: String? = null,
    val videoSpoiler: Boolean = false,
    val videoNsfw: Boolean = false,
    val videoEntryVersion: Int? = null,
    val tvSizeLoudness: PersistedLoudnessMetadata? = null,
    val fullSizeLoudness: PersistedLoudnessMetadata? = null
)

@JsonClass(generateAdapter = true)
data class PersistedNowPlayingState(
    val ownerKitsuUserId: String? = null,
    val ownerServerBaseUrl: String? = null,
    val originalQueueIds: List<Long> = emptyList(),
    val nowPlayingIds: List<Long> = emptyList(),
    val currentIndex: Int = 0,
    val historyIds: List<Long> = emptyList(),
    val playNextItemIds: List<Long> = emptyList(),
    val addedToQueueItemIds: List<Long> = emptyList(),
    val suggestedItemIds: List<Long> = emptyList(),
    val originalQueueEntries: List<PersistedQueueEntry> = emptyList(),
    val nowPlayingEntries: List<PersistedQueueEntry> = emptyList(),
    val historyEntries: List<PersistedQueueEntry> = emptyList(),
    val playNextEntryIds: List<Long> = emptyList(),
    val addedToQueueEntryIds: List<Long> = emptyList(),
    val suggestedEntryIds: List<Long> = emptyList(),
    val playedIndices: Set<Int> = emptySet(),
    val isShuffled: Boolean = false,
    val contextLabel: String = "",
    val animeMapKeys: List<Long> = emptyList(),
    val queueVersion: Long = 0L,
    val positionMs: Long = 0L,
    val repeatMode: Int = 0,
    val sessionAudioMode: String? = null,
    /** Queue-local desired mode, including VIDEO. sessionAudioMode is retained for old files. */
    val queueDesiredMode: String? = null,
    val queueDesiredModeManual: Boolean = false,
    val queueActionSequence: Long = 0L,
    val queueDesiredSequence: Long = 0L,
    val queueStarted: Boolean = false,
    val unskippedEntryIds: Set<Long> = emptySet()
)

data class RestoredQueueState(
    val nowPlayingState: NowPlayingState,
    val positionMs: Long,
    val repeatMode: Int
)

@Singleton
class NowPlayingPersistence @Inject constructor(
    @ApplicationContext private val context: Context,
    private val moshi: Moshi,
    private val themeDao: ThemeDao,
    private val animeDao: AnimeDao,
    private val musicCatalogDao: MusicCatalogDao,
    private val themeModeDao: ThemeModeDao,
    private val userPreferenceDao: UserPreferenceDao,
    private val tokenStore: ServerTokenStore,
    private val serverSettingsStore: ServerSettingsStore
) {
    private val file = File(context.filesDir, "now_playing_state.json")
    private val adapter = moshi.adapter(PersistedNowPlayingState::class.java)
    private val mutex = Mutex()

    suspend fun save(state: NowPlayingState, positionMs: Long, repeatMode: Int): Boolean = withContext(Dispatchers.IO) {
        val owner = currentOwner()
        val persisted = state.toPersistedState(positionMs, repeatMode).copy(
            ownerKitsuUserId = owner?.first,
            ownerServerBaseUrl = owner?.second
        )

        try {
            val json = adapter.toJson(persisted)
            mutex.withLock {
                writeTextAtomically(file) { temporary ->
                    temporary.writeText(json)
                }
            }
            Log.d("NowPlayingPersistence", "Saved queue state, size: ${persisted.nowPlayingIds.size}")
            true
        } catch (e: Exception) {
            Log.e("NowPlayingPersistence", "Failed to save queue state", e)
            false
        }
    }

    suspend fun restore(): RestoredQueueState? = withContext(Dispatchers.IO) {
        try {
            val json = mutex.withLock {
                if (!file.exists()) return@withContext null
                file.readText()
            }
            val persisted = adapter.fromJson(json) ?: return@withContext null
            if (!persisted.matchesOwner(currentOwner())) return@withContext null

            val allThemeIds = buildSet {
                addAll(persisted.originalQueueIds)
                addAll(persisted.nowPlayingIds)
                addAll(persisted.historyIds)
                addAll(persisted.playNextItemIds)
                addAll(persisted.addedToQueueItemIds)
                addAll(persisted.suggestedItemIds)
                addAll(persisted.allEntries().mapNotNull { entry ->
                    when (entry.itemType?.uppercase()) {
                        PlayableKind.THEME.name -> entry.itemId
                        null -> entry.themeId.takeIf { it > 0 }
                        else -> null
                    }
                })
            }.filter { it > 0 }
            val allSongIds = persisted.allEntries()
                .filter { it.itemType?.uppercase() == PlayableKind.SONG.name }
                .mapNotNull { it.itemId }
                .distinct()
            val allReleaseIds = persisted.allEntries().mapNotNull { it.releaseId }.distinct()
            val allKitsuIds = persisted.allEntries().mapNotNull { it.animeKitsuId }.distinct()

            val themes = if (allThemeIds.isEmpty()) emptyMap() else {
                themeDao.getByIds(allThemeIds.toList()).associateBy { it.id }
            }
            val themeModes = if (themes.isEmpty()) emptyMap() else {
                themeModeDao.getByThemeIds(themes.keys.toList()).associateBy { it.themeId }
            }
            val localPreferences = if (allThemeIds.isEmpty()) emptyMap() else {
                userPreferenceDao.getPreferencesByIdsIncludingDeleted(allThemeIds)
                    .associateBy { it.themeId }
            }
            val songs = if (allSongIds.isEmpty()) emptyMap() else {
                musicCatalogDao.getSongs(allSongIds).associateBy { it.id }
            }
            val releases = if (allReleaseIds.isEmpty()) emptyMap() else {
                musicCatalogDao.getReleases(allReleaseIds).associateBy { it.id }
            }
            val animeThemeIds = (persisted.animeMapKeys + themes.values.mapNotNull { it.animeId }).distinct()
            val animeMap = if (animeThemeIds.isEmpty()) emptyMap() else {
                animeDao.getByAnimeThemesIds(animeThemeIds).mapNotNull { anime ->
                    anime.animeThemesId?.let { it to anime }
                }.toMap()
            }
            val animeByKitsuId = if (allKitsuIds.isEmpty()) emptyMap() else {
                animeDao.getByKitsuIds(allKitsuIds).associateBy { it.kitsuId }
            }
            if (!persisted.matchesOwner(currentOwner())) return@withContext null

            val restoredState = restorePersistedQueueState(
                persisted,
                themes,
                songs,
                releases,
                animeByKitsuId,
                animeMap,
                themeModes,
                localPreferences
            ) ?: return@withContext null

            Log.d("NowPlayingPersistence", "Restored queue state, size: ${restoredState.nowPlayingEntries.size}")
            RestoredQueueState(restoredState, persisted.positionMs, persisted.repeatMode)
        } catch (e: Exception) {
            Log.e("NowPlayingPersistence", "Failed to restore queue state", e)
            null
        }
    }

    suspend fun clear(): Boolean = withContext(Dispatchers.IO) {
        try {
            mutex.withLock {
                if (file.exists()) file.delete()
            }
            true
        } catch (e: Exception) {
            Log.e("NowPlayingPersistence", "Failed to clear queue state", e)
            false
        }
    }

    private fun currentOwner(): Pair<String, String>? = tokenStore.currentSession()?.kitsuUserId?.let { userId ->
        userId to normalizeServerOwner(serverSettingsStore.serverBaseUrl)
    }
}

internal fun normalizeServerOwner(value: String?): String = value.orEmpty().trim().trimEnd('/')

internal fun PersistedNowPlayingState.matchesOwner(owner: Pair<String, String>?): Boolean =
    if (ownerKitsuUserId == null && ownerServerBaseUrl == null) {
        true
    } else {
        owner != null && ownerKitsuUserId == owner.first &&
            normalizeServerOwner(ownerServerBaseUrl) == normalizeServerOwner(owner.second)
    }

private fun PersistedNowPlayingState.hasOwnerScope(): Boolean =
    ownerKitsuUserId != null && ownerServerBaseUrl != null

internal fun NowPlayingState.toPersistedState(
    positionMs: Long,
    repeatMode: Int
): PersistedNowPlayingState = PersistedNowPlayingState(
    originalQueueIds = originalQueueEntries.mapNotNull { it.themeOrNull?.id },
    nowPlayingIds = nowPlayingEntries.mapNotNull { it.themeOrNull?.id },
    currentIndex = currentIndex,
    historyIds = historyEntries.mapNotNull { it.themeOrNull?.id },
    playNextItemIds = playNextEntries.mapNotNull { it.themeOrNull?.id },
    addedToQueueItemIds = addedToQueueEntries.mapNotNull { it.themeOrNull?.id },
    suggestedItemIds = suggestedEntries.mapNotNull { it.themeOrNull?.id },
    originalQueueEntries = originalQueueEntries.map { it.toPersistedEntry(it.queueId in unskippedEntryIds) },
    nowPlayingEntries = nowPlayingEntries.map { it.toPersistedEntry(it.queueId in unskippedEntryIds) },
    historyEntries = historyEntries.map { it.toPersistedEntry(it.queueId in unskippedEntryIds) },
    playNextEntryIds = playNextEntryIds,
    addedToQueueEntryIds = addedToQueueEntryIds,
    suggestedEntryIds = suggestedEntryIds,
    playedIndices = playedIndices,
    isShuffled = isShuffled,
    contextLabel = contextLabel,
    animeMapKeys = animeMap.keys.toList(),
    queueVersion = queueVersion,
    positionMs = positionMs,
    repeatMode = repeatMode,
    sessionAudioMode = playbackIntent.sessionOverride
        ?.takeIf(PlaybackMode::isAudioMode)
        ?.name,
    queueDesiredMode = playbackIntent.sessionOverride?.name,
    queueDesiredModeManual = playbackIntent.manualOverride,
    queueActionSequence = playbackIntent.actionSequence,
    queueDesiredSequence = playbackIntent.queueDesiredSequence,
    queueStarted = playbackIntent.queueStarted,
    unskippedEntryIds = unskippedEntryIds
)

private fun QueueEntry.toPersistedEntry(unskipped: Boolean = isUnskipped): PersistedQueueEntry = when (val playable = item) {
    is PlayableItem.Theme -> PersistedQueueEntry(
        queueId = queueId,
        themeId = playable.theme.id,
        itemType = PlayableKind.THEME.name,
        itemId = playable.theme.id,
        animeKitsuId = playable.anime?.kitsuId,
        baseMode = baseModePolicy.requestedMode,
        playlistDefaultMode = baseModePolicy.playlistDefault?.name,
        overrideUserPreference = baseModePolicy.overrideUserPreference,
        desiredMode = desiredMode?.name,
        lastActualMode = lastActualMode?.name,
        manualMode = manualMode?.name,
        modeSeedSequence = modeSeedSequence,
        replayRequested = replayRequested,
        isUnskipped = unskipped,
        serverPreferredMode = playable.serverPreference?.preferredMode,
        serverPreferenceUpdatedAt = playable.serverPreference?.updatedAt ?: 0L,
        serverPreferenceLiked = playable.serverPreference?.isLiked == true,
        serverPreferenceDisliked = playable.serverPreference?.isDisliked == true,
        serverPreferenceDislikedTvSize = playable.serverPreference?.isDislikedTvSize == true,
        serverPreferenceDislikedFullSize = playable.serverPreference?.isDislikedFullSize == true,
        serverPreferencePresent = playable.serverPreference != null,
        themeMetadata = playable.theme.toPersistedMetadata(),
        animeMetadata = playable.anime?.toPersistedMetadata(),
        modeMetadata = (playable.remoteModeDescriptor ?: playable.modeDescriptor)?.toPersistedMetadata(),
        roomModeBaselineMetadata = playable.roomModeDescriptorBaseline?.toPersistedMetadata()
    )
    is PlayableItem.RelatedSong -> PersistedQueueEntry(
        queueId = queueId,
        itemType = PlayableKind.SONG.name,
        itemId = playable.song.id,
        releaseId = playable.release?.id,
        animeKitsuId = playable.anime?.kitsuId,
        relationshipType = playable.relationshipType,
        baseMode = baseModePolicy.requestedMode,
        playlistDefaultMode = baseModePolicy.playlistDefault?.name,
        overrideUserPreference = baseModePolicy.overrideUserPreference,
        desiredMode = desiredMode?.name,
        lastActualMode = lastActualMode?.name,
        manualMode = manualMode?.name,
        modeSeedSequence = modeSeedSequence,
        replayRequested = replayRequested,
        isUnskipped = unskipped,
        songMetadata = playable.song.toPersistedMetadata(),
        releaseMetadata = playable.release?.toPersistedMetadata(),
        animeMetadata = playable.anime?.toPersistedMetadata(),
        localFilePath = playable.localFilePath
    )
}

private fun ThemeEntity.toPersistedMetadata() = PersistedThemeMetadata(
    id, animeId, title, artistName, audioUrl, videoUrl, isDownloaded, localFilePath, themeType, source
)

private fun SongEntity.toPersistedMetadata() = PersistedSongMetadata(
    id, title, artistCredit, durationSeconds, audioUrl, fileSize,
    titleEnglish, titleRomaji, titleJapanese, artistNamesJson, loudness?.toPersistedMetadata()
)

private fun MusicReleaseEntity.toPersistedMetadata() = PersistedReleaseMetadata(
    id, title, artistCredit, releaseDate, year, artworkUrl,
    titleEnglish, titleRomaji, titleJapanese, artistNamesJson
)

private fun AnimeEntity.toPersistedMetadata() = PersistedAnimeMetadata(
    kitsuId, animeThemesId, title, titleEn, titleRomaji, titleJa,
    thumbnailUrl, thumbnailUrlLarge, coverUrl, coverUrlLarge, syncedAt,
    isManuallyAdded, watchingStatus, subtype, startDate, endDate, episodeCount,
    ageRating, averageRating, userRating, libraryUpdatedAt, watchedAt, slug
)

private fun ThemeModeEntity.toPersistedMetadata() = PersistedThemeModeMetadata(
    themeId, tvSizeUrl, tvSizeDurationSeconds, tvSizeFileSize, fullSizeSongId,
    fullSizeUrl, fullSizeDurationSeconds, fullSizeFileSize, fullSizeSourceReleaseId,
    videoUrl, videoMimeType, videoSpoiler, videoNsfw, videoEntryVersion,
    tvSizeLoudness?.toPersistedMetadata(), fullSizeLoudness?.toPersistedMetadata()
)

private fun LoudnessProfile.toPersistedMetadata() = PersistedLoudnessMetadata(
    integratedLufs, truePeakDbtp, loudnessRangeLu, gainDb, policyVersion, state
)

private fun PersistedNowPlayingState.allEntries(): List<PersistedQueueEntry> =
    originalQueueEntries + nowPlayingEntries + historyEntries

/**
 * Pure restore boundary used by persistence tests. All entities supplied here came from their
 * owning DAO; an absent entity removes only that queue occurrence and never fabricates a theme.
 */
internal fun restorePersistedQueueState(
    persisted: PersistedNowPlayingState,
    themes: Map<Long, ThemeEntity>,
    songs: Map<Long, SongEntity>,
    releases: Map<Long, MusicReleaseEntity>,
    animeByKitsuId: Map<String, AnimeEntity>,
    animeMap: Map<Long, AnimeEntity>,
    themeModes: Map<Long, ThemeModeEntity> = emptyMap(),
    localPreferences: Map<Long, UserPreferenceEntity> = emptyMap()
): NowPlayingState? {
    val allowPersistedMetadata = persisted.hasOwnerScope()
    var nextFallbackQueueId = persisted.allEntries().maxOfOrNull { it.queueId }
        ?.coerceAtLeast(0L)
        ?.plus(1L)
        ?: 1L

    fun mapPersistedEntry(entry: PersistedQueueEntry): QueueEntry? {
        val queueId = entry.queueId.takeIf { it > 0 } ?: nextFallbackQueueId++
        val policy = BaseModePolicy(
            entryPolicy = entry.baseMode?.let { value ->
                ThemeModePolicy.entries.firstOrNull { it.name == value }
            } ?: ThemeModePolicy.INHERIT,
            playlistDefault = entry.playlistDefaultMode?.let { value ->
                PlaybackMode.entries.firstOrNull { it.name == value }
            }?.takeIf { it == PlaybackMode.TV_SIZE || it == PlaybackMode.FULL_SIZE },
            overrideUserPreference = entry.overrideUserPreference
        )
        val kind = entry.itemType?.uppercase()?.let { value ->
            PlayableKind.entries.firstOrNull { it.name == value }
        } ?: PlayableKind.THEME
        val itemId = entry.itemId ?: entry.themeId.takeIf { it > 0 } ?: return null
        val persistedPreference = (allowPersistedMetadata && entry.serverPreferencePresent).takeIf { it }?.let {
            UserPreferenceEntity(
                themeId = itemId,
                isLiked = entry.serverPreferenceLiked,
                isDisliked = entry.serverPreferenceDisliked,
                isDislikedTvSize = entry.serverPreferenceDislikedTvSize,
                isDislikedFullSize = entry.serverPreferenceDislikedFullSize,
                preferredMode = entry.serverPreferredMode,
                updatedAt = entry.serverPreferenceUpdatedAt
            )
        }
        val localPreference = localPreferences[itemId]
        val effectivePreference = when {
            localPreference == null -> persistedPreference
            persistedPreference == null || localPreference.updatedAt >= persistedPreference.updatedAt ->
                localPreference.takeUnless { it.deletedAt != null }
            else -> persistedPreference
        }
        val item = when (kind) {
            PlayableKind.THEME -> (themes[itemId] ?: entry.themeMetadata?.takeIf { allowPersistedMetadata }?.toEntity())?.let { theme ->
                PlayableItem.Theme(
                    theme = theme,
                    anime = entry.animeKitsuId?.let(animeByKitsuId::get)
                        ?: theme.animeId?.let(animeMap::get)
                        ?: entry.animeMetadata?.takeIf { allowPersistedMetadata }?.toEntity(),
                    modeDescriptor = themeModes[theme.id],
                    remoteModeDescriptor = entry.modeMetadata?.takeIf { allowPersistedMetadata }?.toEntity(),
                    roomModeDescriptorBaseline = entry.roomModeBaselineMetadata?.takeIf { allowPersistedMetadata }?.toEntity(),
                    serverPreference = effectivePreference
                )
            }
            PlayableKind.SONG -> (songs[itemId] ?: entry.songMetadata?.takeIf { allowPersistedMetadata }?.toEntity())?.let { song ->
                PlayableItem.RelatedSong(
                    song = song,
                    release = entry.releaseId?.let(releases::get)
                        ?: entry.releaseMetadata?.takeIf { allowPersistedMetadata }?.toEntity(),
                    anime = entry.animeKitsuId?.let(animeByKitsuId::get)
                        ?: entry.animeMetadata?.takeIf { allowPersistedMetadata }?.toEntity(),
                    relationshipType = entry.relationshipType,
                    localFilePath = entry.localFilePath.takeIf { allowPersistedMetadata }
                )
            }
        } ?: return null
        fun playbackMode(value: String?): PlaybackMode? = value
            ?.let { raw -> PlaybackMode.entries.firstOrNull { it.name == raw } }
        return QueueEntry(
            queueId = queueId,
            item = item,
            baseModePolicy = policy,
            desiredMode = playbackMode(entry.desiredMode),
            lastActualMode = playbackMode(entry.lastActualMode),
            manualMode = playbackMode(entry.manualMode),
            modeSeedSequence = entry.modeSeedSequence,
            replayRequested = entry.replayRequested,
            isUnskipped = entry.isUnskipped || entry.queueId in persisted.unskippedEntryIds
        )
    }

    fun mapPersistedEntries(entries: List<PersistedQueueEntry>): List<QueueEntry> =
        entries.mapNotNull(::mapPersistedEntry)

    fun newLegacyThemeEntry(themeId: Long): QueueEntry? = themes[themeId]?.let { theme ->
        QueueEntry(
            queueId = nextFallbackQueueId++,
            item = PlayableItem.Theme(
                theme,
                theme.animeId?.let(animeMap::get),
                themeModes[theme.id]
            )
        )
    }

    fun consumeLegacyThemes(ids: List<Long>, preferredEntries: List<QueueEntry>): List<QueueEntry> {
        val available = preferredEntries
            .mapNotNull { entry -> entry.themeOrNull?.id?.let { it to entry } }
            .groupBy({ it.first }, { it.second })
            .mapValues { (_, entries) -> entries.toMutableList() }
            .toMutableMap()
        return ids.mapNotNull { themeId ->
            available[themeId]?.removeFirstOrNull() ?: newLegacyThemeEntry(themeId)
        }
    }

    fun resolveLegacyEntryIds(ids: List<Long>, preferredEntries: List<QueueEntry>): List<Long> {
        val available = preferredEntries
            .mapNotNull { entry -> entry.themeOrNull?.id?.let { it to entry } }
            .groupBy({ it.first }, { it.second })
            .mapValues { (_, entries) -> entries.toMutableList() }
            .toMutableMap()
        return ids.mapNotNull { themeId -> available[themeId]?.removeFirstOrNull()?.queueId }
    }

    val originalQueueEntries = if (persisted.originalQueueEntries.isNotEmpty()) {
        mapPersistedEntries(persisted.originalQueueEntries)
    } else {
        consumeLegacyThemes(persisted.originalQueueIds, emptyList())
    }
    val nowPlayingEntries = if (persisted.nowPlayingEntries.isNotEmpty()) {
        mapPersistedEntries(persisted.nowPlayingEntries)
    } else {
        consumeLegacyThemes(persisted.nowPlayingIds, originalQueueEntries)
    }
    if (nowPlayingEntries.isEmpty()) return null
    val historyEntries = if (persisted.historyEntries.isNotEmpty()) {
        mapPersistedEntries(persisted.historyEntries)
    } else {
        consumeLegacyThemes(persisted.historyIds, nowPlayingEntries)
    }

    val preferredEntries = nowPlayingEntries + historyEntries + originalQueueEntries
    val validQueueIds = preferredEntries.mapTo(mutableSetOf()) { it.queueId }
    fun typedOrLegacyIds(typed: List<Long>, legacy: List<Long>): List<Long> =
        (if (typed.isNotEmpty()) typed else resolveLegacyEntryIds(legacy, preferredEntries))
            .filter { it in validQueueIds }

    val currentIndex = if (persisted.nowPlayingEntries.isNotEmpty()) {
        val raw = persisted.nowPlayingEntries
        val requested = persisted.currentIndex.coerceIn(0, raw.lastIndex)
        val candidateIndexes = (requested..raw.lastIndex) + (requested - 1 downTo 0)
        candidateIndexes.firstNotNullOfOrNull { rawIndex ->
            val queueId = raw[rawIndex].queueId
            nowPlayingEntries.indexOfFirst { it.queueId == queueId }.takeIf { it >= 0 }
        } ?: 0
    } else {
        val raw = persisted.nowPlayingIds
        if (raw.isEmpty()) 0 else {
            val requested = persisted.currentIndex.coerceIn(0, raw.lastIndex)
            raw.take(requested).count { it in themes }.coerceIn(0, nowPlayingEntries.lastIndex)
        }
    }

    val playedIndices = if (persisted.nowPlayingEntries.isNotEmpty()) {
        persisted.playedIndices.mapNotNull { oldIndex ->
            persisted.nowPlayingEntries.getOrNull(oldIndex)?.queueId?.let { queueId ->
                nowPlayingEntries.indexOfFirst { it.queueId == queueId }.takeIf { it >= 0 }
            }
        }.toSet()
    } else {
        persisted.playedIndices.filter { it in nowPlayingEntries.indices }.toSet()
    }

    return NowPlayingState(
        originalQueueEntries = originalQueueEntries,
        nowPlayingEntries = nowPlayingEntries,
        currentIndex = currentIndex,
        historyEntries = historyEntries,
        playNextEntryIds = typedOrLegacyIds(persisted.playNextEntryIds, persisted.playNextItemIds),
        addedToQueueEntryIds = typedOrLegacyIds(persisted.addedToQueueEntryIds, persisted.addedToQueueItemIds),
        suggestedEntryIds = typedOrLegacyIds(persisted.suggestedEntryIds, persisted.suggestedItemIds),
        playedIndices = playedIndices,
        isShuffled = persisted.isShuffled,
        contextLabel = persisted.contextLabel,
        animeMap = animeMap,
        queueVersion = persisted.queueVersion,
        playbackIntent = PlaybackIntent(
            sessionOverride = (persisted.queueDesiredMode ?: persisted.sessionAudioMode)
                ?.let { value -> PlaybackMode.entries.firstOrNull { it.name == value } }
                ?.takeIf { it != PlaybackMode.RELATED_AUDIO },
            manualOverride = persisted.queueDesiredModeManual,
            actionSequence = persisted.queueActionSequence,
            queueDesiredSequence = persisted.queueDesiredSequence,
            queueStarted = persisted.queueStarted || nowPlayingEntries.isNotEmpty()
        ),
        unskippedEntryIds = persisted.unskippedEntryIds +
            (originalQueueEntries + nowPlayingEntries + historyEntries)
                .filter { it.isUnskipped }
                .mapTo(mutableSetOf()) { it.queueId },
        isFullReload = true
    ).withUniqueHistoryEntries()
}

private fun PersistedThemeMetadata.toEntity() = ThemeEntity(
    id, animeId, title, artistName, audioUrl, videoUrl, isDownloaded, localFilePath, themeType, source
)

private fun PersistedSongMetadata.toEntity() = SongEntity(
    id, title, artistCredit, durationSeconds, audioUrl, fileSize,
    titleEnglish, titleRomaji, titleJapanese, artistNamesJson, loudness?.toEntity()
)

private fun PersistedReleaseMetadata.toEntity() = MusicReleaseEntity(
    id, title, artistCredit, releaseDate, year, artworkUrl,
    titleEnglish, titleRomaji, titleJapanese, artistNamesJson
)

private fun PersistedAnimeMetadata.toEntity() = AnimeEntity(
    kitsuId, animeThemesId, title, titleEn, titleRomaji, titleJa,
    thumbnailUrl, thumbnailUrlLarge, coverUrl, coverUrlLarge, syncedAt,
    isManuallyAdded, watchingStatus, subtype, startDate, endDate, episodeCount,
    ageRating, averageRating, userRating, libraryUpdatedAt, watchedAt, slug
)

private fun PersistedThemeModeMetadata.toEntity() = ThemeModeEntity(
    themeId, tvSizeUrl, tvSizeDurationSeconds, tvSizeFileSize, fullSizeSongId,
    fullSizeUrl, fullSizeDurationSeconds, fullSizeFileSize, fullSizeSourceReleaseId,
    videoUrl, videoMimeType, videoSpoiler, videoNsfw, videoEntryVersion,
    tvSizeLoudness?.toEntity(), fullSizeLoudness?.toEntity()
)

private fun PersistedLoudnessMetadata.toEntity() = LoudnessProfile(
    integratedLufs, truePeakDbtp, loudnessRangeLu, gainDb, policyVersion, state
)

private fun PlaybackMode.isAudioMode(): Boolean =
    this == PlaybackMode.TV_SIZE || this == PlaybackMode.FULL_SIZE
