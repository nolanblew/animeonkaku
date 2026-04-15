package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NowPlayingManagerTest {

    private lateinit var manager: NowPlayingManager

    // Helpers
    private fun theme(id: Long, title: String = "Song $id", animeId: Long? = null) = ThemeEntity(
        id = id,
        animeId = animeId,
        title = title,
        artistName = "Artist $id",
        audioUrl = "https://example.com/$id.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null,
        themeType = null
    )

    private fun anime(atId: Long, title: String = "Anime $atId") = AnimeEntity(
        kitsuId = "kitsu-$atId",
        animeThemesId = atId,
        title = title,
        thumbnailUrl = null,
        coverUrl = "https://example.com/cover-$atId.jpg",
        syncedAt = 0L
    )

    @Before
    fun setUp() {
        manager = NowPlayingManager()
    }

    // â”€â”€â”€ play() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `play with empty list does nothing`() {
        manager.play("ctx", emptyList())
        assertNull(manager.currentTheme)
        assertFalse(manager.isActive)
    }

    @Test
    fun `play sets current theme to startIndex song`() {
        val themes = listOf(theme(1), theme(2), theme(3))
        manager.play("ctx", themes, startIndex = 1)
        assertEquals(2L, manager.currentTheme?.id)
    }

    @Test
    fun `play from startIndex only queues from start onward`() {
        val themes = listOf(theme(1), theme(2), theme(3))
        manager.play("ctx", themes, startIndex = 1)
        val state = manager.state.value
        assertEquals(listOf(2L, 3L), state.nowPlaying.map { it.id })
        assertEquals(0, state.currentIndex)
    }

    @Test
    fun `play clears history and queue metadata`() {
        val themes = listOf(theme(1), theme(2))
        manager.play("ctx", themes)
        manager.onTrackChangedByThemeId(2L)
        manager.play("ctx2", listOf(theme(3)))
        val state = manager.state.value
        assertTrue(state.history.isEmpty())
        assertTrue(state.playNextItems.isEmpty())
        assertTrue(state.addedToQueueItems.isEmpty())
    }

    @Test
    fun `play with shuffle puts startIndex song first`() {
        val themes = listOf(theme(1), theme(2), theme(3), theme(4), theme(5))
        manager.play("ctx", themes, startIndex = 2, shuffle = true)
        val state = manager.state.value
        assertEquals(3L, state.nowPlaying.first().id)
        assertTrue(state.isShuffled)
    }

    @Test
    fun `play with shuffle contains all songs`() {
        val themes = listOf(theme(1), theme(2), theme(3), theme(4))
        manager.play("ctx", themes, startIndex = 0, shuffle = true)
        val state = manager.state.value
        assertEquals(4, state.nowPlaying.size)
        assertEquals(setOf(1L, 2L, 3L, 4L), state.nowPlaying.map { it.id }.toSet())
    }

    @Test
    fun `play marks isFullReload true`() {
        manager.play("ctx", listOf(theme(1)))
        assertTrue(manager.state.value.isFullReload)
    }

    @Test
    fun `play increments queueVersion`() {
        val before = manager.state.value.queueVersion
        manager.play("ctx", listOf(theme(1)))
        assertEquals(before + 1, manager.state.value.queueVersion)
    }

    @Test
    fun `play stores animeMap`() {
        val a = anime(10L)
        manager.play("ctx", listOf(theme(1, animeId = 10L)), animeMap = mapOf(10L to a))
        assertEquals(a, manager.state.value.animeMap[10L])
    }

    @Test
    fun `play clamps out-of-bounds startIndex`() {
        val themes = listOf(theme(1), theme(2))
        manager.play("ctx", themes, startIndex = 99)
        assertEquals(2L, manager.currentTheme?.id)
    }

    // â”€â”€â”€ playNext() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `playNext inserts song immediately after current`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.playNext(theme(99))
        val nowPlaying = manager.state.value.nowPlaying
        assertEquals(listOf(1L, 99L, 2L, 3L), nowPlaying.map { it.id })
    }

    @Test
    fun `playNext with empty queue starts queue with single song`() {
        manager.playNext(theme(1))
        val state = manager.state.value
        assertTrue(manager.isActive)
        assertEquals(listOf(1L), state.nowPlaying.map { it.id })
        assertEquals(1L, state.currentTheme?.id)
        assertTrue(state.isFullReload)
    }

    @Test
    fun `playNext with empty queue starts queue with multiple songs in order`() {
        manager.playNext(listOf(theme(1), theme(2), theme(3)))
        val state = manager.state.value
        assertEquals(listOf(1L, 2L, 3L), state.nowPlaying.map { it.id })
        assertEquals(1L, state.currentTheme?.id)
    }

    @Test
    fun `playNext marks isFullReload false`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.playNext(theme(99))
        assertFalse(manager.state.value.isFullReload)
    }

    @Test
    fun `playNext merges animeMap for cross-album art`() {
        val a = anime(20L)
        manager.play("ctx", listOf(theme(1)))
        manager.playNext(theme(99, animeId = 20L), anime = a)
        assertEquals(a, manager.state.value.animeMap[20L])
    }

    @Test
    fun `playNext multiple songs stacks LIFO`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.playNext(theme(10))
        manager.playNext(theme(11))
        // 11 should be right after current (1), then 10, then 2
        val ids = manager.state.value.nowPlaying.map { it.id }
        assertEquals(listOf(1L, 11L, 10L, 2L), ids)
    }

    @Test
    fun `playNext does not restart current song (isFullReload stays false)`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        val versionBefore = manager.state.value.queueVersion
        manager.playNext(theme(99))
        val state = manager.state.value
        assertFalse(state.isFullReload)
        assertEquals(1L, state.currentTheme?.id)
        assertEquals(versionBefore + 1, state.queueVersion)
    }

    @Test
    fun `playNext inserts multiple songs in order immediately after current`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3), theme(4)))
        manager.playNext(listOf(theme(10), theme(11), theme(12)))
        val ids = manager.state.value.nowPlaying.map { it.id }
        assertEquals(listOf(1L, 10L, 11L, 12L, 2L, 3L, 4L), ids)
    }

    @Test
    fun `playNext preserves insertion order even when queue is shuffled`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3), theme(4), theme(5)), shuffle = true)
        val currentId = manager.state.value.currentTheme?.id
        manager.playNext(listOf(theme(10), theme(11), theme(12)))
        val state = manager.state.value
        assertEquals(currentId, state.currentTheme?.id)
        assertEquals(listOf(10L, 11L, 12L), state.nowPlaying.drop(1).take(3).map { it.id })
    }

    // â”€â”€â”€ addToQueue() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `addToQueue appends song to end of queue`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.addToQueue(theme(99))
        val ids = manager.state.value.nowPlaying.map { it.id }
        assertEquals(listOf(1L, 2L, 99L), ids)
    }

    @Test
    fun `addToQueue with empty queue starts queue with single song`() {
        manager.addToQueue(theme(1))
        val state = manager.state.value
        assertTrue(manager.isActive)
        assertEquals(listOf(1L), state.nowPlaying.map { it.id })
        assertEquals(1L, state.currentTheme?.id)
        assertTrue(state.isFullReload)
    }

    @Test
    fun `addToQueue with empty queue starts queue with multiple songs in order`() {
        manager.addToQueue(listOf(theme(1), theme(2), theme(3)))
        val state = manager.state.value
        assertEquals(listOf(1L, 2L, 3L), state.nowPlaying.map { it.id })
        assertEquals(1L, state.currentTheme?.id)
    }

    @Test
    fun `addToQueue marks isFullReload false`() {
        manager.play("ctx", listOf(theme(1)))
        manager.addToQueue(theme(2))
        assertFalse(manager.state.value.isFullReload)
    }

    @Test
    fun `addToQueue merges animeMap for cross-album art`() {
        val a = anime(30L)
        manager.play("ctx", listOf(theme(1)))
        manager.addToQueue(theme(99, animeId = 30L), anime = a)
        assertEquals(a, manager.state.value.animeMap[30L])
    }

    @Test
    fun `addToQueue preserves existing animeMap entries`() {
        val a1 = anime(1L)
        val a2 = anime(2L)
        manager.play("ctx", listOf(theme(1, animeId = 1L)), animeMap = mapOf(1L to a1))
        manager.addToQueue(theme(2, animeId = 2L), anime = a2)
        val map = manager.state.value.animeMap
        assertEquals(a1, map[1L])
        assertEquals(a2, map[2L])
    }

    @Test
    fun `addToQueue appends multiple songs in order`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.addToQueue(listOf(theme(10), theme(11), theme(12)))
        val ids = manager.state.value.nowPlaying.map { it.id }
        assertEquals(listOf(1L, 2L, 10L, 11L, 12L), ids)
    }

    @Test
    fun `adding played song to queue appends distinct copy`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.skipTo(1)

        val originalEntryId = manager.state.value.nowPlayingEntries.first().queueId
        manager.addToQueue(theme(1))

        val state = manager.state.value
        val copyEntryId = state.nowPlayingEntries.last().queueId

        assertEquals(listOf(1L, 2L, 3L, 1L), state.nowPlaying.map { it.id })
        assertEquals(originalEntryId, state.historyEntries.single().queueId)
        assertTrue(copyEntryId != originalEntryId)
        assertEquals(1L, state.nowPlayingEntries.first().theme.id)
    }

    @Test
    fun `adding played song to play next inserts distinct copy after current`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.skipTo(1)

        val originalEntryId = manager.state.value.nowPlayingEntries.first().queueId
        manager.playNext(theme(1))

        val state = manager.state.value
        val copyEntry = state.nowPlayingEntries[2]

        assertEquals(listOf(1L, 2L, 1L, 3L), state.nowPlaying.map { it.id })
        assertEquals(originalEntryId, state.historyEntries.single().queueId)
        assertTrue(copyEntry.queueId != originalEntryId)
        assertEquals(1L, copyEntry.theme.id)
    }

    @Test
    fun `adding played and new songs to queue appends copies without mutating original entry`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.skipTo(1)

        val originalEntryId = manager.state.value.nowPlayingEntries.first().queueId
        manager.addToQueue(listOf(theme(1), theme(99)))

        val state = manager.state.value
        assertEquals(listOf(1L, 2L, 3L, 1L, 99L), state.nowPlaying.map { it.id })
        assertEquals(originalEntryId, state.historyEntries.single().queueId)
        assertTrue(state.nowPlayingEntries[3].queueId != originalEntryId)
    }

    @Test
    fun `adding upcoming song to queue appends copy without changing original upcoming item`() {
        manager.play("ctx", listOf(theme(9), theme(8), theme(1), theme(7)))

        val originalEntryId = manager.state.value.nowPlayingEntries[2].queueId
        manager.addToQueue(theme(1))

        val state = manager.state.value
        assertEquals(listOf(9L, 8L, 1L, 7L, 1L), state.nowPlaying.map { it.id })
        assertEquals(originalEntryId, state.nowPlayingEntries[2].queueId)
        assertTrue(state.nowPlayingEntries.last().queueId != originalEntryId)
    }

    @Test
    fun `adding upcoming song to play next inserts copy and keeps original upcoming item`() {
        manager.play("ctx", listOf(theme(9), theme(8), theme(1), theme(7)))

        val originalEntryId = manager.state.value.nowPlayingEntries[2].queueId
        manager.playNext(theme(1))

        val state = manager.state.value
        assertEquals(listOf(9L, 1L, 8L, 1L, 7L), state.nowPlaying.map { it.id })
        assertEquals(originalEntryId, state.nowPlayingEntries[3].queueId)
        assertTrue(state.nowPlayingEntries[1].queueId != originalEntryId)
    }

    @Test
    fun `adding upcoming and new songs to play next inserts copy and preserves original order after bump`() {
        manager.play("ctx", listOf(theme(9), theme(8), theme(1), theme(7)))

        val originalEntryId = manager.state.value.nowPlayingEntries[2].queueId
        manager.playNext(listOf(theme(1), theme(99)))

        val state = manager.state.value
        assertEquals(listOf(9L, 1L, 99L, 8L, 1L, 7L), state.nowPlaying.map { it.id })
        assertEquals(originalEntryId, state.nowPlayingEntries[4].queueId)
        assertTrue(state.nowPlayingEntries[1].queueId != originalEntryId)
    }

    @Test
    fun `unshuffle keeps added copy of original song`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3), theme(4)))
        manager.addToQueue(theme(2))

        val originalEntryId = manager.state.value.nowPlayingEntries[1].queueId
        manager.toggleShuffle()
        manager.toggleShuffle()

        val state = manager.state.value
        assertEquals(listOf(1L, 2L, 3L, 4L, 2L), state.nowPlaying.map { it.id })
        assertEquals(originalEntryId, state.nowPlayingEntries[1].queueId)
        assertTrue(state.nowPlayingEntries.last().queueId != originalEntryId)
    }

    @Test
    fun `unshuffle from added song outside original context keeps original queue after current`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3), theme(4)))
        manager.addToQueue(theme(99))
        manager.toggleShuffle()

        val addedIndex = manager.state.value.nowPlayingEntries.indexOfFirst { it.theme.id == 99L }
        manager.skipTo(addedIndex)
        manager.toggleShuffle()

        val state = manager.state.value
        assertEquals(listOf(99L, 1L, 2L, 3L, 4L), state.nowPlaying.map { it.id })
    }

    @Test
    fun `unshuffle from added copy of original song does not duplicate original slot`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3), theme(4)))
        manager.addToQueue(theme(2))

        val originalEntryId = manager.state.value.nowPlayingEntries.first { it.theme.id == 2L }.queueId
        val copyEntryId = manager.state.value.nowPlayingEntries.last { it.theme.id == 2L }.queueId
        manager.toggleShuffle()

        val copyIndex = manager.state.value.nowPlayingEntries.indexOfFirst { it.queueId == copyEntryId }

        manager.skipTo(copyIndex)
        manager.toggleShuffle()

        val state = manager.state.value
        assertEquals(listOf(2L, 3L, 4L), state.nowPlaying.map { it.id })
        assertEquals(copyEntryId, state.currentEntry?.queueId)
        assertTrue(state.currentEntry?.queueId != originalEntryId)
    }

    // â”€â”€â”€ onTrackChangedByThemeId() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `onTrackChanged updates currentIndex`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.onTrackChangedByThemeId(3L)
        assertEquals(2, manager.state.value.currentIndex)
    }

    @Test
    fun `onTrackChanged moving forward adds skipped tracks to history`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.onTrackChangedByThemeId(3L)
        val history = manager.state.value.history
        assertEquals(listOf(1L, 2L), history.map { it.id })
    }

    @Test
    fun `onTrackChanged to same index does not change history`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.onTrackChangedByThemeId(1L)
        assertTrue(manager.state.value.history.isEmpty())
    }

    @Test
    fun `onTrackChanged out of bounds is ignored`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.onTrackChangedByThemeId(99L)
        assertEquals(0, manager.state.value.currentIndex)
    }

    @Test
    fun `onTrackChanged does not bump queueVersion`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        val versionAfterPlay = manager.state.value.queueVersion
        manager.onTrackChangedByThemeId(2L)
        assertEquals(versionAfterPlay, manager.state.value.queueVersion)
    }

    @Test
    fun `onTrackChangedByQueueId targets the correct duplicate queue entry`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.addToQueue(theme(1))
        manager.skipTo(1)

        val duplicateEntryId = manager.state.value.nowPlayingEntries.last().queueId
        manager.onTrackChangedByQueueId(duplicateEntryId)

        val state = manager.state.value
        assertEquals(2, state.currentIndex)
        assertEquals(duplicateEntryId, state.currentEntry?.queueId)
        assertEquals(listOf(1L, 2L), state.history.map { it.id })
    }

    // â”€â”€â”€ skipTo() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `skipTo moves currentIndex and marks isFullReload`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.skipTo(2)
        val state = manager.state.value
        assertEquals(2, state.currentIndex)
        assertTrue(state.isFullReload)
    }

    @Test
    fun `skipTo forward adds skipped tracks to history`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.skipTo(2)
        val history = manager.state.value.history
        assertEquals(listOf(1L, 2L), history.map { it.id })
    }

    @Test
    fun `skipTo out of bounds is ignored`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.skipTo(99)
        assertEquals(0, manager.state.value.currentIndex)
    }

    @Test
    fun `skipTo increments queueVersion`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        val v = manager.state.value.queueVersion
        manager.skipTo(1)
        assertEquals(v + 1, manager.state.value.queueVersion)
    }

    // â”€â”€â”€ rewindTo() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `rewindTo restores track from history to front of queue`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.onTrackChangedByThemeId(3L) // history = [1, 2], current = 3
        manager.rewindTo(0) // rewind to track 1
        val state = manager.state.value
        assertEquals(1L, state.currentTheme?.id)
        assertEquals(0, state.currentIndex)
    }

    @Test
    fun `rewindTo out of bounds is ignored`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.rewindTo(0) // no history yet
        assertEquals(1L, manager.currentTheme?.id)
    }

    @Test
    fun `rewindTo marks isFullReload true`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.onTrackChangedByThemeId(3L)
        manager.rewindTo(0)
        assertTrue(manager.state.value.isFullReload)
    }

    @Test
    fun `rewindTo preserves upcoming tracks after current`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.onTrackChangedByThemeId(2L) // history=[1], current=2, upcoming=[3]
        manager.rewindTo(0) // rewind to 1; new queue should be [1, 2, 3]
        val state = manager.state.value
        val ids = state.nowPlaying.map { it.id }
        assertTrue(ids.contains(3L))
    }

    // â”€â”€â”€ toggleShuffle() / setShuffled() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `toggleShuffle shuffles upcoming tracks and sets isShuffled`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3), theme(4)))
        manager.toggleShuffle()
        val state = manager.state.value
        assertTrue(state.isShuffled)
        assertEquals(1L, state.nowPlaying.first().id) // current stays first
        assertEquals(4, state.nowPlaying.size) // all tracks still present
    }

    @Test
    fun `toggleShuffle twice returns to unshuffled state`() {
        val themes = listOf(theme(1), theme(2), theme(3))
        manager.play("ctx", themes)
        manager.toggleShuffle()
        manager.toggleShuffle()
        val state = manager.state.value
        assertFalse(state.isShuffled)
        // After unshuffle, current track is still first
        assertEquals(1L, state.nowPlaying.first().id)
    }

    @Test
    fun `shuffle preserves playNext items at front of upcoming`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3), theme(4)))
        manager.playNext(theme(99))
        manager.toggleShuffle()
        val state = manager.state.value
        // 99 should still be right after current (index 1)
        assertEquals(99L, state.nowPlaying[1].id)
    }

    @Test
    fun `moveToPlayNext marks moved item as play next so shuffle preserves it`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3), theme(4)))
        manager.moveToPlayNext(3)
        manager.toggleShuffle()

        val state = manager.state.value
        assertEquals(4L, state.nowPlaying[1].id)
    }

    @Test
    fun `setShuffled true when already shuffled does nothing`() {
        manager.play("ctx", listOf(theme(1), theme(2)))
        manager.toggleShuffle() // now shuffled
        val v = manager.state.value.queueVersion
        manager.setShuffled(true) // no-op
        assertEquals(v, manager.state.value.queueVersion)
    }

    @Test
    fun `shuffle does not change isFullReload`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        manager.toggleShuffle()
        assertFalse(manager.state.value.isFullReload)
    }

    // â”€â”€â”€ upcomingTracks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `upcomingTracks returns tracks after currentIndex`() {
        manager.play("ctx", listOf(theme(1), theme(2), theme(3)))
        assertEquals(listOf(2L, 3L), manager.state.value.upcomingTracks.map { it.id })
    }

    @Test
    fun `upcomingTracks is empty when at last track`() {
        manager.play("ctx", listOf(theme(1)))
        assertTrue(manager.state.value.upcomingTracks.isEmpty())
    }

    // â”€â”€â”€ isActive / currentTheme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Test
    fun `isActive is false before any play call`() {
        assertFalse(manager.isActive)
    }

    @Test
    fun `isActive is true after play`() {
        manager.play("ctx", listOf(theme(1)))
        assertTrue(manager.isActive)
    }

    @Test
    fun `currentTheme is null before any play call`() {
        assertNull(manager.currentTheme)
    }
}
