package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.remote.OngakuAnimeDto
import com.takeya.animeongaku.data.remote.OngakuThemeArtistDto
import com.takeya.animeongaku.data.remote.OngakuThemeDto
import com.takeya.animeongaku.data.remote.OngakuThemeMediaModesDto
import com.takeya.animeongaku.data.remote.OngakuTvSizeModeDto
import com.takeya.animeongaku.data.remote.OngakuFullSizeModeDto
import com.takeya.animeongaku.data.remote.OngakuVideoModeDto
import com.takeya.animeongaku.data.remote.OngakuAnimeMusicDto
import com.takeya.animeongaku.data.remote.OngakuMusicAnimeSummaryDto
import com.takeya.animeongaku.data.remote.OngakuMusicReleaseDto
import com.takeya.animeongaku.data.remote.OngakuMusicTrackDto
import com.takeya.animeongaku.sync.resolveServerUrl
import com.takeya.animeongaku.sync.toAnimeEntity
import com.takeya.animeongaku.sync.toArtistCrossRefs
import com.takeya.animeongaku.sync.toGenreRows
import com.takeya.animeongaku.sync.toThemeEntity
import com.takeya.animeongaku.sync.toThemeModeEntity
import com.takeya.animeongaku.sync.toMusicCatalogSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryPullMapperTest {
    private val baseUrl = "http://192.168.1.5:8080/api/"

    @Test
    fun `resolves relative server media urls against configured base path`() {
        assertEquals(
            "http://192.168.1.5:8080/api/v1/media/audio/100",
            resolveServerUrl(baseUrl, "/v1/media/audio/100")
        )
        assertEquals(
            "https://cdn.example.test/file.webp",
            resolveServerUrl(baseUrl, "https://cdn.example.test/file.webp")
        )
        assertNull(resolveServerUrl(baseUrl, null))
    }

    @Test
    fun `maps anime dto to local entity with server artwork urls`() {
        val entity = animeDto().toAnimeEntity(baseUrl)

        assertEquals("1", entity.kitsuId)
        assertEquals(10L, entity.animeThemesId)
        assertEquals("Bocchi the Rock!", entity.title)
        assertEquals("http://192.168.1.5:8080/api/v1/media/images/anime/1/poster", entity.thumbnailUrl)
        assertEquals("http://192.168.1.5:8080/api/v1/media/images/anime/1/poster", entity.thumbnailUrlLarge)
        assertEquals("http://192.168.1.5:8080/api/v1/media/images/anime/1/cover", entity.coverUrl)
        assertEquals("current", entity.watchingStatus)
        assertFalse(entity.isManuallyAdded)
    }

    @Test
    fun `maps theme dto while preserving downloaded local file fields`() {
        val existing = ThemeEntity(
            id = 100L,
            animeId = 10L,
            title = "Old",
            artistName = "Old Artist",
            audioUrl = "https://old.example/audio.webm",
            videoUrl = null,
            isDownloaded = true,
            localFilePath = "/data/user/0/files/downloads/100.webm"
        )

        val entity = themeDto().toThemeEntity(baseUrl, existing)

        assertEquals(100L, entity.id)
        assertEquals(10L, entity.animeId)
        assertEquals("Seishun Complex", entity.title)
        assertEquals("Kessoku Band, Ikuyo Kita", entity.artistName)
        assertEquals("http://192.168.1.5:8080/api/v1/media/audio/100", entity.audioUrl)
        assertNull(entity.videoUrl)
        assertEquals("OP1", entity.themeType)
        assertTrue(entity.isDownloaded)
        assertEquals("/data/user/0/files/downloads/100.webm", entity.localFilePath)
    }

    @Test
    fun `maps theme modes by rebasing server audio but preserving direct video origin`() {
        val mode = themeDto().copy(
            mediaModes = OngakuThemeMediaModesDto(
                tvSize = OngakuTvSizeModeDto("/v1/media/audio/100", 90, 5_242_880),
                fullSize = OngakuFullSizeModeDto(300, "/v1/media/songs/300/audio", 271, 1234, 200),
                video = OngakuVideoModeDto(
                    "https://v.animethemes.moe/op.webm",
                    "video/webm",
                    spoiler = false,
                    nsfw = false,
                    entryVersion = 1
                )
            )
        ).toThemeModeEntity(baseUrl)

        assertEquals("http://192.168.1.5:8080/api/v1/media/audio/100", mode.tvSizeUrl)
        assertEquals("http://192.168.1.5:8080/api/v1/media/songs/300/audio", mode.fullSizeUrl)
        assertEquals("https://v.animethemes.moe/op.webm", mode.videoUrl)
    }

    @Test
    fun `maps ready music snapshot with resolved canonical urls and ordered junctions`() {
        val snapshot = listOf(
            OngakuAnimeMusicDto(
                anime = OngakuMusicAnimeSummaryDto(kitsuId = "1", title = "Bocchi"),
                releases = listOf(
                    OngakuMusicReleaseDto(
                        id = 200,
                        title = "OST",
                        artistCredit = "Composer",
                        relationshipType = "SOUNDTRACK",
                        artworkUrl = "/v1/media/images/releases/200",
                        tracks = listOf(
                            OngakuMusicTrackDto(
                                id = 300,
                                title = "Track",
                                artistCredit = "Composer",
                                audioUrl = "/v1/media/songs/300/audio",
                                discNumber = 1,
                                trackNumber = 2,
                                displayOrder = 4
                            )
                        )
                    )
                )
            )
        ).toMusicCatalogSnapshot(baseUrl)

        assertEquals("http://192.168.1.5:8080/api/v1/media/songs/300/audio", snapshot.songs.single().audioUrl)
        assertEquals("http://192.168.1.5:8080/api/v1/media/images/releases/200", snapshot.releases.single().artworkUrl)
        assertEquals(4, snapshot.releaseTracks.single().displayOrder)
        assertEquals("SOUNDTRACK", snapshot.animeReleases.single().relationshipType)
    }

    @Test
    fun `maps artist refs and genre rows`() {
        val artistRefs = themeDto().toArtistCrossRefs()
        val (genres, crossRefs) = animeDto().toGenreRows()

        assertEquals(2, artistRefs.size)
        assertEquals("Ikuyo Kita", artistRefs[1].artistName)
        assertEquals("as Ikuyo", artistRefs[1].asCharacter)
        assertEquals("Kita", artistRefs[1].alias)
        assertEquals(listOf("music", "slice-of-life"), genres.map { it.slug })
        assertEquals("Slice of Life", genres[1].displayName)
        assertEquals("1", crossRefs[0].kitsuId)
        assertEquals("music", crossRefs[0].slug)
    }

    private fun animeDto() = OngakuAnimeDto(
        kitsuId = "1",
        animeThemesId = 10L,
        title = "Bocchi the Rock!",
        titleEn = "Bocchi the Rock!",
        titleRomaji = null,
        titleJa = null,
        posterUrl = "/v1/media/images/anime/1/poster",
        coverUrl = "/v1/media/images/anime/1/cover",
        watchingStatus = "current",
        subtype = "TV",
        startDate = "2022-10-09",
        endDate = null,
        episodeCount = 12,
        ageRating = "PG",
        averageRating = 8.7,
        userRating = 9.0,
        libraryUpdatedAt = 1758000000000,
        slug = "bocchi-the-rock",
        genres = listOf("Music", "Slice of Life"),
        updatedAt = 1759000000000,
        deleted = false
    )

    private fun themeDto() = OngakuThemeDto(
        id = 100L,
        animeThemesAnimeId = 10L,
        kitsuAnimeIds = listOf("1"),
        title = "Seishun Complex",
        themeType = "OP1",
        artists = listOf(
            OngakuThemeArtistDto(name = "Kessoku Band", asCharacter = null, alias = null),
            OngakuThemeArtistDto(name = "Ikuyo Kita", asCharacter = "as Ikuyo", alias = "Kita")
        ),
        audioUrl = "/v1/media/audio/100",
        videoUrl = "https://cdn.example.test/Bocchi-OP1.webm",
        audioState = "READY",
        durationSeconds = 90,
        fileSize = 5_242_880,
        updatedAt = 1759000000000,
        deleted = false
    )
}
