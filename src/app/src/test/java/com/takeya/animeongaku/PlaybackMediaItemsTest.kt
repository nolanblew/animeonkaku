package com.takeya.animeongaku

import androidx.media3.common.MediaItem
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.playbackUriString
import com.takeya.animeongaku.media.rewriteServerMediaUrl
import com.takeya.animeongaku.media.withArtworkData
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackMediaItemsTest {

    @Test
    fun `withArtworkData copies supplied bytes`() {
        val bytes = byteArrayOf(7, 8, 9)
        val item = MediaItem.Builder()
            .setMediaId("queue-1")
            .build()
            .withArtworkData(bytes)

        bytes[0] = 0

        assertArrayEquals(byteArrayOf(7, 8, 9), item.mediaMetadata.artworkData)
    }

    @Test
    fun `server audio url is used when theme is not downloaded`() {
        val item = theme(
            audioUrl = "http://192.168.1.5:8080/api/v1/media/audio/100",
            isDownloaded = false,
            localFilePath = null
        )

        assertEquals(
            "http://192.168.1.5:8080/api/v1/media/audio/100",
            item.playbackUriString()
        )
    }

    @Test
    fun `stale server media url is rewritten to active server base`() {
        val item = theme(
            audioUrl = "http://127.0.0.1:8080/v1/media/audio/100",
            isDownloaded = false,
            localFilePath = null
        )

        assertEquals(
            "http://192.168.173.121:8080/v1/media/audio/100",
            item.playbackUriString("http://192.168.173.121:8080/")
        )
    }

    @Test
    fun `stale artwork media url is rewritten to active server base`() {
        assertEquals(
            "http://192.168.173.121:8080/v1/media/images/anime/4676/cover",
            rewriteServerMediaUrl(
                url = "http://127.0.0.1:8080/v1/media/images/anime/4676/cover",
                activeServerBaseUrl = "http://192.168.173.121:8080/"
            )
        )
    }

    @Test
    fun `non server artwork url is not rewritten`() {
        assertEquals(
            "https://img.example.test/poster.jpg",
            rewriteServerMediaUrl(
                url = "https://img.example.test/poster.jpg",
                activeServerBaseUrl = "http://192.168.173.121:8080/"
            )
        )
    }

    @Test
    fun `server media query is preserved when url is rewritten`() {
        assertEquals(
            "http://192.168.173.121:8080/v1/media/images/anime/4676/cover?size=large",
            rewriteServerMediaUrl(
                url = "http://127.0.0.1:8080/v1/media/images/anime/4676/cover?size=large",
                activeServerBaseUrl = "http://192.168.173.121:8080/"
            )
        )
    }

    @Test
    fun `server media path relative url is rewritten`() {
        assertEquals(
            "http://192.168.173.121:8080/v1/media/images/anime/4676/cover",
            rewriteServerMediaUrl(
                url = "/v1/media/images/anime/4676/cover",
                activeServerBaseUrl = "http://192.168.173.121:8080/"
            )
        )
    }

    @Test
    fun `invalid active server base leaves media url unchanged`() {
        assertEquals(
            "http://127.0.0.1:8080/v1/media/images/anime/4676/cover",
            rewriteServerMediaUrl(
                url = "http://127.0.0.1:8080/v1/media/images/anime/4676/cover",
                activeServerBaseUrl = "not a url"
            )
        )
    }

    @Test
    fun `blank active server base leaves media url unchanged`() {
        assertEquals(
            "http://127.0.0.1:8080/v1/media/images/anime/4676/cover",
            rewriteServerMediaUrl(
                url = "http://127.0.0.1:8080/v1/media/images/anime/4676/cover",
                activeServerBaseUrl = null
            )
        )
    }

    @Test
    fun `active server base with path keeps base path`() {
        assertEquals(
            "http://192.168.173.121:8080/api/v1/media/images/anime/4676/cover",
            rewriteServerMediaUrl(
                url = "http://127.0.0.1:8080/v1/media/images/anime/4676/cover",
                activeServerBaseUrl = "http://192.168.173.121:8080/api/"
            )
        )
    }

    @Test
    fun `downloaded local file wins over server audio url`() {
        val item = theme(
            audioUrl = "http://192.168.1.5:8080/api/v1/media/audio/100",
            isDownloaded = true,
            localFilePath = "/storage/emulated/0/Music/100.webm"
        )

        assertEquals(
            "file:///storage/emulated/0/Music/100.webm",
            item.playbackUriString()
        )
    }

    private fun theme(
        audioUrl: String,
        isDownloaded: Boolean,
        localFilePath: String?
    ) = ThemeEntity(
        id = 100L,
        animeId = null,
        title = "Song",
        artistName = "Artist",
        audioUrl = audioUrl,
        videoUrl = null,
        isDownloaded = isDownloaded,
        localFilePath = localFilePath
    )
}
