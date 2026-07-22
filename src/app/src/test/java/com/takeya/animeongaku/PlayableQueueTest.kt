package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlayableKey
import com.takeya.animeongaku.media.PlayableKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PlayableQueueTest {
    private lateinit var manager: NowPlayingManager

    @Before
    fun setUp() {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "n"))
        }
        manager = NowPlayingManager(SessionStateManager(tokenStore))
    }

    @Test
    fun `theme and related song mix without synthetic theme and retain occurrence identity`() {
        val theme = PlayableItem.Theme(theme(1))
        val song = relatedSong(10)

        manager.playItems("Mixed", listOf(theme, song, theme, song))

        val entries = manager.state.value.nowPlayingEntries
        assertEquals(
            listOf(
                PlayableKey(PlayableKind.THEME, 1),
                PlayableKey(PlayableKind.SONG, 10),
                PlayableKey(PlayableKind.THEME, 1),
                PlayableKey(PlayableKind.SONG, 10)
            ),
            entries.map { it.item.key }
        )
        assertEquals(4, entries.map { it.queueId }.distinct().size)
        assertTrue(manager.isActive)
        assertNotEquals(entries[0].queueId, entries[2].queueId)
        assertTrue(entries[1].item is PlayableItem.RelatedSong)
        assertEquals(null, entries[1].themeOrNull)
    }

    @Test
    fun `mixed multi inserts preserve order through shuffle and unshuffle`() {
        val theme1 = PlayableItem.Theme(theme(1))
        val theme2 = PlayableItem.Theme(theme(2))
        val song10 = relatedSong(10)
        val song11 = relatedSong(11)

        manager.playItems("Mixed", listOf(theme1, theme2))
        manager.playNextItems(listOf(song10, song11))
        manager.addPlayableItems(listOf(theme1, song10))

        assertEquals(
            listOf(theme1.key, song10.key, song11.key, theme2.key, theme1.key, song10.key),
            manager.state.value.nowPlayingEntries.map { it.item.key }
        )
        val idsBeforeShuffle = manager.state.value.nowPlayingEntries.map { it.queueId }

        manager.toggleShuffle()
        assertEquals(idsBeforeShuffle.toSet(), manager.state.value.nowPlayingEntries.map { it.queueId }.toSet())
        manager.toggleShuffle()

        val restored = manager.state.value.nowPlayingEntries
        assertEquals(song10.key, restored[1].item.key)
        assertEquals(song11.key, restored[2].item.key)
        assertEquals(6, restored.map { it.queueId }.distinct().size)
    }

    @Test
    fun `display metadata comes from real song release and anime context`() {
        val item = relatedSong(10)

        assertEquals("Related 10", item.display.title)
        assertEquals("Artist 10", item.display.artist)
        assertEquals("Release 10", item.display.album)
        assertEquals("Anime 10", item.display.animeTitle)
    }

    @Test
    fun `unshuffle from added related song duplicate preserves original occurrence`() {
        val song = relatedSong(10)
        manager.playItems("Mixed", listOf(PlayableItem.Theme(theme(1)), song, PlayableItem.Theme(theme(2))))
        val originalSongQueueId = manager.state.value.nowPlayingEntries[1].queueId
        manager.addPlayableItems(listOf(song))
        val copyQueueId = manager.state.value.nowPlayingEntries.last().queueId

        manager.toggleShuffle()
        manager.skipTo(manager.state.value.indexOfQueueId(copyQueueId))
        manager.toggleShuffle()

        val state = manager.state.value
        assertEquals(copyQueueId, state.currentEntry!!.queueId)
        assertEquals(
            setOf(originalSongQueueId, copyQueueId),
            state.nowPlayingEntries.filter { it.item.key == song.key }.map { it.queueId }.toSet()
        )
        assertEquals(4, state.nowPlayingEntries.size)
    }

    @Test
    fun `unskip follows exact duplicate theme occurrence through shuffle and unshuffle`() {
        val duplicate = PlayableItem.Theme(theme(1))
        manager.playItems("Duplicates", listOf(duplicate, PlayableItem.Theme(theme(2)), duplicate))
        val unskippedQueueId = manager.state.value.nowPlayingEntries.last().queueId

        manager.unskip(2)
        manager.toggleShuffle()
        assertEquals(setOf(unskippedQueueId), manager.state.value.unskippedEntryIds)
        assertEquals(
            listOf(unskippedQueueId),
            manager.state.value.unskippedIndices.map { manager.state.value.nowPlayingEntries[it].queueId }
        )

        manager.toggleShuffle()
        assertEquals(setOf(unskippedQueueId), manager.state.value.unskippedEntryIds)
        assertEquals(
            listOf(unskippedQueueId),
            manager.state.value.unskippedIndices.map { manager.state.value.nowPlayingEntries[it].queueId }
        )
    }

    @Test
    fun `unskip follows exact duplicate song occurrence through shuffle and unshuffle`() {
        val duplicate = relatedSong(10)
        manager.playItems("Duplicates", listOf(duplicate, PlayableItem.Theme(theme(2)), duplicate))
        val unskippedQueueId = manager.state.value.nowPlayingEntries.last().queueId

        manager.unskip(2)
        manager.toggleShuffle()
        manager.toggleShuffle()

        val state = manager.state.value
        assertEquals(setOf(unskippedQueueId), state.unskippedEntryIds)
        assertEquals(
            listOf(unskippedQueueId),
            state.unskippedIndices.map { state.nowPlayingEntries[it].queueId }
        )
    }

    @Test
    fun `mixed history and rewind preserve song occurrence identity`() {
        val song = relatedSong(10)
        manager.playItems("Mixed", listOf(PlayableItem.Theme(theme(1)), song, PlayableItem.Theme(theme(2))))
        val songQueueId = manager.state.value.nowPlayingEntries[1].queueId
        val lastQueueId = manager.state.value.nowPlayingEntries[2].queueId

        manager.onTrackChangedByQueueId(lastQueueId)
        assertEquals(
            listOf(PlayableKind.THEME, PlayableKind.SONG),
            manager.state.value.historyEntries.map { it.item.key.kind }
        )

        manager.rewindTo(1)
        assertEquals(songQueueId, manager.state.value.currentEntry!!.queueId)
        assertEquals(PlayableKind.SONG, manager.state.value.currentItem!!.key.kind)
    }

    @Test
    fun `explicit mixed add removes suggested song occurrences`() {
        val suggestedSong = relatedSong(10)
        manager.playItems(
            "Mixed",
            listOf(PlayableItem.Theme(theme(1)), PlayableItem.Theme(theme(2)), suggestedSong),
            suggestedFrom = 2
        )
        val suggestedQueueId = manager.state.value.suggestedEntryIds.single()

        manager.addPlayableItems(listOf(relatedSong(11)))

        val state = manager.state.value
        assertTrue(suggestedQueueId !in state.nowPlayingEntries.map { it.queueId })
        assertTrue(state.suggestedEntryIds.isEmpty())
        assertEquals(listOf(PlayableKind.THEME, PlayableKind.THEME, PlayableKind.SONG), state.nowPlayingItems.map { it.key.kind })
        assertEquals(11L, state.nowPlayingItems.last().key.id)
    }

    @Test
    fun `repeated mixed Play Next stacks blocks newest first and preserves block order`() {
        manager.playItems("Mixed", listOf(PlayableItem.Theme(theme(1)), PlayableItem.Theme(theme(2))))
        manager.playNextItems(listOf(relatedSong(10), relatedSong(11)))
        manager.playNextItems(listOf(relatedSong(12), relatedSong(13)))

        assertEquals(
            listOf(
                PlayableKey(PlayableKind.THEME, 1),
                PlayableKey(PlayableKind.SONG, 12),
                PlayableKey(PlayableKind.SONG, 13),
                PlayableKey(PlayableKind.SONG, 10),
                PlayableKey(PlayableKind.SONG, 11),
                PlayableKey(PlayableKind.THEME, 2)
            ),
            manager.state.value.nowPlayingItems.map { it.key }
        )
    }

    private fun theme(id: Long) = ThemeEntity(
        id = id,
        animeId = id,
        title = "Theme $id",
        artistName = "Artist $id",
        audioUrl = "https://example.com/theme-$id.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    )

    private fun relatedSong(id: Long): PlayableItem.RelatedSong {
        val anime = AnimeEntity(
            kitsuId = "kitsu-$id",
            animeThemesId = id,
            title = "Anime $id",
            thumbnailUrl = null,
            coverUrl = null,
            syncedAt = 0
        )
        return PlayableItem.RelatedSong(
            song = SongEntity(
                id = id,
                title = "Related $id",
                artistCredit = "Artist $id",
                audioUrl = "https://example.com/song-$id.flac"
            ),
            release = MusicReleaseEntity(
                id = id,
                title = "Release $id",
                artistCredit = "Artist $id"
            ),
            anime = anime,
            relationshipType = "soundtrack"
        )
    }
}
