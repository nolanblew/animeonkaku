package com.takeya.animeongaku.media

import android.content.Context
import android.util.Log
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.MusicCatalogDao
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
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
    val playlistDefaultMode: String? = null
)

@JsonClass(generateAdapter = true)
data class PersistedNowPlayingState(
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
    val repeatMode: Int = 0
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
    private val themeModeDao: ThemeModeDao
) {
    private val file = File(context.filesDir, "now_playing_state.json")
    private val adapter = moshi.adapter(PersistedNowPlayingState::class.java)
    private val mutex = Mutex()

    suspend fun save(state: NowPlayingState, positionMs: Long, repeatMode: Int): Boolean = withContext(Dispatchers.IO) {
        val persisted = state.toPersistedState(positionMs, repeatMode)

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

            val restoredState = restorePersistedQueueState(
                persisted,
                themes,
                songs,
                releases,
                animeByKitsuId,
                animeMap,
                themeModes
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
}

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
    originalQueueEntries = originalQueueEntries.map(QueueEntry::toPersistedEntry),
    nowPlayingEntries = nowPlayingEntries.map(QueueEntry::toPersistedEntry),
    historyEntries = historyEntries.map(QueueEntry::toPersistedEntry),
    playNextEntryIds = playNextEntryIds,
    addedToQueueEntryIds = addedToQueueEntryIds,
    suggestedEntryIds = suggestedEntryIds,
    playedIndices = playedIndices,
    isShuffled = isShuffled,
    contextLabel = contextLabel,
    animeMapKeys = animeMap.keys.toList(),
    queueVersion = queueVersion,
    positionMs = positionMs,
    repeatMode = repeatMode
)

private fun QueueEntry.toPersistedEntry(): PersistedQueueEntry = when (val playable = item) {
    is PlayableItem.Theme -> PersistedQueueEntry(
        queueId = queueId,
        themeId = playable.theme.id,
        itemType = PlayableKind.THEME.name,
        itemId = playable.theme.id,
        animeKitsuId = playable.anime?.kitsuId,
        baseMode = baseModePolicy.requestedMode,
        playlistDefaultMode = baseModePolicy.playlistDefault?.name
    )
    is PlayableItem.RelatedSong -> PersistedQueueEntry(
        queueId = queueId,
        itemType = PlayableKind.SONG.name,
        itemId = playable.song.id,
        releaseId = playable.release?.id,
        animeKitsuId = playable.anime?.kitsuId,
        relationshipType = playable.relationshipType,
        baseMode = baseModePolicy.requestedMode,
        playlistDefaultMode = baseModePolicy.playlistDefault?.name
    )
}

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
    themeModes: Map<Long, ThemeModeEntity> = emptyMap()
): NowPlayingState? {
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
            }?.takeIf { it == PlaybackMode.TV_SIZE || it == PlaybackMode.FULL_SIZE }
        )
        val kind = entry.itemType?.uppercase()?.let { value ->
            PlayableKind.entries.firstOrNull { it.name == value }
        } ?: PlayableKind.THEME
        val itemId = entry.itemId ?: entry.themeId.takeIf { it > 0 } ?: return null
        val item = when (kind) {
            PlayableKind.THEME -> themes[itemId]?.let { theme ->
                PlayableItem.Theme(
                    theme = theme,
                    anime = entry.animeKitsuId?.let(animeByKitsuId::get)
                        ?: theme.animeId?.let(animeMap::get),
                    modeDescriptor = themeModes[theme.id]
                )
            }
            PlayableKind.SONG -> songs[itemId]?.let { song ->
                PlayableItem.RelatedSong(
                    song = song,
                    release = entry.releaseId?.let(releases::get),
                    anime = entry.animeKitsuId?.let(animeByKitsuId::get),
                    relationshipType = entry.relationshipType
                )
            }
        } ?: return null
        return QueueEntry(queueId, item, policy)
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
        isFullReload = true
    ).withUniqueHistoryEntries()
}
