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
class NowPlayingManager @Inject constructor(
    private val sessionStateManager: com.takeya.animeongaku.data.auth.SessionStateManager,
    private val playbackPreferences: PlaybackPreferences,
    private val offlineMediaAvailability: OfflineMediaAvailability
) {
    internal constructor(
        sessionStateManager: com.takeya.animeongaku.data.auth.SessionStateManager,
        playbackPreferences: PlaybackPreferences
    ) : this(sessionStateManager, playbackPreferences, OfflineMediaAvailability(emptySet()))

    private val _state = MutableStateFlow(
        NowPlayingState(
            playbackIntent = PlaybackIntent(
                rememberedAudioMode = playbackPreferences.rememberedAudioMode
            )
        )
    )
    val state: StateFlow<NowPlayingState> = _state.asStateFlow()
    private var nextQueueEntryId: Long = 1L

    fun restoreState(state: NowPlayingState) {
        val restoredBase = state.withUniqueHistoryEntries().copy(
            playbackIntent = PlaybackIntent(
                rememberedAudioMode = playbackPreferences.rememberedAudioMode,
                sessionOverride = state.playbackIntent.sessionOverride,
                manualOverride = state.playbackIntent.manualOverride,
                actionSequence = state.playbackIntent.actionSequence,
                queueDesiredSequence = state.playbackIntent.queueDesiredSequence,
                queueStarted = state.playbackIntent.queueStarted || state.nowPlayingEntries.isNotEmpty()
            )
        )
        // Persistence records the last actual source even when no explicit replay marker was
        // pending. The current occurrence must resume that source after process death before any
        // later preference action invalidates it.
        val restoredCurrentId = restoredBase.currentEntry?.queueId
        val restored = restoredCurrentId?.let { queueId ->
            restoredBase.updateOccurrence(queueId) { entry ->
                entry.copy(replayRequested = entry.lastActualMode != null)
            }
        } ?: restoredBase
        nextQueueEntryId = restored.maxQueueEntryId + 1L
        _state.value = restored.copy(isFullReload = true)
    }

    /**
     * Temporarily unskip a skipped song for this queue session.
     */
    fun unskip(index: Int) {
        val current = _state.value
        if (index < 0 || index >= current.nowPlayingEntries.size) return
        val queueId = current.nowPlayingEntries[index].queueId
        
        _state.value = current.updateOccurrence(queueId) { it.copy(isUnskipped = true) }.copy(
            unskippedEntryIds = current.unskippedEntryIds + queueId,
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
        playItems(
            contextLabel = contextLabel,
            items = themes.map { theme -> PlayableItem.Theme(theme, theme.animeId?.let(animeMap::get)) },
            startIndex = startIndex,
            shuffle = shuffle,
            animeMap = animeMap,
            suggestedFrom = suggestedFrom
        )
    }

    /** Single write boundary for a user's manual Theme-mode selection. */
    fun selectThemeMode(mode: PlaybackMode) {
        require(mode != PlaybackMode.RELATED_AUDIO) {
            "RELATED_AUDIO is resolver-owned and cannot be selected for a Theme session"
        }
        if (mode == PlaybackMode.TV_SIZE || mode == PlaybackMode.FULL_SIZE) {
            playbackPreferences.rememberAudioMode(mode)
        }
        val current = _state.value
        val intent = PlaybackIntent(
            rememberedAudioMode = playbackPreferences.rememberedAudioMode,
            sessionOverride = mode,
            manualOverride = true,
            actionSequence = current.playbackIntent.actionSequence + 1L,
            queueDesiredSequence = current.playbackIntent.actionSequence + 1L,
            queueStarted = current.playbackIntent.queueStarted
        )
        val currentQueueId = current.currentEntry?.queueId
        val updated = currentQueueId?.let { queueId ->
            current.updateOccurrence(queueId) {
                it.copy(
                    desiredMode = mode,
                    manualMode = mode,
                    modeSeedSequence = intent.actionSequence,
                    replayRequested = false,
                    isUnskipped = true
                )
            }
        } ?: current
        _state.value = updated.copy(
            playbackIntent = intent,
            unskippedEntryIds = currentQueueId?.let { current.unskippedEntryIds + it } ?: current.unskippedEntryIds,
            queueVersion = current.queueVersion + 1,
            modeSelectionGeneration = current.modeSelectionGeneration + 1,
            isFullReload = false
        )
    }

    fun clearThemeSessionOverride() {
        val current = _state.value
        val intent = PlaybackIntent(
            rememberedAudioMode = playbackPreferences.rememberedAudioMode,
            actionSequence = current.playbackIntent.actionSequence,
            queueDesiredSequence = current.playbackIntent.queueDesiredSequence,
            queueStarted = current.playbackIntent.queueStarted
        )
        if (current.playbackIntent == intent) return
        _state.value = current.copy(
            playbackIntent = intent,
            queueVersion = current.queueVersion + 1,
            isFullReload = false
        )
    }

    fun playItems(
        contextLabel: String,
        items: List<PlayableItem>,
        startIndex: Int = 0,
        shuffle: Boolean = false,
        animeMap: Map<Long, AnimeEntity> = emptyMap(),
        suggestedFrom: Int? = null,
        baseModePolicy: BaseModePolicy = BaseModePolicy.Inherit,
        initialSessionMode: PlaybackMode? = null,
        baseModePolicies: List<BaseModePolicy>? = null
    ) {
        require(initialSessionMode != PlaybackMode.RELATED_AUDIO) {
            "RELATED_AUDIO is resolver-owned and cannot be a Theme session override"
        }
        if (items.isEmpty()) return
        require(baseModePolicies == null || baseModePolicies.size == items.size) {
            "One base policy is required per source item"
        }

        // A replacement queue starts a fresh device-local mode lifetime. The old global
        // remembered audio preference is presentation history only and must not seed it.
        val admissionIntent = PlaybackIntent(
            rememberedAudioMode = _state.value.playbackIntent.rememberedAudioMode,
            sessionOverride = initialSessionMode
        )
        val playableWithSourceIndex = playableItemsWithSourceIndex(
            items = items,
            playbackIntent = admissionIntent
        ) { index -> baseModePolicies?.get(index) ?: baseModePolicy }
        val playable = playableWithSourceIndex.map { it.value }
        if (playable.isEmpty()) return

        val playablePolicies = baseModePolicies?.let { policies ->
            playableWithSourceIndex.map { policies[it.index] }
        }
        val initialActionSequence = when {
            initialSessionMode != null -> 1L
            playablePolicies?.any { it.hasSoftMode() } == true -> 1L
            else -> 0L
        }
        // A playlist default is the queue seed for a replacement queue. Entry-specific mode
        // overrides still travel on their own occurrences, while later appended entries can
        // carry a newer soft seed without rewriting this queue intent.
        val initialQueueMode = initialSessionMode
            ?: playablePolicies?.mapNotNull { it.playlistDefault }?.firstOrNull()
        val initialQueueDesiredSequence = initialQueueMode?.let {
            if (initialSessionMode != null) initialActionSequence else 0L
        } ?: 0L
        val originalEntries = playable.mapIndexed { index, item ->
            val policy = playablePolicies?.get(index) ?: baseModePolicy
            QueueEntry(
                queueId = nextQueueEntryId++,
                item = item,
                baseModePolicy = policy,
                modeSeedSequence = initialActionSequence.takeIf {
                    initialSessionMode == null && policy.hasSoftMode()
                } ?: 0L
            )
        }
        val sourceIndexes = playableWithSourceIndex.map { it.index }
        val requestedPlayableStart = sourceIndexes.indexOf(startIndex).takeIf { it >= 0 }
            ?: sourceIndexes.indexOfFirst { it > startIndex }.takeIf { it >= 0 }
            ?: originalEntries.lastIndex
        val safeStart = if (shuffle && startIndex == 0 && playable.size > 1) {
            originalEntries.indices.random()
        } else {
            requestedPlayableStart.coerceIn(0, originalEntries.lastIndex)
        }
        val currentEntry = originalEntries[safeStart]

        val nowPlayingEntries = if (shuffle) {
            val others = originalEntries.filterIndexed { index, _ -> index != safeStart }.shuffled()
            listOf(currentEntry) + others
        } else {
            originalEntries
        }

        // Track which items are "suggested" (auto-added, not user-chosen)
        val suggestedEntryIds = if (suggestedFrom != null && !shuffle) {
            val suggestedPlayableIndex = sourceIndexes.indexOfFirst { it >= suggestedFrom }
            val suggestedStartInQueue = suggestedPlayableIndex
                .takeIf { it >= 0 }
                ?.coerceAtLeast(safeStart + 1)
                ?: nowPlayingEntries.size
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
            currentIndex = if (shuffle) 0 else safeStart,
            historyEntries = if (shuffle) emptyList() else originalEntries.take(safeStart),
            playNextEntryIds = emptyList(),
            addedToQueueEntryIds = emptyList(),
            suggestedEntryIds = suggestedEntryIds,
            playedIndices = if (shuffle) setOf(0) else (0..safeStart).toSet(),
            isShuffled = shuffle,
            contextLabel = contextLabel,
            animeMap = animeMap,
            playbackIntent = PlaybackIntent(
                rememberedAudioMode = _state.value.playbackIntent.rememberedAudioMode,
                sessionOverride = initialQueueMode,
                actionSequence = initialActionSequence,
                queueDesiredSequence = initialQueueDesiredSequence,
                queueStarted = true
            ),
            queueVersion = _state.value.queueVersion + 1,
            playRequestGeneration = _state.value.playRequestGeneration + 1,
            isFullReload = true
        )
    }

    /**
     * Insert song(s) immediately after the current track (LIFO stacking).
     * Clears any suggested items from the queue.
     */
    fun playNext(themes: List<ThemeEntity>, animeMap: Map<Long, AnimeEntity> = emptyMap()) {
        playNextItems(
            themes.map { theme -> PlayableItem.Theme(theme, theme.animeId?.let(animeMap::get)) },
            animeMap
        )
    }

    fun playNextItems(
        items: List<PlayableItem>,
        animeMap: Map<Long, AnimeEntity> = emptyMap(),
        baseModePolicy: BaseModePolicy = BaseModePolicy.Inherit,
        baseModePolicies: List<BaseModePolicy>? = null
    ) {
        if (items.isEmpty()) return
        require(baseModePolicies == null || baseModePolicies.size == items.size)

        val current = _state.value
        val playable = playableItemsWithSourceIndex(items) { index ->
            baseModePolicies?.get(index) ?: baseModePolicy
        }
        if (playable.isEmpty()) return
        val insertionActionSequence = current.playbackIntent.actionSequence + 1L
        val insertedEntries = playable.map { indexed ->
            val policy = baseModePolicies?.get(indexed.index) ?: baseModePolicy
            QueueEntry(
                queueId = nextQueueEntryId++,
                item = indexed.value,
                baseModePolicy = policy,
                modeSeedSequence = insertionActionSequence.takeIf { policy.hasSoftMode() } ?: 0L
            )
        }
        if (current.nowPlayingEntries.isEmpty()) {
            _state.value = createStandaloneQueueState(
                contextLabel = current.contextLabel.ifBlank { "Queue" },
                entries = insertedEntries,
                animeMap = current.animeMap + animeMap,
                playRequestGeneration = current.playRequestGeneration + 1
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
            playbackIntent = queueAfterSuggestionRemoval.playbackIntent.copy(
                actionSequence = if (insertedEntries.any { it.modeSeedSequence > 0L }) {
                    insertionActionSequence
                } else {
                    queueAfterSuggestionRemoval.playbackIntent.actionSequence
                }
            ),
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
        addPlayableItems(
            themes.map { theme -> PlayableItem.Theme(theme, theme.animeId?.let(animeMap::get)) },
            animeMap
        )
    }

    fun addPlayableItems(
        items: List<PlayableItem>,
        animeMap: Map<Long, AnimeEntity> = emptyMap(),
        baseModePolicy: BaseModePolicy = BaseModePolicy.Inherit,
        baseModePolicies: List<BaseModePolicy>? = null
    ) {
        if (items.isEmpty()) return
        require(baseModePolicies == null || baseModePolicies.size == items.size)

        val current = _state.value
        val playable = playableItemsWithSourceIndex(items) { index ->
            baseModePolicies?.get(index) ?: baseModePolicy
        }
        if (playable.isEmpty()) return
        val insertionActionSequence = current.playbackIntent.actionSequence + 1L
        val appendedEntries = playable.map { indexed ->
            val policy = baseModePolicies?.get(indexed.index) ?: baseModePolicy
            QueueEntry(
                queueId = nextQueueEntryId++,
                item = indexed.value,
                baseModePolicy = policy,
                modeSeedSequence = insertionActionSequence.takeIf { policy.hasSoftMode() } ?: 0L
            )
        }
        if (current.nowPlayingEntries.isEmpty()) {
            _state.value = createStandaloneQueueState(
                contextLabel = current.contextLabel.ifBlank { "Queue" },
                entries = appendedEntries,
                animeMap = current.animeMap + animeMap,
                playRequestGeneration = current.playRequestGeneration + 1
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
            playbackIntent = queueAfterSuggestionRemoval.playbackIntent.copy(
                actionSequence = if (appendedEntries.any { it.modeSeedSequence > 0L }) {
                    insertionActionSequence
                } else {
                    queueAfterSuggestionRemoval.playbackIntent.actionSequence
                }
            ),
            queueVersion = queueAfterSuggestionRemoval.queueVersion + 1,
            isFullReload = false
        )
    }

    /**
     * Convenience for single song.
     */
    fun addToQueue(theme: ThemeEntity, anime: AnimeEntity? = null): Unit =
        addToQueue(listOf(theme), anime?.let { a -> theme.animeId?.let { mapOf(it to a) } } ?: emptyMap())

    private fun playableItemsWithSourceIndex(
        items: List<PlayableItem>,
        playbackIntent: PlaybackIntent = _state.value.playbackIntent,
        policyAt: (Int) -> BaseModePolicy
    ): List<IndexedValue<PlayableItem>> =
        items.withIndex().filter { indexed ->
            val entry = QueueEntry(queueId = 0L, item = indexed.value, baseModePolicy = policyAt(indexed.index))
            val requiredKey = requiredOfflineMediaKey(entry, playbackIntent)
            sessionStateManager.isOnlineEnabled() ||
                isOfflinePlayable(entry, offlineMediaAvailability.snapshot(), playbackIntent) ||
                !indexed.value.localFilePath.isNullOrBlank()
        }

    /**
     * Remove suggested items from the queue, preserving current index.
     */
    private fun removeSuggestedItems(current: NowPlayingState): NowPlayingState {
        if (current.suggestedEntryIds.isEmpty()) return current

        val suggestedIds = current.suggestedEntryIds.toSet()
        val updatedQueue = current.nowPlayingEntries.filterIndexed { index, entry ->
            index <= current.currentIndex || entry.queueId !in suggestedIds
        }
        val retainedQueueIds = updatedQueue.mapTo(mutableSetOf()) { it.queueId }

        return current.copy(
            nowPlayingEntries = updatedQueue,
            currentIndex = current.currentIndex.coerceAtMost(updatedQueue.lastIndex.coerceAtLeast(0)),
            suggestedEntryIds = emptyList(),
            unskippedEntryIds = current.unskippedEntryIds.filterTo(mutableSetOf()) { it in retainedQueueIds }
        )
    }

    /**
     * Called when the media player transitions to a new track.
     * Updates currentIndex, history, and playedIndices using the queue entry id.
     */
    fun onTrackChangedByQueueId(queueId: Long, replayRecordedMode: Boolean = false) {
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
            current.historyEntries.appendUniqueQueueEntries(current.nowPlayingEntries.subList(oldIndex, newIndex))
        } else if (newIndex < oldIndex) {
            val rewindTrack = current.nowPlayingEntries[newIndex]
            val histIdx = current.historyEntries.indexOfLast { it.queueId == rewindTrack.queueId }
            if (histIdx >= 0) current.historyEntries.subList(0, histIdx) else current.historyEntries
        } else {
            current.historyEntries
        }

        var updated = current.copy(
            currentIndex = newIndex,
            historyEntries = newHistory,
            playedIndices = current.playedIndices + newIndex
        )
        if (replayRecordedMode && updated.findQueueEntry(queueId)?.lastActualMode != null) {
            updated = updated.updateOccurrence(queueId) { it.copy(replayRequested = true) }
                .copy(queueVersion = current.queueVersion + 1, isFullReload = false)
        }
        _state.value = updated
    }

    /** Ends the queue-local mode lifetime after the final occurrence has completed. */
    fun resetQueueModeAfterExhaustion() {
        val current = _state.value
        if (current.playbackIntent.sessionOverride == null &&
            current.nowPlayingEntries.none { it.desiredMode != null || it.manualMode != null }
        ) return
        fun reset(entry: QueueEntry) = entry.copy(desiredMode = null, manualMode = null)
        _state.value = current.copy(
            originalQueueEntries = current.originalQueueEntries.map(::reset),
            nowPlayingEntries = current.nowPlayingEntries.map(::reset),
            historyEntries = current.historyEntries.map(::reset),
            playbackIntent = PlaybackIntent(
                rememberedAudioMode = current.playbackIntent.rememberedAudioMode,
                queueStarted = true
            ),
            queueVersion = current.queueVersion + 1,
            modeSelectionGeneration = current.modeSelectionGeneration + 1,
            isFullReload = false
        )
    }

    /** Records the source selected for one queue occurrence without changing its desired intent. */
    fun recordActualMode(queueId: Long, actualMode: PlaybackMode?) {
        if (actualMode == null) return
        val current = _state.value
        val occurrence = current.findQueueEntry(queueId) ?: return
        if (occurrence.lastActualMode == actualMode && !occurrence.replayRequested) return
        _state.value = current.updateOccurrence(queueId) {
            // A Back/repeat/row replay pins the recorded source for this occurrence. Keep the
            // pin after Media3 reports the transition; clearing it here lets the following queue
            // reconciliation immediately snap back to the queue's desired mode.
            it.copy(lastActualMode = actualMode)
        }
    }

    fun requestOccurrenceReplay(queueId: Long) {
        val current = _state.value
        if (current.findQueueEntry(queueId)?.lastActualMode == null) return
        // Queue reconciliation is keyed by queueVersion. A replay marker without a version
        // change would be invisible to MediaControllerManager and the old Media3 descriptor
        // would remain active, so this occurrence must be resolved again before it plays.
        _state.value = current.updateOccurrence(queueId) { it.copy(replayRequested = true) }
            .copy(queueVersion = current.queueVersion + 1, isFullReload = false)
    }

    /** A newly applied dislike invalidates older manual/unskip state for this occurrence. */
    fun invalidateOccurrenceForPreference(queueId: Long) {
        val current = _state.value
        if (current.findQueueEntry(queueId) == null) return
        _state.value = current.updateOccurrence(queueId) {
            it.copy(manualMode = null, replayRequested = false, isUnskipped = false)
        }.copy(
            unskippedEntryIds = current.unskippedEntryIds - queueId,
            queueVersion = current.queueVersion + 1,
            modeSelectionGeneration = current.modeSelectionGeneration + 1,
            isFullReload = false
        )
    }

    fun onTrackChangedByThemeId(themeId: Long) {
        val current = _state.value
        val expectedNextIndex = current.currentIndex + 1
        val expectedEntry = current.nowPlayingEntries.getOrNull(expectedNextIndex)
        if (expectedEntry?.themeOrNull?.id == themeId) {
            onTrackChangedByQueueId(expectedEntry.queueId)
            return
        }

        val fallbackEntry = current.nowPlayingEntries.firstOrNull { it.themeOrNull?.id == themeId } ?: return
        onTrackChangedByQueueId(fallbackEntry.queueId)
    }

    /**
     * Skip to a specific track in the queue by index.
     */
    fun skipTo(index: Int) {
        val current = _state.value
        if (index < 0 || index >= current.nowPlayingEntries.size) return

        // A direct queue-row selection is an explicit user action: restore the occurrence's
        // recorded source and temporarily allow it through preference filtering.
        val targetQueueId = current.nowPlayingEntries[index].queueId
        val selected = current.updateOccurrence(targetQueueId) {
            it.copy(isUnskipped = true, replayRequested = true)
        }

        val newHistory = if (index > current.currentIndex) {
            selected.historyEntries.appendUniqueQueueEntries(selected.nowPlayingEntries.subList(selected.currentIndex, index))
        } else if (index < current.currentIndex) {
            val targetEntry = selected.nowPlayingEntries[index]
            val histIdx = selected.historyEntries.indexOfLast { it.queueId == targetEntry.queueId }
            if (histIdx >= 0) selected.historyEntries.subList(0, histIdx) else selected.historyEntries
        } else {
            selected.historyEntries
        }

        // Mark all skipped-over indices as played
        val skippedIndices = if (index > current.currentIndex) {
            (current.currentIndex until index).toSet()
        } else emptySet()

        _state.value = current.copy(
            currentIndex = index,
            historyEntries = newHistory,
            nowPlayingEntries = selected.nowPlayingEntries,
            originalQueueEntries = selected.originalQueueEntries,
            playedIndices = current.playedIndices + skippedIndices + index,
            unskippedEntryIds = current.unskippedEntryIds + targetQueueId,
            queueVersion = current.queueVersion + 1,
            playRequestGeneration = current.playRequestGeneration + 1,
            isFullReload = true
        )
    }

    /**
     * Move an item from one index to another in the queue.
     */
    fun moveItemByQueueId(fromQueueId: Long, toQueueId: Long) {
        val current = _state.value
        val fromIndex = current.indexOfQueueId(fromQueueId)
        val toIndex = current.indexOfQueueId(toQueueId)
        if (fromIndex < 0 || toIndex < 0) return
        moveItem(fromIndex, toIndex)
    }

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

        _state.value = current.copy(
            nowPlayingEntries = updated,
            currentIndex = newCurrentIndex,
            playedIndices = newPlayedIndices,
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

        _state.value = current.copy(
            nowPlayingEntries = updated,
            currentIndex = newCurrentIndex,
            historyEntries = current.historyEntries.filter { it.queueId != removedEntry.queueId },
            playNextEntryIds = current.playNextEntryIds.filter { it != removedEntry.queueId },
            addedToQueueEntryIds = current.addedToQueueEntryIds.filter { it != removedEntry.queueId },
            suggestedEntryIds = current.suggestedEntryIds.filter { it != removedEntry.queueId },
            playedIndices = newPlayedIndices,
            unskippedEntryIds = current.unskippedEntryIds - removedEntry.queueId,
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

        val newNowPlaying = (restoredTracks + current.nowPlayingEntries.subList(current.currentIndex, current.nowPlayingEntries.size))
            .mapIndexed { index, entry ->
                if (index == 0) entry.copy(replayRequested = true) else entry
            }

        _state.value = current.copy(
            nowPlayingEntries = newNowPlaying,
            currentIndex = 0,
            historyEntries = trimmedHistory,
            playedIndices = setOf(0),
            queueVersion = current.queueVersion + 1,
            playRequestGeneration = current.playRequestGeneration + 1,
            isFullReload = true
        )
    }

    /**
     * Toggle shuffle on/off.
     */
    fun toggleShuffle() {
        val current = _state.value
        if (current.nowPlayingEntries.isEmpty()) return

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

        // Shuffle the complete context, including entries already shown under Previous. History
        // can contain queue entries no longer present after rewindTo(), so include every known
        // occurrence and de-duplicate only by queue identity.
        val allEntries = (current.originalQueueEntries + current.nowPlayingEntries + current.historyEntries)
            .distinctBy { it.queueId }
        val candidates = allEntries.filter { it.queueId != currentEntry.queueId }

        // Identify play-next items that should stay right after current
        val playNextIds = current.playNextEntryIds.toSet()
        val playNextEntriesById = candidates.associateBy { it.queueId }
        val playNextEntries = current.playNextEntryIds.mapNotNull(playNextEntriesById::get)
        val shuffleable = candidates.filter { it.queueId !in playNextIds }

        // Rebuild: current + play-next items + every other occurrence in random order.
        val newNowPlaying = listOf(currentEntry) + playNextEntries + shuffleable.shuffled()

        _state.value = current.copy(
            nowPlayingEntries = newNowPlaying,
            currentIndex = 0,
            historyEntries = emptyList(),
            playedIndices = setOf(0),
            isShuffled = true,
            queueVersion = current.queueVersion + 1,
            isFullReload = false
        )
    }

    private fun unshuffle(current: NowPlayingState) {
        val currentEntry = current.currentEntry ?: return

        // Restore the complete original source around the exact current occurrence. Added duplicate
        // entries have distinct identities and therefore do not steal an original occurrence's slot.
        val originalIndex = current.originalQueueEntries.indexOfFirst { it.queueId == currentEntry.queueId }
        val allEntries = (current.originalQueueEntries + current.nowPlayingEntries + current.historyEntries)
            .distinctBy { it.queueId }
        val entriesById = allEntries.associateBy { it.queueId }
        val playNextIds = current.playNextEntryIds.toSet()
        val playNextEntries = current.playNextEntryIds
            .filter { it != currentEntry.queueId }
            .mapNotNull(entriesById::get)

        val sourceBeforeCurrent = if (originalIndex >= 0) {
            current.originalQueueEntries.take(originalIndex).filter { it.queueId !in playNextIds }
        } else {
            emptyList()
        }
        val sourceAfterCurrent = if (originalIndex >= 0) {
            current.originalQueueEntries.drop(originalIndex + 1).filter { it.queueId !in playNextIds }
        } else {
            current.originalQueueEntries.filter { it.queueId !in playNextIds }
        }

        val placedIds = (sourceBeforeCurrent + currentEntry + playNextEntries + sourceAfterCurrent)
            .mapTo(mutableSetOf()) { it.queueId }
        val addedEntries = current.addedToQueueEntryIds
            .mapNotNull(entriesById::get)
            .filter { it.queueId !in placedIds }
        val orderedIds = placedIds + addedEntries.map { it.queueId }
        val extraItems = addedEntries + allEntries.filter { it.queueId !in orderedIds }

        val newNowPlaying = if (originalIndex >= 0) {
            sourceBeforeCurrent + currentEntry + playNextEntries + sourceAfterCurrent + extraItems
        } else {
            listOf(currentEntry) + playNextEntries + sourceAfterCurrent + extraItems
        }
        val newCurrentIndex = if (originalIndex >= 0) sourceBeforeCurrent.size else 0

        _state.value = current.copy(
            nowPlayingEntries = newNowPlaying,
            currentIndex = newCurrentIndex,
            historyEntries = newNowPlaying.take(newCurrentIndex),
            playedIndices = (0..newCurrentIndex).toSet(),
            isShuffled = false,
            queueVersion = current.queueVersion + 1,
            isFullReload = false
        )
    }

    val currentTheme: ThemeEntity?
        get() = _state.value.currentTheme

    val isActive: Boolean
        get() = _state.value.nowPlayingEntries.isNotEmpty()

    private fun createQueueEntries(
        items: List<PlayableItem>,
        baseModePolicy: BaseModePolicy = BaseModePolicy.Inherit
    ): List<QueueEntry> =
        items.map { item ->
            QueueEntry(queueId = nextQueueEntryId++, item = item, baseModePolicy = baseModePolicy)
        }

    private fun createStandaloneQueueState(
        contextLabel: String,
        entries: List<QueueEntry>,
        animeMap: Map<Long, AnimeEntity>,
        playRequestGeneration: Long
    ): NowPlayingState {
        val queueSeed = entries.mapNotNull { it.baseModePolicy.playlistDefault }.firstOrNull()
        return NowPlayingState(
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
        playbackIntent = PlaybackIntent(
            rememberedAudioMode = _state.value.playbackIntent.rememberedAudioMode,
            sessionOverride = queueSeed,
            actionSequence = entries.maxOfOrNull { it.modeSeedSequence } ?: 0L,
            queueStarted = true
        ),
        queueVersion = _state.value.queueVersion + 1,
        playRequestGeneration = playRequestGeneration,
        isFullReload = true
        )
    }
}

@Stable
data class QueueEntry(
    val queueId: Long,
    val item: PlayableItem,
    val baseModePolicy: BaseModePolicy = BaseModePolicy.Inherit,
    /** Queue-local desired mode. Null means inherit the queue seed or TV default. */
    val desiredMode: PlaybackMode? = null,
    /** Last source actually used for this occurrence (independent of duplicate copies). */
    val lastActualMode: PlaybackMode? = null,
    /** Explicit selection for this occurrence; it outranks saved and soft preferences. */
    val manualMode: PlaybackMode? = null,
    /** Action sequence at which a soft playlist seed was inserted. */
    val modeSeedSequence: Long = 0L,
    /** Pins an ordinary Back/repeat/row replay to the recorded actual mode. */
    val replayRequested: Boolean = false,
    /** Explicitly restored/unskipped occurrence state. */
    val isUnskipped: Boolean = false
) {
    constructor(
        queueId: Long,
        theme: ThemeEntity,
        baseModePolicy: BaseModePolicy = BaseModePolicy.Inherit,
        desiredMode: PlaybackMode? = null,
        lastActualMode: PlaybackMode? = null,
        manualMode: PlaybackMode? = null,
        modeSeedSequence: Long = 0L,
        replayRequested: Boolean = false,
        isUnskipped: Boolean = false
    ) : this(
        queueId,
        PlayableItem.Theme(theme),
        baseModePolicy,
        desiredMode,
        lastActualMode,
        manualMode,
        modeSeedSequence,
        replayRequested,
        isUnskipped
    )

    val themeOrNull: ThemeEntity?
        get() = (item as? PlayableItem.Theme)?.theme

    /** Theme-only compatibility adapter. New mixed-queue code must use [item]. */
    val theme: ThemeEntity
        get() = requireNotNull(themeOrNull) { "Queue entry $queueId is ${item.key.kind}, not THEME" }
}

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
    val unskippedEntryIds: Set<Long> = emptySet(),
    val playbackIntent: PlaybackIntent = PlaybackIntent(),
    /** Monotonic user intent consumed once by MediaController queue reconciliation. */
    val playRequestGeneration: Long = 0L,
    /** Explicit mode retries must resolve again even when an offline fallback retained this intent. */
    val modeSelectionGeneration: Long = 0L
) {
    private val entriesById: Map<Long, QueueEntry> by lazy {
        buildMap {
            originalQueueEntries.forEach { put(it.queueId, it) }
            nowPlayingEntries.forEach { put(it.queueId, it) }
            historyEntries.forEach { put(it.queueId, it) }
        }
    }

    val originalItems: List<PlayableItem> by lazy { originalQueueEntries.map { it.item } }
    val nowPlayingItems: List<PlayableItem> by lazy { nowPlayingEntries.map { it.item } }
    val historyItems: List<PlayableItem> by lazy { historyEntries.map { it.item } }
    val originalQueue: List<ThemeEntity> by lazy { originalQueueEntries.mapNotNull { it.themeOrNull } }
    val nowPlaying: List<ThemeEntity> by lazy { nowPlayingEntries.mapNotNull { it.themeOrNull } }
    val history: List<ThemeEntity> by lazy { historyEntries.mapNotNull { it.themeOrNull } }
    val playNextEntries: List<QueueEntry> by lazy { playNextEntryIds.mapNotNull(entriesById::get) }
    val playNextPlayableItems: List<PlayableItem> by lazy { playNextEntries.map { it.item } }
    val playNextItems: List<ThemeEntity> by lazy { playNextEntries.mapNotNull { it.themeOrNull } }
    val addedToQueueEntries: List<QueueEntry> by lazy { addedToQueueEntryIds.mapNotNull(entriesById::get) }
    val addedToQueuePlayableItems: List<PlayableItem> by lazy { addedToQueueEntries.map { it.item } }
    val addedToQueueItems: List<ThemeEntity> by lazy { addedToQueueEntries.mapNotNull { it.themeOrNull } }
    val suggestedEntries: List<QueueEntry> by lazy { suggestedEntryIds.mapNotNull(entriesById::get) }
    val suggestedPlayableItems: List<PlayableItem> by lazy { suggestedEntries.map { it.item } }
    val suggestedItems: List<ThemeEntity> by lazy { suggestedEntries.mapNotNull { it.themeOrNull } }
    val currentEntry: QueueEntry?
        get() = nowPlayingEntries.getOrNull(currentIndex)
    val currentTheme: ThemeEntity?
        get() = currentEntry?.themeOrNull
    val currentItem: PlayableItem?
        get() = currentEntry?.item

    val upcomingEntries: List<QueueEntry> by lazy {
        if (currentIndex + 1 < nowPlayingEntries.size) {
            nowPlayingEntries.subList(currentIndex + 1, nowPlayingEntries.size)
        } else {
            emptyList()
        }
    }

    /** Positional compatibility view derived from stable queue occurrence identity. */
    val unskippedIndices: Set<Int> by lazy {
        nowPlayingEntries.mapIndexedNotNull { index, entry ->
            index.takeIf { entry.queueId in unskippedEntryIds }
        }.toSet()
    }

    val upcomingItems: List<PlayableItem> by lazy { upcomingEntries.map { it.item } }
    val upcomingTracks: List<ThemeEntity> by lazy {
        if (currentIndex + 1 < nowPlayingEntries.size) {
            upcomingEntries.mapNotNull { it.themeOrNull }
        } else {
            emptyList()
        }
    }

    val maxQueueEntryId: Long by lazy {
        (originalQueueEntries + nowPlayingEntries + historyEntries).maxOfOrNull { it.queueId } ?: 0L
    }

    fun indexOfQueueId(queueId: Long): Int = nowPlayingEntries.indexOfFirst { it.queueId == queueId }
}

internal fun NowPlayingState.withUniqueHistoryEntries(): NowPlayingState =
    copy(historyEntries = historyEntries.distinctBy { it.queueId })

private fun NowPlayingState.findQueueEntry(queueId: Long): QueueEntry? =
    (originalQueueEntries + nowPlayingEntries + historyEntries).firstOrNull { it.queueId == queueId }

/** Updates every copy of an occurrence so reorder, history, and repeat retain one state object. */
private fun NowPlayingState.updateOccurrence(
    queueId: Long,
    transform: (QueueEntry) -> QueueEntry
): NowPlayingState = copy(
    originalQueueEntries = originalQueueEntries.map { entry ->
        entry.takeIf { it.queueId != queueId } ?: transform(entry)
    },
    nowPlayingEntries = nowPlayingEntries.map { entry ->
        entry.takeIf { it.queueId != queueId } ?: transform(entry)
    },
    historyEntries = historyEntries.map { entry ->
        entry.takeIf { it.queueId != queueId } ?: transform(entry)
    }
)

private fun BaseModePolicy.hasSoftMode(): Boolean =
    entryPolicy != ThemeModePolicy.INHERIT || playlistDefault != null

private fun List<QueueEntry>.appendUniqueQueueEntries(entries: List<QueueEntry>): List<QueueEntry> {
    if (entries.isEmpty()) return this
    val seen = mapTo(mutableSetOf()) { it.queueId }
    val uniqueEntries = entries.filter { seen.add(it.queueId) }
    return if (uniqueEntries.isEmpty()) this else this + uniqueEntries
}
