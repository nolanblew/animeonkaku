package com.takeya.animeongaku.media

import androidx.compose.runtime.Stable
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NowPlayingManager @Inject constructor() {

    private val _state = MutableStateFlow(NowPlayingState())
    val state: StateFlow<NowPlayingState> = _state.asStateFlow()
    private var nextQueueEntryId: Long = 1L

    fun restoreState(state: NowPlayingState) {
        nextQueueEntryId = state.maxQueueEntryId + 1L
        _state.value = state.copy(isFullReload = true)
    }

    /**
     * Temporarily unskip a skipped song for this queue session.
     */
    fun unskip(index: Int) {
        val current = _state.value
        if (index < 0 || index >= current.nowPlaying.size) return
        
        _state.value = current.copy(
            unskippedIndices = current.unskippedIndices + index,
            queueVersion = current.queueVersion + 1,
            isFullReload = true
        )
    }

    /**
     * Start playback with a new context playlist.
     * @param contextLabel Display label, e.g. "Naruto", "Quick Picks"
     * @param themes Full list of songs from the context
     * @param startIndex Index of the song to start playing
     * @param shuffle Whether to shuffle the queue
     * @param animeMap Map of animeThemesId -> AnimeEntity for display metadata
     * @param suggestedFrom If non-null, items from this index onward (exclusive of startIndex)
     *   are treated as "suggested" and will be removed when the user explicitly adds to queue.
     */
    fun play(
        contextLabel: String,
        themes: List<ThemeEntity>,
        startIndex: Int = 0,
        shuffle: Boolean = false,
        animeMap: Map<Long, AnimeEntity> = emptyMap(),
        suggestedFrom: Int? = null
    ) {
        if (themes.isEmpty()) return

        val originalEntries = createQueueEntries(themes)
        val safeStart = if (shuffle && startIndex == 0 && themes.size > 1) {
            originalEntries.indices.random()
        } else {
            startIndex.coerceIn(0, originalEntries.lastIndex)
        }
        val currentEntry = originalEntries[safeStart]

        // Only queue from startIndex onward (no wrapping earlier songs to end)
        val queueFromStart = originalEntries.subList(if (shuffle) 0 else safeStart, originalEntries.size)

        val nowPlayingEntries = if (shuffle) {
            val others = queueFromStart.filterIndexed { index, _ -> index != safeStart }.shuffled()
            listOf(currentEntry) + others
        } else {
            queueFromStart
        }

        // Track which items are "suggested" (auto-added, not user-chosen)
        val suggestedEntryIds = if (suggestedFrom != null && !shuffle) {
            // suggestedFrom is relative to the original themes list;
            // in nowPlayingEntries, the tapped song is at index 0, so suggested starts
            // at (suggestedFrom - safeStart) but we only care about items after the tapped one
            val suggestedStartInQueue = (suggestedFrom - safeStart).coerceAtLeast(1)
            if (suggestedStartInQueue < nowPlayingEntries.size) {
                nowPlayingEntries.subList(suggestedStartInQueue, nowPlayingEntries.size).map { it.queueId }
            } else {
                emptyList()
            }
        } else {
            emptyList()
        }

        _state.value = NowPlayingState(
            originalQueueEntries = originalEntries,
            nowPlayingEntries = nowPlayingEntries,
            currentIndex = 0,
            historyEntries = emptyList(),
            playNextEntryIds = emptyList(),
            addedToQueueEntryIds = emptyList(),
            suggestedEntryIds = suggestedEntryIds,
            playedIndices = setOf(0),
            isShuffled = shuffle,
            contextLabel = contextLabel,
            animeMap = animeMap,
            queueVersion = _state.value.queueVersion + 1,
            isFullReload = true
        )
    }

    /**
     * Insert song(s) immediately after the current track (LIFO stacking).
     * Clears any suggested items from the queue.
     */
    fun playNext(themes: List<ThemeEntity>, animeMap: Map<Long, AnimeEntity> = emptyMap()) {
        if (themes.isEmpty()) return

        val current = _state.value
        val insertedEntries = createQueueEntries(themes)
        if (current.nowPlayingEntries.isEmpty()) {
            _state.value = createStandaloneQueueState(
                contextLabel = current.contextLabel.ifBlank { "Queue" },
                entries = insertedEntries,
                animeMap = current.animeMap + animeMap
            )
            return
        }

        val queueAfterSuggestionRemoval = removeSuggestedItems(current)

        val insertPos = queueAfterSuggestionRemoval.currentIndex + 1
        val updated = queueAfterSuggestionRemoval.nowPlayingEntries.toMutableList().apply {
            addAll(insertPos, insertedEntries)
        }

        _state.value = queueAfterSuggestionRemoval.copy(
            nowPlayingEntries = updated,
            playNextEntryIds = insertedEntries.map { it.queueId } + queueAfterSuggestionRemoval.playNextEntryIds,
            suggestedEntryIds = emptyList(),
            animeMap = queueAfterSuggestionRemoval.animeMap + animeMap,
            queueVersion = queueAfterSuggestionRemoval.queueVersion + 1,
            isFullReload = false
        )
    }

    /**
     * Convenience for single song.
     */
    fun playNext(theme: ThemeEntity, anime: AnimeEntity? = null): Unit =
        playNext(listOf(theme), anime?.let { a -> theme.animeId?.let { mapOf(it to a) } } ?: emptyMap())

    /**
     * Append song(s) to the end of the queue.
     * Clears any suggested items from the queue.
     */
    fun addToQueue(themes: List<ThemeEntity>, animeMap: Map<Long, AnimeEntity> = emptyMap()) {
        if (themes.isEmpty()) return

        val current = _state.value
        val appendedEntries = createQueueEntries(themes)
        if (current.nowPlayingEntries.isEmpty()) {
            _state.value = createStandaloneQueueState(
                contextLabel = current.contextLabel.ifBlank { "Queue" },
                entries = appendedEntries,
                animeMap = current.animeMap + animeMap
            )
            return
        }

        val queueAfterSuggestionRemoval = removeSuggestedItems(current)

        val updated = queueAfterSuggestionRemoval.nowPlayingEntries + appendedEntries

        _state.value = queueAfterSuggestionRemoval.copy(
            nowPlayingEntries = updated,
            addedToQueueEntryIds = queueAfterSuggestionRemoval.addedToQueueEntryIds + appendedEntries.map { it.queueId },
            suggestedEntryIds = emptyList(),
            animeMap = queueAfterSuggestionRemoval.animeMap + animeMap,
            queueVersion = queueAfterSuggestionRemoval.queueVersion + 1,
            isFullReload = false
        )
    }

    /**
     * Convenience for single song.
     */
    fun addToQueue(theme: ThemeEntity, anime: AnimeEntity? = null): Unit =
        addToQueue(listOf(theme), anime?.let { a -> theme.animeId?.let { mapOf(it to a) } } ?: emptyMap())

    /**
     * Remove suggested items from the queue, preserving current index.
     */
    private fun removeSuggestedItems(current: NowPlayingState): NowPlayingState {
        if (current.suggestedEntryIds.isEmpty()) return current

        val suggestedIds = current.suggestedEntryIds.toSet()
        val updatedQueue = current.nowPlayingEntries.filterIndexed { index, entry ->
            index <= current.currentIndex || entry.queueId !in suggestedIds
        }

        return current.copy(
            nowPlayingEntries = updatedQueue,
            currentIndex = current.currentIndex.coerceAtMost(updatedQueue.lastIndex.coerceAtLeast(0)),
            suggestedEntryIds = emptyList()
        )
    }

    /**
     * Called when the media player transitions to a new track.
     * Updates currentIndex, history, and playedIndices using the queue entry id.
     */
    fun onTrackChangedByQueueId(queueId: Long) {
        val current = _state.value
        val expectedNextIndex = current.currentIndex + 1
        val newIndex = if (
            expectedNextIndex < current.nowPlayingEntries.size &&
            current.nowPlayingEntries[expectedNextIndex].queueId == queueId
        ) {
            expectedNextIndex
        } else {
            // Find the closest index forward, or any index
            var found = -1
            for (i in expectedNextIndex until current.nowPlayingEntries.size) {
                if (current.nowPlayingEntries[i].queueId == queueId) {
                    found = i
                    break
                }
            }
            if (found == -1) {
                current.nowPlayingEntries.indexOfFirst { it.queueId == queueId }
            } else found
        }

        if (newIndex < 0 || newIndex >= current.nowPlayingEntries.size) return

        val oldIndex = current.currentIndex
        val newHistory = if (newIndex > oldIndex && oldIndex >= 0 && oldIndex < current.nowPlayingEntries.size) {
            current.historyEntries + current.nowPlayingEntries.subList(oldIndex, newIndex)
        } else if (newIndex < oldIndex) {
            val rewindTrack = current.nowPlayingEntries[newIndex]
            val histIdx = current.historyEntries.indexOfLast { it.queueId == rewindTrack.queueId }
            if (histIdx >= 0) current.historyEntries.subList(0, histIdx) else current.historyEntries
        } else {
            current.historyEntries
        }

        _state.value = current.copy(
            currentIndex = newIndex,
            historyEntries = newHistory,
            playedIndices = current.playedIndices + newIndex
        )
    }

    fun onTrackChangedByThemeId(themeId: Long) {
        val current = _state.value
        val expectedNextIndex = current.currentIndex + 1
        val expectedEntry = current.nowPlayingEntries.getOrNull(expectedNextIndex)
        if (expectedEntry?.theme?.id == themeId) {
            onTrackChangedByQueueId(expectedEntry.queueId)
            return
        }

        val fallbackEntry = current.nowPlayingEntries.firstOrNull { it.theme.id == themeId } ?: return
        onTrackChangedByQueueId(fallbackEntry.queueId)
    }

    /**
     * Skip to a specific track in the queue by index.
     */
    fun skipTo(index: Int) {
        val current = _state.value
        if (index < 0 || index >= current.nowPlayingEntries.size) return

        val newHistory = if (index > current.currentIndex) {
            current.historyEntries + current.nowPlayingEntries.subList(current.currentIndex, index)
        } else {
            current.historyEntries
        }

        // Mark all skipped-over indices as played
        val skippedIndices = if (index > current.currentIndex) {
            (current.currentIndex until index).toSet()
        } else emptySet()

        _state.value = current.copy(
            currentIndex = index,
            historyEntries = newHistory,
            playedIndices = current.playedIndices + skippedIndices + index,
            queueVersion = current.queueVersion + 1,
            isFullReload = true
        )
    }

    /**
     * Move an item from one index to another in the queue.
     */
    fun moveItem(fromIndex: Int, toIndex: Int) {
        val current = _state.value
        if (fromIndex < 0 || fromIndex >= current.nowPlayingEntries.size) return
        if (toIndex < 0 || toIndex >= current.nowPlayingEntries.size) return
        if (fromIndex == toIndex) return

        val updated = current.nowPlayingEntries.toMutableList()
        val item = updated.removeAt(fromIndex)
        updated.add(toIndex, item)

        // Adjust currentIndex
        var newCurrentIndex = current.currentIndex
        if (fromIndex == current.currentIndex) {
            newCurrentIndex = toIndex
        } else if (fromIndex < current.currentIndex && toIndex >= current.currentIndex) {
            newCurrentIndex--
        } else if (fromIndex > current.currentIndex && toIndex <= current.currentIndex) {
            newCurrentIndex++
        }

        // Adjust playedIndices - simple approach: if we reorder, played indices might shift.
        // It's safer to just clear unskipped and update the version map.
        // For playedIndices, it's mostly used for shuffling, we can update it if needed.
        val newPlayedIndices = mutableSetOf<Int>()
        for (idx in current.playedIndices) {
            var newIdx = idx
            if (idx == fromIndex) {
                newIdx = toIndex
            } else if (idx > fromIndex && idx <= toIndex) {
                newIdx--
            } else if (idx < fromIndex && idx >= toIndex) {
                newIdx++
            }
            newPlayedIndices.add(newIdx)
        }

        val newUnskippedIndices = mutableSetOf<Int>()
        for (idx in current.unskippedIndices) {
            var newIdx = idx
            if (idx == fromIndex) {
                newIdx = toIndex
            } else if (idx > fromIndex && idx <= toIndex) {
                newIdx--
            } else if (idx < fromIndex && idx >= toIndex) {
                newIdx++
            }
            newUnskippedIndices.add(newIdx)
        }

        _state.value = current.copy(
            nowPlayingEntries = updated,
            currentIndex = newCurrentIndex,
            playedIndices = newPlayedIndices,
            unskippedIndices = newUnskippedIndices,
            queueVersion = current.queueVersion + 1,
            isFullReload = false
        )
    }

    /**
     * Remove an item from the queue at the specified index.
     */
    fun removeFromQueue(index: Int) {
        val current = _state.value
        if (index < 0 || index >= current.nowPlayingEntries.size) return
        
        // Cannot remove the currently playing item this way
        if (index == current.currentIndex) {
            // Ideally we'd skip to next then remove, but for now just don't allow it
            return
        }

        val removedEntry = current.nowPlayingEntries[index]
        val updated = current.nowPlayingEntries.toMutableList()
        updated.removeAt(index)

        var newCurrentIndex = current.currentIndex
        if (index < current.currentIndex) {
            newCurrentIndex--
        }

        val newPlayedIndices = mutableSetOf<Int>()
        for (idx in current.playedIndices) {
            if (idx == index) continue
            val newIdx = if (idx > index) idx - 1 else idx
            newPlayedIndices.add(newIdx)
        }

        val newUnskippedIndices = mutableSetOf<Int>()
        for (idx in current.unskippedIndices) {
            if (idx == index) continue
            val newIdx = if (idx > index) idx - 1 else idx
            newUnskippedIndices.add(newIdx)
        }

        _state.value = current.copy(
            nowPlayingEntries = updated,
            currentIndex = newCurrentIndex,
            historyEntries = current.historyEntries.filter { it.queueId != removedEntry.queueId },
            playNextEntryIds = current.playNextEntryIds.filter { it != removedEntry.queueId },
            addedToQueueEntryIds = current.addedToQueueEntryIds.filter { it != removedEntry.queueId },
            suggestedEntryIds = current.suggestedEntryIds.filter { it != removedEntry.queueId },
            playedIndices = newPlayedIndices,
            unskippedIndices = newUnskippedIndices,
            queueVersion = current.queueVersion + 1,
            isFullReload = true
        )
    }

    /**
     * Moves an item to be the next song to play.
     */
    fun moveToPlayNext(index: Int) {
        val current = _state.value
        if (index < 0 || index >= current.nowPlayingEntries.size) return
        if (index == current.currentIndex) return

        val entryId = current.nowPlayingEntries[index].queueId

        val targetIndex = if (index > current.currentIndex) current.currentIndex + 1 else current.currentIndex

        moveItem(index, targetIndex)
        val updated = _state.value
        _state.value = updated.copy(
            playNextEntryIds = listOf(entryId) + updated.playNextEntryIds.filter { it != entryId }
        )
    }

    /**
     * Rewind to a previously played track from history.
     */
    fun rewindTo(historyIndex: Int) {
        val current = _state.value
        if (historyIndex < 0 || historyIndex >= current.historyEntries.size) return

        val restoredTracks = current.historyEntries.subList(historyIndex, current.historyEntries.size)
        val trimmedHistory = current.historyEntries.subList(0, historyIndex)

        val newNowPlaying = restoredTracks + current.nowPlayingEntries.subList(current.currentIndex, current.nowPlayingEntries.size)

        _state.value = current.copy(
            nowPlayingEntries = newNowPlaying,
            currentIndex = 0,
            historyEntries = trimmedHistory,
            playedIndices = setOf(0),
            unskippedIndices = emptySet(),
            queueVersion = current.queueVersion + 1,
            isFullReload = true
        )
    }

    /**
     * Toggle shuffle on/off.
     */
    fun toggleShuffle() {
        val current = _state.value
        if (current.nowPlaying.isEmpty()) return

        if (current.isShuffled) {
            unshuffle(current)
        } else {
            shuffle(current)
        }
    }

    /**
     * Explicitly set shuffle mode (used by Shuffle button on pages).
     */
    fun setShuffled(shuffled: Boolean) {
        val current = _state.value
        if (current.isShuffled == shuffled) return
        toggleShuffle()
    }

    private fun shuffle(current: NowPlayingState) {
        val currentEntry = current.currentEntry ?: return

        // Collect all unplayed items from the current queue (excluding current track)
        val unplayed = mutableListOf<QueueEntry>()
        for ((i, entry) in current.nowPlayingEntries.withIndex()) {
            if (i == current.currentIndex) continue
            if (i !in current.playedIndices) {
                unplayed.add(entry)
            }
        }

        // Also pull in songs from originalQueue that were never in nowPlaying
        // (e.g., songs before the start index that were excluded by play()).
        val nowPlayingIds = current.nowPlayingEntries.map { it.queueId }.toSet()
        for (entry in current.originalQueueEntries) {
            if (entry.queueId !in nowPlayingIds) {
                unplayed.add(entry)
            }
        }

        // Identify play-next items that should stay right after current
        val playNextIds = current.playNextEntryIds.toSet()
        val playNextUnplayed = unplayed.filter { it.queueId in playNextIds }
        val shuffleable = unplayed.filter { it.queueId !in playNextIds }

        // Rebuild: current + playNext items + shuffled unplayed
        val newNowPlaying = listOf(currentEntry) + playNextUnplayed + shuffleable.shuffled()

        _state.value = current.copy(
            nowPlayingEntries = newNowPlaying,
            currentIndex = 0,
            playedIndices = setOf(0),
            isShuffled = true,
            queueVersion = current.queueVersion + 1,
            isFullReload = false
        )
    }

    private fun unshuffle(current: NowPlayingState) {
        val currentEntry = current.currentEntry ?: return

        // Find where the current track is in the original queue
        val originalIdx = current.originalQueueEntries.indexOfFirst { it.queueId == currentEntry.queueId }
            .takeIf { it >= 0 }
            ?: current.originalQueueEntries.indexOfFirst { it.theme.id == currentEntry.theme.id }.takeIf { it >= 0 }

        // Only restore songs from current onward in original order (no wrapping)
        val restored = if (originalIdx != null) {
            current.originalQueueEntries.subList(originalIdx, current.originalQueueEntries.size)
        } else {
            emptyList()
        }

        // Re-inject play-next items right after current
        val playNextIds = current.playNextEntryIds.toSet()
        val upcomingPlayNext = current.nowPlayingEntries
            .subList((current.currentIndex + 1).coerceAtMost(current.nowPlayingEntries.size), current.nowPlayingEntries.size)
            .filter { it.queueId in playNextIds }

        val restoredUpcoming = when {
            restored.isEmpty() -> emptyList()
            restored.first().queueId == currentEntry.queueId -> restored.drop(1)
            else -> restored
        }.filter { it.queueId !in playNextIds }

        // Add any "add to queue" items to the end, including copies of songs already in the
        // original context. Queue-entry identity keeps these independent.
        val appendedEntryIds = (upcomingPlayNext + restoredUpcoming + listOf(currentEntry)).map { it.queueId }.toSet()
        val extraItems = current.addedToQueueEntries.filter { it.queueId !in appendedEntryIds }

        val newNowPlaying = listOf(currentEntry) + upcomingPlayNext + restoredUpcoming + extraItems

        _state.value = current.copy(
            nowPlayingEntries = newNowPlaying,
            currentIndex = 0,
            playedIndices = setOf(0),
            isShuffled = false,
            queueVersion = current.queueVersion + 1,
            isFullReload = false
        )
    }

    val currentTheme: ThemeEntity?
        get() = _state.value.let { s -> s.nowPlaying.getOrNull(s.currentIndex) }

    val isActive: Boolean
        get() = _state.value.nowPlayingEntries.isNotEmpty()

    private fun createQueueEntries(themes: List<ThemeEntity>): List<QueueEntry> =
        themes.map { theme ->
            QueueEntry(queueId = nextQueueEntryId++, theme = theme)
        }

    private fun createStandaloneQueueState(
        contextLabel: String,
        entries: List<QueueEntry>,
        animeMap: Map<Long, AnimeEntity>
    ): NowPlayingState = NowPlayingState(
        originalQueueEntries = entries,
        nowPlayingEntries = entries,
        currentIndex = 0,
        historyEntries = emptyList(),
        playNextEntryIds = emptyList(),
        addedToQueueEntryIds = emptyList(),
        suggestedEntryIds = emptyList(),
        playedIndices = setOf(0),
        isShuffled = false,
        contextLabel = contextLabel,
        animeMap = animeMap,
        queueVersion = _state.value.queueVersion + 1,
        isFullReload = true
    )
}

@Stable
data class QueueEntry(
    val queueId: Long,
    val theme: ThemeEntity
)

@Stable
data class NowPlayingState(
    val originalQueueEntries: List<QueueEntry> = emptyList(),
    val nowPlayingEntries: List<QueueEntry> = emptyList(),
    val currentIndex: Int = 0,
    val historyEntries: List<QueueEntry> = emptyList(),
    val playNextEntryIds: List<Long> = emptyList(),
    val addedToQueueEntryIds: List<Long> = emptyList(),
    val suggestedEntryIds: List<Long> = emptyList(),
    val playedIndices: Set<Int> = emptySet(),
    val isShuffled: Boolean = false,
    val contextLabel: String = "",
    val animeMap: Map<Long, AnimeEntity> = emptyMap(),
    val queueVersion: Long = 0,
    val isFullReload: Boolean = true,
    val unskippedIndices: Set<Int> = emptySet()
) {
    private val entriesById: Map<Long, QueueEntry> by lazy {
        buildMap {
            originalQueueEntries.forEach { put(it.queueId, it) }
            nowPlayingEntries.forEach { put(it.queueId, it) }
            historyEntries.forEach { put(it.queueId, it) }
        }
    }

    val originalQueue: List<ThemeEntity> by lazy { originalQueueEntries.map { it.theme } }
    val nowPlaying: List<ThemeEntity> by lazy { nowPlayingEntries.map { it.theme } }
    val history: List<ThemeEntity> by lazy { historyEntries.map { it.theme } }
    val playNextEntries: List<QueueEntry> by lazy { playNextEntryIds.mapNotNull(entriesById::get) }
    val playNextItems: List<ThemeEntity> by lazy { playNextEntries.map { it.theme } }
    val addedToQueueEntries: List<QueueEntry> by lazy { addedToQueueEntryIds.mapNotNull(entriesById::get) }
    val addedToQueueItems: List<ThemeEntity> by lazy { addedToQueueEntries.map { it.theme } }
    val suggestedEntries: List<QueueEntry> by lazy { suggestedEntryIds.mapNotNull(entriesById::get) }
    val suggestedItems: List<ThemeEntity> by lazy { suggestedEntries.map { it.theme } }
    val currentEntry: QueueEntry?
        get() = nowPlayingEntries.getOrNull(currentIndex)
    val currentTheme: ThemeEntity?
        get() = currentEntry?.theme

    val upcomingEntries: List<QueueEntry> by lazy {
        if (currentIndex + 1 < nowPlayingEntries.size) {
            nowPlayingEntries.subList(currentIndex + 1, nowPlayingEntries.size)
        } else {
            emptyList()
        }
    }

    val upcomingTracks: List<ThemeEntity> by lazy {
        if (currentIndex + 1 < nowPlayingEntries.size) {
            upcomingEntries.map { it.theme }
        } else {
            emptyList()
        }
    }

    val maxQueueEntryId: Long by lazy {
        (originalQueueEntries + nowPlayingEntries + historyEntries).maxOfOrNull { it.queueId } ?: 0L
    }

    fun indexOfQueueId(queueId: Long): Int = nowPlayingEntries.indexOfFirst { it.queueId == queueId }
}
