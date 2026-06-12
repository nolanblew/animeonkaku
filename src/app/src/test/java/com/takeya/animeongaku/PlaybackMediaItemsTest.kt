package com.takeya.animeongaku

import androidx.media3.common.MediaItem
import com.takeya.animeongaku.media.withArtworkData
import org.junit.Assert.assertArrayEquals
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
}
