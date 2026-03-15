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
data class PersistedNowPlayingState(
    val originalQueueIds: List<Long>,
    val nowPlayingIds: List<Long>,
    val currentIndex: Int,
    val historyIds: List<Long>,
    val playNextItemIds: List<Long>,
    val addedToQueueItemIds: List<Long>,
    val suggestedItemIds: List<Long>,
    val playedIndices: Set<Int>,
    val isShuffled: Boolean,
    val contextLabel: String,
    val animeMapKeys: List<Long>,
    val queueVersion: Long,
    val positionMs: Long,
    val repeatMode: Int
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
            originalQueueIds = state.originalQueue.map { it.id },
            nowPlayingIds = state.nowPlaying.map { it.id },
            currentIndex = state.currentIndex,
            historyIds = state.history.map { it.id },
            playNextItemIds = state.playNextItems.map { it.id },
            addedToQueueItemIds = state.addedToQueueItems.map { it.id },
            suggestedItemIds = state.suggestedItems.map { it.id },
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
            }.toList()

            if (allThemeIds.isEmpty()) return@withContext null

            val themes = themeDao.getByIds(allThemeIds).associateBy { it.id }
            
            // Map IDs back to entities, dropping any that were deleted from DB
            fun mapThemes(ids: List<Long>) = ids.mapNotNull { themes[it] }
            
            val nowPlaying = mapThemes(persisted.nowPlayingIds)
            if (nowPlaying.isEmpty()) return@withContext null // Everything deleted

            val originalQueue = mapThemes(persisted.originalQueueIds)
            val history = mapThemes(persisted.historyIds)
            val playNextItems = mapThemes(persisted.playNextItemIds)
            val addedToQueueItems = mapThemes(persisted.addedToQueueItemIds)
            val suggestedItems = mapThemes(persisted.suggestedItemIds)

            // Adjust currentIndex in case songs before it were deleted
            val safeIndex = persisted.currentIndex.coerceIn(0, nowPlaying.lastIndex)

            // Load anime map
            val animeEntities = if (persisted.animeMapKeys.isNotEmpty()) {
                animeDao.getByAnimeThemesIds(persisted.animeMapKeys)
            } else emptyList()
            val animeMap = animeEntities.associateBy { it.animeThemesId!! }

            val restoredState = NowPlayingState(
                originalQueue = originalQueue,
                nowPlaying = nowPlaying,
                currentIndex = safeIndex,
                history = history,
                playNextItems = playNextItems,
                addedToQueueItems = addedToQueueItems,
                suggestedItems = suggestedItems,
                playedIndices = persisted.playedIndices.filter { it <= nowPlaying.lastIndex }.toSet(),
                isShuffled = persisted.isShuffled,
                contextLabel = persisted.contextLabel,
                animeMap = animeMap,
                queueVersion = persisted.queueVersion,
                isFullReload = true
            )

            Log.d("NowPlayingPersistence", "Restored queue state, size: ${nowPlaying.size}")
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
