package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.data.repository.MusicOwner
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.ui.home.assembleHomeQuickPicks
import com.takeya.animeongaku.ui.home.eligibleHomeRelatedTracks
import com.takeya.animeongaku.ui.home.filterHomeThemes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeQuickPicksTest {
    private fun track(
        songId: Long,
        relationship: String,
        audioUrl: String = "/v1/media/songs/$songId/audio",
        ownerId: String = "anime-$songId"
    ) = RelatedTrack(
        song = SongEntity(songId, "Song $songId", "Artist", audioUrl = audioUrl),
        release = MusicReleaseEntity(songId * 10, "Release $songId", "Artist"),
        relationshipType = relationship,
        owner = MusicOwner(ownerId, "Anime $songId", null)
    )

    @Test
    fun `soundtrack follows toggle while non soundtrack requires an active like`() {
        val ost = track(1, "SOUNDTRACK")
        val character = track(2, "CHARACTER")

        assertEquals(
            listOf(1L),
            eligibleHomeRelatedTracks(listOf(ost, character), emptyList(), true, emptySet()).map { it.song.id }
        )
        assertTrue(eligibleHomeRelatedTracks(listOf(ost, character), emptyList(), false, emptySet()).isEmpty())
        assertEquals(
            listOf(2L),
            eligibleHomeRelatedTracks(
                listOf(ost, character),
                listOf(SongPreferenceEntity(2, isLiked = true)),
                false,
                emptySet()
            ).map { it.song.id }
        )
    }

    @Test
    fun `dislike wins and tombstoned like does not admit related song`() {
        val ost = track(1, "SOUNDTRACK")
        val insert = track(2, "INSERT")
        val preferences = listOf(
            SongPreferenceEntity(1, isDisliked = true),
            SongPreferenceEntity(2, isLiked = true, deletedAt = 99)
        )

        assertTrue(eligibleHomeRelatedTracks(listOf(ost, insert), preferences, true, emptySet()).isEmpty())
    }

    @Test
    fun `unready full size and duplicate song candidates are excluded deterministically`() {
        val firstOwner = track(1, "SOUNDTRACK", ownerId = "first")
        val duplicateOwner = track(1, "SOUNDTRACK", ownerId = "second")
        val fullSize = track(2, "SOUNDTRACK")
        val unready = track(3, "SOUNDTRACK", audioUrl = "")

        val result = eligibleHomeRelatedTracks(
            listOf(firstOwner, duplicateOwner, fullSize, unready),
            emptyList(),
            true,
            setOf(2L)
        )

        assertEquals(listOf(1L), result.map { it.song.id })
        assertEquals("first", result.single().owner.kitsuId)
    }

    @Test
    fun `mixed quick picks retain typed stable keys and songs`() {
        val related = track(9, "SOUNDTRACK")
        val picks = assembleHomeQuickPicks(emptyList<PlayableItem.Theme>(), listOf(related), emptySet())

        assertEquals("SONG:9", picks.single().stableKey)
        assertTrue(picks.single().item is PlayableItem.RelatedSong)
    }

    @Test
    fun `OP and ED chips hide songs while All remains mixed`() {
        val op = PlayableItem.Theme(theme(1, "Song A", "OP1"))
        val ed = PlayableItem.Theme(theme(2, "Song B", "ED2"))
        val related = track(9, "SOUNDTRACK")

        assertEquals(listOf(1L), filterHomeThemes(listOf(op.theme, ed.theme), "OPs").map { it.id })
        assertEquals(listOf(2L), filterHomeThemes(listOf(op.theme, ed.theme), "EDs").map { it.id })
        assertTrue(assembleHomeQuickPicks(listOf(op), listOf(related), emptySet(), selectedChip = "OPs").none {
            it.item is PlayableItem.RelatedSong
        })
        assertTrue(assembleHomeQuickPicks(listOf(op), listOf(related), emptySet(), selectedChip = null).any {
            it.item is PlayableItem.RelatedSong
        })
    }

    private fun theme(id: Long, title: String, type: String) =
        com.takeya.animeongaku.data.local.ThemeEntity(
            id = id,
            animeId = 10,
            title = title,
            artistName = null,
            audioUrl = "/themes/$id",
            videoUrl = null,
            isDownloaded = false,
            localFilePath = null,
            themeType = type
        )
}
