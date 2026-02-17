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
     */
    fun play(
        contextLabel: String,
        themes: List<ThemeEntity>,
        startIndex: Int = 0,
        shuffle: Boolean = false,
        animeMap: Map<Long, AnimeEntity> = emptyMap()
    ) {
        if (themes.isEmpty()) return

        val safeStart = startIndex.coerceIn(0, themes.lastIndex)
        val currentTheme = themes[safeStart]

        val nowPlaying = if (shuffle) {
            // Current song first, then shuffle the rest
            val others = themes.toMutableList().apply { removeAt(safeStart) }.shuffled()
            listOf(currentTheme) + others
        } else {
            // Rotate list so startIndex becomes 0
            themes.subList(safeStart, themes.size) + themes.subList(0, safeStart)
        }

        _state.value = NowPlayingState(
            originalQueue = themes,
            nowPlaying = nowPlaying,
            currentIndex = 0,
            history = emptyList(),
            playNextItems = emptyList(),
            addedToQueueItems = emptyList(),
            isShuffled = shuffle,
            contextLabel = contextLabel,
            animeMap = animeMap,
            queueVersion = _state.value.queueVersion + 1,
            isFullReload = true
        )
    }

    /**
     * Insert song(s) immediately after the current track (LIFO stacking).
     */
    fun playNext(themes: List<ThemeEntity>, animeMap: Map<Long, AnimeEntity> = emptyMap()) {
        val current = _state.value
        if (current.nowPlaying.isEmpty()) return

        // Insert right after current in the nowPlaying list
        val insertPos = current.currentIndex + 1
        val updated = current.nowPlaying.toMutableList().apply {
            addAll(insertPos, themes)
        }

        _state.value = current.copy(
            nowPlaying = updated,
            playNextItems = themes + current.playNextItems,
            animeMap = current.animeMap + animeMap,
            queueVersion = current.queueVersion + 1,
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
     */
    fun addToQueue(themes: List<ThemeEntity>, animeMap: Map<Long, AnimeEntity> = emptyMap()) {
        val current = _state.value
        if (current.nowPlaying.isEmpty()) return

        val updated = current.nowPlaying + themes

        _state.value = current.copy(
            nowPlaying = updated,
            addedToQueueItems = current.addedToQueueItems + themes,
            animeMap = current.animeMap + animeMap,
            queueVersion = current.queueVersion + 1,
            isFullReload = false
        )
    }

    /**
     * Convenience for single song.
     */
    fun addToQueue(theme: ThemeEntity, anime: AnimeEntity? = null): Unit =
        addToQueue(listOf(theme), anime?.let { a -> theme.animeId?.let { mapOf(it to a) } } ?: emptyMap())

    /**
     * Called when the media player transitions to a new track.
     * Updates currentIndex and history.
     */
    fun onTrackChanged(newIndex: Int) {
        val current = _state.value
        if (newIndex < 0 || newIndex >= current.nowPlaying.size) return

        val oldIndex = current.currentIndex
        val newHistory = if (newIndex > oldIndex && oldIndex >= 0 && oldIndex < current.nowPlaying.size) {
            // Moving forward — add skipped/played tracks to history
            current.history + current.nowPlaying.subList(oldIndex, newIndex)
        } else if (newIndex < oldIndex) {
            // Moving backward — trim history
            val rewindTrack = current.nowPlaying[newIndex]
            val histIdx = current.history.indexOfLast { it.id == rewindTrack.id }
            if (histIdx >= 0) current.history.subList(0, histIdx) else current.history
        } else {
            current.history
        }

        _state.value = current.copy(
            currentIndex = newIndex,
            history = newHistory
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

        _state.value = current.copy(
            currentIndex = index,
            history = newHistory,
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

        val rewindTrack = current.history[historyIndex]
        // Tracks from historyIndex onward go back to the front of the queue
        val restoredTracks = current.history.subList(historyIndex, current.history.size)
        val trimmedHistory = current.history.subList(0, historyIndex)

        val newNowPlaying = restoredTracks + current.nowPlaying.subList(current.currentIndex, current.nowPlaying.size)

        _state.value = current.copy(
            nowPlaying = newNowPlaying,
            currentIndex = 0,
            history = trimmedHistory,
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
            // Unshuffle: restore original order from current song
            unshuffle(current)
        } else {
            // Shuffle: shuffle remaining songs (not current, not playNext items)
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

        // Everything after current
        val upcoming = current.nowPlaying.subList(current.currentIndex + 1, current.nowPlaying.size).toMutableList()

        // Identify play-next items that should stay in position
        val playNextIds = current.playNextItems.map { it.id }.toSet()
        val playNextUpcoming = upcoming.filter { it.id in playNextIds }
        val shuffleable = upcoming.filter { it.id !in playNextIds }

        // Rebuild: current + playNext items + shuffled rest
        val newNowPlaying = current.nowPlaying.subList(0, current.currentIndex + 1) +
                playNextUpcoming + shuffleable.shuffled()

        _state.value = current.copy(
            nowPlaying = newNowPlaying,
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

        // Restore original order from current track
        val restored = current.originalQueue.subList(originalIdx, current.originalQueue.size) +
                current.originalQueue.subList(0, originalIdx)

        // Re-inject play-next items right after current
        val playNextIds = current.playNextItems.map { it.id }.toSet()
        // Find play-next items that are still upcoming (haven't been played)
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
