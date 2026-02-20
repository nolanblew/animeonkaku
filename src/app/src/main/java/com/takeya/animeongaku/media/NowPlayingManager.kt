package com.takeya.animeongaku.media

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

        val safeStart = startIndex.coerceIn(0, themes.lastIndex)
        val currentTheme = themes[safeStart]

        // Only queue from startIndex onward (no wrapping earlier songs to end)
        val queueFromStart = themes.subList(safeStart, themes.size)

        val nowPlaying = if (shuffle) {
            val others = queueFromStart.drop(1).shuffled()
            listOf(currentTheme) + others
        } else {
            queueFromStart
        }

        // Track which items are "suggested" (auto-added, not user-chosen)
        val suggestedItems = if (suggestedFrom != null && !shuffle) {
            // suggestedFrom is relative to the original themes list;
            // in nowPlaying, the tapped song is at index 0, so suggested starts
            // at (suggestedFrom - safeStart) but we only care about items after the tapped one
            val suggestedStartInQueue = (suggestedFrom - safeStart).coerceAtLeast(1)
            if (suggestedStartInQueue < nowPlaying.size) {
                nowPlaying.subList(suggestedStartInQueue, nowPlaying.size).toList()
            } else emptyList()
        } else emptyList()

        _state.value = NowPlayingState(
            originalQueue = themes,
            nowPlaying = nowPlaying,
            currentIndex = 0,
            history = emptyList(),
            playNextItems = emptyList(),
            addedToQueueItems = emptyList(),
            suggestedItems = suggestedItems,
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
        val current = _state.value
        if (current.nowPlaying.isEmpty()) return

        val queueAfterSuggestionRemoval = removeSuggestedItems(current)

        val insertPos = queueAfterSuggestionRemoval.currentIndex + 1
        val updated = queueAfterSuggestionRemoval.nowPlaying.toMutableList().apply {
            addAll(insertPos, themes)
        }

        _state.value = queueAfterSuggestionRemoval.copy(
            nowPlaying = updated,
            playNextItems = themes + queueAfterSuggestionRemoval.playNextItems,
            suggestedItems = emptyList(),
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
        val current = _state.value
        if (current.nowPlaying.isEmpty()) return

        val queueAfterSuggestionRemoval = removeSuggestedItems(current)

        val updated = queueAfterSuggestionRemoval.nowPlaying + themes

        _state.value = queueAfterSuggestionRemoval.copy(
            nowPlaying = updated,
            addedToQueueItems = queueAfterSuggestionRemoval.addedToQueueItems + themes,
            suggestedItems = emptyList(),
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
        if (current.suggestedItems.isEmpty()) return current

        // Build a set of suggested item identities (use list index pairs to handle duplicates)
        val suggestedIdentities = current.suggestedItems.toMutableList()
        val updatedQueue = mutableListOf<ThemeEntity>()
        var newCurrentIndex = current.currentIndex

        for ((i, theme) in current.nowPlaying.withIndex()) {
            val isSuggested = i > current.currentIndex && suggestedIdentities.remove(theme)
            if (isSuggested) {
                // Skip this item
            } else {
                updatedQueue.add(theme)
            }
        }

        return current.copy(
            nowPlaying = updatedQueue,
            currentIndex = newCurrentIndex.coerceAtMost(updatedQueue.lastIndex.coerceAtLeast(0)),
            suggestedItems = emptyList()
        )
    }

    /**
     * Called when the media player transitions to a new track.
     * Updates currentIndex, history, and playedIndices.
     */
    fun onTrackChanged(newIndex: Int) {
        val current = _state.value
        if (newIndex < 0 || newIndex >= current.nowPlaying.size) return

        val oldIndex = current.currentIndex
        val newHistory = if (newIndex > oldIndex && oldIndex >= 0 && oldIndex < current.nowPlaying.size) {
            current.history + current.nowPlaying.subList(oldIndex, newIndex)
        } else if (newIndex < oldIndex) {
            val rewindTrack = current.nowPlaying[newIndex]
            val histIdx = current.history.indexOfLast { it.id == rewindTrack.id }
            if (histIdx >= 0) current.history.subList(0, histIdx) else current.history
        } else {
            current.history
        }

        _state.value = current.copy(
            currentIndex = newIndex,
            history = newHistory,
            playedIndices = current.playedIndices + newIndex
        )
    }

    /**
     * Skip to a specific track in the queue by index.
     */
    fun skipTo(index: Int) {
        val current = _state.value
        if (index < 0 || index >= current.nowPlaying.size) return

        val newHistory = if (index > current.currentIndex) {
            current.history + current.nowPlaying.subList(current.currentIndex, index)
        } else {
            current.history
        }

        // Mark all skipped-over indices as played
        val skippedIndices = if (index > current.currentIndex) {
            (current.currentIndex until index).toSet()
        } else emptySet()

        _state.value = current.copy(
            currentIndex = index,
            history = newHistory,
            playedIndices = current.playedIndices + skippedIndices + index,
            queueVersion = current.queueVersion + 1,
            isFullReload = true
        )
    }

    /**
     * Rewind to a previously played track from history.
     */
    fun rewindTo(historyIndex: Int) {
        val current = _state.value
        if (historyIndex < 0 || historyIndex >= current.history.size) return

        val restoredTracks = current.history.subList(historyIndex, current.history.size)
        val trimmedHistory = current.history.subList(0, historyIndex)

        val newNowPlaying = restoredTracks + current.nowPlaying.subList(current.currentIndex, current.nowPlaying.size)

        _state.value = current.copy(
            nowPlaying = newNowPlaying,
            currentIndex = 0,
            history = trimmedHistory,
            playedIndices = setOf(0),
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
        val currentTheme = current.nowPlaying.getOrNull(current.currentIndex) ?: return

        // Collect all unplayed items from the current queue (excluding current track)
        val unplayed = mutableListOf<ThemeEntity>()
        for ((i, theme) in current.nowPlaying.withIndex()) {
            if (i == current.currentIndex) continue
            if (i !in current.playedIndices) {
                unplayed.add(theme)
            }
        }

        // Also pull in songs from originalQueue that were never in nowPlaying
        // (e.g., songs before the start index that were excluded by play()).
        // Use count-based matching to handle playlists with duplicate songs.
        val nowPlayingIdCounts = mutableMapOf<Long, Int>()
        for (theme in current.nowPlaying) {
            nowPlayingIdCounts[theme.id] = (nowPlayingIdCounts[theme.id] ?: 0) + 1
        }
        val remainingCounts = nowPlayingIdCounts.toMutableMap()
        for (theme in current.originalQueue) {
            val count = remainingCounts[theme.id] ?: 0
            if (count > 0) {
                remainingCounts[theme.id] = count - 1
            } else {
                unplayed.add(theme)
            }
        }

        // Identify play-next items that should stay right after current
        val playNextIds = current.playNextItems.map { it.id }.toSet()
        val playNextUnplayed = unplayed.filter { it.id in playNextIds }
        val shuffleable = unplayed.filter { it.id !in playNextIds }

        // Rebuild: current + playNext items + shuffled unplayed
        val newNowPlaying = listOf(currentTheme) + playNextUnplayed + shuffleable.shuffled()

        _state.value = current.copy(
            nowPlaying = newNowPlaying,
            currentIndex = 0,
            playedIndices = setOf(0),
            isShuffled = true,
            queueVersion = current.queueVersion + 1,
            isFullReload = false
        )
    }

    private fun unshuffle(current: NowPlayingState) {
        val currentTheme = current.nowPlaying.getOrNull(current.currentIndex) ?: return

        // Find where the current track is in the original queue
        val originalIdx = current.originalQueue.indexOfFirst { it.id == currentTheme.id }
        if (originalIdx == -1) return

        // Only restore songs from current onward in original order (no wrapping)
        val restored = current.originalQueue.subList(originalIdx, current.originalQueue.size)

        // Re-inject play-next items right after current
        val playNextIds = current.playNextItems.map { it.id }.toSet()
        val upcomingPlayNext = current.nowPlaying
            .subList((current.currentIndex + 1).coerceAtMost(current.nowPlaying.size), current.nowPlaying.size)
            .filter { it.id in playNextIds }

        // Add any "add to queue" items that aren't in the original to the end
        val originalIds = current.originalQueue.map { it.id }.toSet()
        val extraItems = current.addedToQueueItems.filter { it.id !in originalIds }

        val newNowPlaying = listOf(restored.first()) + upcomingPlayNext +
                restored.drop(1).filter { it.id !in playNextIds } + extraItems

        _state.value = current.copy(
            nowPlaying = newNowPlaying,
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
        get() = _state.value.nowPlaying.isNotEmpty()
}

data class NowPlayingState(
    val originalQueue: List<ThemeEntity> = emptyList(),
    val nowPlaying: List<ThemeEntity> = emptyList(),
    val currentIndex: Int = 0,
    val history: List<ThemeEntity> = emptyList(),
    val playNextItems: List<ThemeEntity> = emptyList(),
    val addedToQueueItems: List<ThemeEntity> = emptyList(),
    val suggestedItems: List<ThemeEntity> = emptyList(),
    val playedIndices: Set<Int> = emptySet(),
    val isShuffled: Boolean = false,
    val contextLabel: String = "",
    val animeMap: Map<Long, AnimeEntity> = emptyMap(),
    val queueVersion: Long = 0,
    val isFullReload: Boolean = true
) {
    val currentTheme: ThemeEntity?
        get() = nowPlaying.getOrNull(currentIndex)

    val upcomingTracks: List<ThemeEntity>
        get() = if (currentIndex + 1 < nowPlaying.size)
            nowPlaying.subList(currentIndex + 1, nowPlaying.size)
        else emptyList()
}
