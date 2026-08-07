package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.DownloadItemDao
import com.takeya.animeongaku.download.DownloadBatchCursor
import com.takeya.animeongaku.download.downloadBatchCursorAfter
import java.lang.reflect.Proxy
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DownloadBatchCursorTest {
    @Test
    fun `cursor continues after the last created-at media-key pair in a batch`() {
        val batch = listOf(
            downloadItem(mediaKey = "THEME:1:TV_SIZE", createdAt = 100L),
            downloadItem(mediaKey = "THEME:2:TV_SIZE", createdAt = 100L)
        )

        assertEquals(
            DownloadBatchCursor(createdAt = 100L, mediaKey = "THEME:2:TV_SIZE"),
            downloadBatchCursorAfter(batch)
        )
    }

    @Test
    fun `empty batch has no continuation cursor`() {
        assertNull(downloadBatchCursorAfter(emptyList()))
    }

    @Test
    fun `batch lookup receives a bounded created-at and media-key cursor`() = runBlocking {
        var received: Array<out Any?>? = null
        val dao = Proxy.newProxyInstance(
            DownloadItemDao::class.java.classLoader,
            arrayOf(DownloadItemDao::class.java)
        ) { _, method, args ->
            if (method.name == "getNextBatchAfter") {
                received = args
                emptyList<DownloadItemEntity>()
            } else {
                error("Unexpected DAO call: ${method.name}")
            }
        } as DownloadItemDao

        dao.getNextBatchAfter(cursorCreatedAt = 100L, cursorMediaKey = "THEME:2:TV_SIZE", limit = 6)

        assertEquals(listOf(100L, "THEME:2:TV_SIZE", 6), received!!.take(3))
    }

    private fun downloadItem(mediaKey: String, createdAt: Long) = DownloadItemEntity(
        mediaKey = mediaKey,
        itemType = "THEME",
        itemId = 1L,
        mode = "TV_SIZE",
        status = DownloadItemEntity.STATUS_PENDING,
        createdAt = createdAt,
        updatedAt = createdAt
    )
}
