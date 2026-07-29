package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.repository.MusicOwner
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.data.repository.toEntity
import com.takeya.animeongaku.data.remote.OngakuLocalizedNameDto
import com.takeya.animeongaku.data.remote.OngakuMusicTrackDto
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlayableKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MusicCatalogModelsTest {
    @Test
    fun `AMF localized catalog metadata is retained by Room entities`() {
        val song = OngakuMusicTrackDto(
            id = 7, title = "English Song", titleEnglish = "English Song", titleRomaji = "Romanized Song",
            titleJapanese = "日本語の歌", artistCredit = "English Artist",
            artistNames = listOf(OngakuLocalizedNameDto("English Artist", "Romanized Artist", "日本語の歌手")),
            audioUrl = "/v1/media/songs/7/audio"
        ).toEntity()

        assertEquals("English Song", song.titleEnglish)
        assertEquals("Romanized Song", song.titleRomaji)
        assertEquals("日本語の歌", song.titleJapanese)
        assertTrue(song.artistNamesJson.contains("Romanized Artist"))
    }

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
