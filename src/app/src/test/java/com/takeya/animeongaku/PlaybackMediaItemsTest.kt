package com.takeya.animeongaku

import androidx.media3.common.MediaItem
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.playbackUriString
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
