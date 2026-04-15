package com.takeya.animeongaku.media

import android.content.Context
import android.util.Log
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.ThemeDao
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
    val themeId: Long = 0L
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
    private val animeDao: AnimeDao
) {
    private val file = File(context.filesDir, "now_playing_state.json")
    private val adapter = moshi.adapter(PersistedNowPlayingState::class.java)
    private val mutex = Mutex()

    suspend fun save(state: NowPlayingState, positionMs: Long, repeatMode: Int) = withContext(Dispatchers.IO) {
        val persisted = PersistedNowPlayingState(
            originalQueueIds = state.originalQueueEntries.map { it.theme.id },
            nowPlayingIds = state.nowPlayingEntries.map { it.theme.id },
            currentIndex = state.currentIndex,
            historyIds = state.historyEntries.map { it.theme.id },
            playNextItemIds = state.playNextEntries.map { it.theme.id },
            addedToQueueItemIds = state.addedToQueueEntries.map { it.theme.id },
            suggestedItemIds = state.suggestedEntries.map { it.theme.id },
            originalQueueEntries = state.originalQueueEntries.map { PersistedQueueEntry(it.queueId, it.theme.id) },
            nowPlayingEntries = state.nowPlayingEntries.map { PersistedQueueEntry(it.queueId, it.theme.id) },
            historyEntries = state.historyEntries.map { PersistedQueueEntry(it.queueId, it.theme.id) },
            playNextEntryIds = state.playNextEntryIds,
            addedToQueueEntryIds = state.addedToQueueEntryIds,
            suggestedEntryIds = state.suggestedEntryIds,
            playedIndices = state.playedIndices,
            isShuffled = state.isShuffled,
            contextLabel = state.contextLabel,
            animeMapKeys = state.animeMap.keys.toList(),
            queueVersion = state.queueVersion,
            positionMs = positionMs,
            repeatMode = repeatMode
        )

        try {
            val json = adapter.toJson(persisted)
            mutex.withLock {
                file.writeText(json)
            }
            Log.d("NowPlayingPersistence", "Saved queue state, size: ${persisted.nowPlayingIds.size}")
        } catch (e: Exception) {
            Log.e("NowPlayingPersistence", "Failed to save queue state", e)
        }
    }

    suspend fun restore(): RestoredQueueState? = withContext(Dispatchers.IO) {
        try {
            val json = mutex.withLock {
                if (!file.exists()) return@withContext null
                file.readText()
            }
            val persisted = adapter.fromJson(json) ?: return@withContext null

            // Batch load all unique theme IDs
            val allThemeIds = buildSet {
                addAll(persisted.originalQueueIds)
                addAll(persisted.nowPlayingIds)
                addAll(persisted.historyIds)
                addAll(persisted.playNextItemIds)
                addAll(persisted.addedToQueueItemIds)
                addAll(persisted.suggestedItemIds)
                addAll(persisted.originalQueueEntries.map { it.themeId })
                addAll(persisted.nowPlayingEntries.map { it.themeId })
                addAll(persisted.historyEntries.map { it.themeId })
            }.toList()

            if (allThemeIds.isEmpty()) return@withContext null

            val themes = themeDao.getByIds(allThemeIds).associateBy { it.id }
            
            var nextFallbackQueueId = (
                persisted.originalQueueEntries +
                    persisted.nowPlayingEntries +
                    persisted.historyEntries
                ).maxOfOrNull { it.queueId }?.plus(1L) ?: 1L

            fun newFallbackEntry(themeId: Long): QueueEntry? =
                themes[themeId]?.let { theme ->
                    QueueEntry(queueId = nextFallbackQueueId++, theme = theme)
                }

            fun mapPersistedEntries(entries: List<PersistedQueueEntry>): List<QueueEntry> =
                entries.mapNotNull { persistedEntry ->
                    themes[persistedEntry.themeId]?.let { theme ->
                        QueueEntry(queueId = persistedEntry.queueId, theme = theme)
                    }
                }

            fun consumeByThemeId(ids: List<Long>, preferredEntries: List<QueueEntry>): List<QueueEntry> {
                val available = preferredEntries
                    .groupBy { it.theme.id }
                    .mapValues { (_, value) -> value.toMutableList() }
                    .toMutableMap()

                return ids.mapNotNull { themeId ->
                    val reused = available[themeId]?.removeFirstOrNull()
                    reused ?: newFallbackEntry(themeId)
                }
            }

            fun resolveEntryIds(legacyIds: List<Long>, preferredEntries: List<QueueEntry>): List<Long> {
                val available = preferredEntries
                    .groupBy { it.theme.id }
                    .mapValues { (_, value) -> value.toMutableList() }
                    .toMutableMap()

                return legacyIds.mapNotNull { themeId ->
                    available[themeId]?.removeFirstOrNull()?.queueId
                }
            }

            val originalQueueEntries = if (persisted.originalQueueEntries.isNotEmpty()) {
                mapPersistedEntries(persisted.originalQueueEntries)
            } else {
                consumeByThemeId(persisted.originalQueueIds, emptyList())
            }

            val nowPlayingEntries = if (persisted.nowPlayingEntries.isNotEmpty()) {
                mapPersistedEntries(persisted.nowPlayingEntries)
            } else {
                consumeByThemeId(persisted.nowPlayingIds, originalQueueEntries)
            }
            if (nowPlayingEntries.isEmpty()) return@withContext null // Everything deleted

            val historyEntries = if (persisted.historyEntries.isNotEmpty()) {
                mapPersistedEntries(persisted.historyEntries)
            } else {
                consumeByThemeId(persisted.historyIds, nowPlayingEntries)
            }

            val preferredQueueEntries = nowPlayingEntries + historyEntries + originalQueueEntries
            val playNextEntryIds = if (persisted.playNextEntryIds.isNotEmpty()) {
                persisted.playNextEntryIds
            } else {
                resolveEntryIds(persisted.playNextItemIds, preferredQueueEntries)
            }
            val addedToQueueEntryIds = if (persisted.addedToQueueEntryIds.isNotEmpty()) {
                persisted.addedToQueueEntryIds
            } else {
                resolveEntryIds(persisted.addedToQueueItemIds, preferredQueueEntries)
            }
            val suggestedEntryIds = if (persisted.suggestedEntryIds.isNotEmpty()) {
                persisted.suggestedEntryIds
            } else {
                resolveEntryIds(persisted.suggestedItemIds, preferredQueueEntries)
            }

            // Adjust currentIndex in case songs before it were deleted
            val safeIndex = persisted.currentIndex.coerceIn(0, nowPlayingEntries.lastIndex)

            // Load anime map
            val animeEntities = if (persisted.animeMapKeys.isNotEmpty()) {
                animeDao.getByAnimeThemesIds(persisted.animeMapKeys)
            } else emptyList()
            val animeMap = animeEntities.associateBy { it.animeThemesId!! }

            val restoredState = NowPlayingState(
                originalQueueEntries = originalQueueEntries,
                nowPlayingEntries = nowPlayingEntries,
                currentIndex = safeIndex,
                historyEntries = historyEntries,
                playNextEntryIds = playNextEntryIds,
                addedToQueueEntryIds = addedToQueueEntryIds,
                suggestedEntryIds = suggestedEntryIds,
                playedIndices = persisted.playedIndices.filter { it <= nowPlayingEntries.lastIndex }.toSet(),
                isShuffled = persisted.isShuffled,
                contextLabel = persisted.contextLabel,
                animeMap = animeMap,
                queueVersion = persisted.queueVersion,
                isFullReload = true
            )

            Log.d("NowPlayingPersistence", "Restored queue state, size: ${nowPlayingEntries.size}")
            RestoredQueueState(restoredState, persisted.positionMs, persisted.repeatMode)
        } catch (e: Exception) {
            Log.e("NowPlayingPersistence", "Failed to restore queue state", e)
            null
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        try {
            mutex.withLock {
                if (file.exists()) file.delete()
            }
        } catch (e: Exception) {
            Log.e("NowPlayingPersistence", "Failed to clear queue state", e)
        }
    }
}
