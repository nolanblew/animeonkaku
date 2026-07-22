package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.PersistedNowPlayingState
import com.takeya.animeongaku.media.PersistedQueueEntry
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlayableKind
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.restorePersistedQueueState
import com.takeya.animeongaku.media.toPersistedState
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.ThemeModePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class NowPlayingPersistenceModelTest {
    @Test
    fun `typed queue round trip restores song context and queue ids`() {
        val theme = theme(1)
        val song = SongEntity(10, "Song", "Artist", audioUrl = "song.flac")
        val release = MusicReleaseEntity(20, "Album", "Artist")
        val entries = listOf(
            QueueEntry(41, PlayableItem.Theme(theme)),
            QueueEntry(42, PlayableItem.RelatedSong(song, release, relationshipType = "soundtrack"))
        )
        val persisted = NowPlayingState(
            originalQueueEntries = entries,
            nowPlayingEntries = entries,
            currentIndex = 1
        ).toPersistedState(positionMs = 1234, repeatMode = 2)

        val restored = restorePersistedQueueState(
            persisted = persisted,
            themes = mapOf(1L to theme),
            songs = mapOf(10L to song),
            releases = mapOf(20L to release),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )

        assertNotNull(restored)
        assertEquals(listOf(41L, 42L), restored!!.nowPlayingEntries.map { it.queueId })
        assertEquals(PlayableKind.SONG, restored.currentEntry!!.item.key.kind)
        assertEquals("Album", (restored.currentEntry!!.item as PlayableItem.RelatedSong).release?.title)
        assertEquals(1234L, persisted.positionMs)
    }

    @Test
    fun `deleted items are skipped and current index follows surviving occurrence`() {
        val persisted = PersistedNowPlayingState(
            nowPlayingEntries = listOf(
                PersistedQueueEntry(1, itemType = "THEME", itemId = 1),
                PersistedQueueEntry(2, itemType = "SONG", itemId = 99),
                PersistedQueueEntry(3, itemType = "THEME", itemId = 3)
            ),
            currentIndex = 2
        )

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(1L to theme(1), 3L to theme(3)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(listOf(1L, 3L), restored.nowPlayingEntries.map { it.queueId })
        assertEquals(1, restored.currentIndex)
        assertEquals(3L, restored.currentEntry!!.item.key.id)
    }

    @Test
    fun `legacy themeId only entry restores as theme`() {
        val persisted = PersistedNowPlayingState(
            nowPlayingEntries = listOf(PersistedQueueEntry(queueId = 7, themeId = 5))
        )

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(5L to theme(5)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(PlayableKind.THEME, restored.currentEntry!!.item.key.kind)
        assertEquals(5L, restored.currentEntry!!.themeOrNull!!.id)
    }

    @Test
    fun `pre A02 legacy lists restore duplicates metadata and remap deleted current`() {
        val persisted = PersistedNowPlayingState(
            originalQueueIds = listOf(1, 2, 1, 3),
            nowPlayingIds = listOf(99, 1, 2, 1, 3),
            currentIndex = 2,
            historyIds = listOf(1, 99, 1),
            playNextItemIds = listOf(1, 1),
            addedToQueueItemIds = listOf(3, 99),
            suggestedItemIds = listOf(1)
        )

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(1L to theme(1), 3L to theme(3)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(listOf(1L, 1L, 3L), restored.nowPlaying.map { it.id })
        assertEquals(1, restored.currentIndex)
        assertEquals(1L, restored.currentTheme!!.id)
        assertEquals(3, restored.nowPlayingEntries.map { it.queueId }.distinct().size)
        assertEquals(restored.nowPlayingEntries.take(2).map { it.queueId }, restored.playNextEntryIds)
        assertEquals(listOf(restored.nowPlayingEntries.last().queueId), restored.addedToQueueEntryIds)
        assertEquals(listOf(restored.nowPlayingEntries.first().queueId), restored.suggestedEntryIds)
        assertEquals(
            restored.nowPlayingEntries.take(2).map { it.queueId },
            restored.historyEntries.map { it.queueId }
        )
    }

    @Test
    fun `typed persistence round trip preserves duplicate song occurrences`() {
        val song = SongEntity(10, "Song", "Artist", audioUrl = "song.flac")
        val entries = listOf(
            QueueEntry(51, PlayableItem.RelatedSong(song)),
            QueueEntry(52, PlayableItem.RelatedSong(song))
        )
        val persisted = NowPlayingState(
            originalQueueEntries = entries,
            nowPlayingEntries = entries,
            currentIndex = 1,
            playNextEntryIds = listOf(52)
        ).toPersistedState(0, 0)

        val restored = restorePersistedQueueState(
            persisted,
            themes = emptyMap(),
            songs = mapOf(song.id to song),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(listOf(51L, 52L), restored.nowPlayingEntries.map { it.queueId })
        assertEquals(listOf(song.id, song.id), restored.nowPlayingItems.map { it.key.id })
        assertEquals(listOf(52L), restored.playNextEntryIds)
        assertEquals(1, restored.currentIndex)
    }

    @Test
    fun `typed persistence preserves playlist entry and default policy`() {
        val policy = BaseModePolicy(ThemeModePolicy.FULL_SIZE, PlaybackMode.TV_SIZE)
        val entry = QueueEntry(70, PlayableItem.Theme(theme(1)), policy)
        val persisted = NowPlayingState(
            originalQueueEntries = listOf(entry),
            nowPlayingEntries = listOf(entry)
        ).toPersistedState(0, 0)

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(1L to theme(1)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(policy, restored.currentEntry!!.baseModePolicy)
    }

    private fun theme(id: Long) = ThemeEntity(
        id = id,
        animeId = null,
        title = "Theme $id",
        artistName = null,
        audioUrl = "theme-$id.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    )
}
