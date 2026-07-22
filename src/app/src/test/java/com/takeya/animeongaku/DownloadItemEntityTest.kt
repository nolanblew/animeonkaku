package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.DownloadItemEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadItemEntityTest {
    @Test
    fun `full size and related song share one canonical audio key`() {
        assertEquals(
            DownloadItemEntity.songMediaKey(300),
            DownloadItemEntity.fullSizeMediaKey(themeId = 100, songId = 300)
        )
        assertEquals("SONG:300:AUDIO", DownloadItemEntity.fullSizeMediaKey(100, 300))
    }
}
