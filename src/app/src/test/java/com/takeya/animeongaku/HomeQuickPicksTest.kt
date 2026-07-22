package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.data.repository.MusicOwner
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.ui.home.assembleHomeQuickPicks
import com.takeya.animeongaku.ui.home.eligibleHomeRelatedTracks
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
}
