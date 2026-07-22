package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.repository.MusicOwner
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlayableKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MusicCatalogModelsTest {
    @Test
    fun `related catalog track retains stable song identity and anime ownership`() {
        val track = RelatedTrack(
            song = SongEntity(9001, "Full song", "Artist", audioUrl = "/v1/media/songs/9001"),
            release = MusicReleaseEntity(44, "Original soundtrack", "Artist"),
            relationshipType = "SOUNDTRACK",
            owner = MusicOwner("48649", "Frieren", "poster")
        )

        val playable = PlayableItem.RelatedSong(track.song, track.release, track.asAnimeEntity(), track.relationshipType)

        assertEquals(PlayableKind.SONG, playable.key.kind)
        assertEquals(9001L, playable.key.id)
        assertEquals("48649", playable.anime?.kitsuId)
        assertEquals("Original soundtrack", playable.display.album)
        assertTrue(playable.remoteAudioUrl.endsWith("/9001"))
    }
}
