package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.ui.settings.DownloadBatchProgress
import com.takeya.animeongaku.ui.settings.nextDownloadBatchProgress
import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadBatchProgressTest {
    @Test
    fun `completed count rises while the batch total stays fixed`() {
        val initial = nextDownloadBatchProgress(
            DownloadBatchProgress(),
            listOf(item("a", "pending"), item("b", "downloading"), item("c", "pending"))
        )
        val oneCompleted = nextDownloadBatchProgress(
            initial,
            listOf(item("a", "completed"), item("b", "downloading"), item("c", "pending"))
        )
        val twoCompleted = nextDownloadBatchProgress(
            oneCompleted,
            listOf(item("a", "completed"), item("b", "completed"), item("c", "downloading"))
        )

        assertEquals(DownloadBatchProgress(totalCount = 3, completedCount = 0, mediaKeys = setOf("a", "b", "c")), initial)
        assertEquals(3, oneCompleted.totalCount)
        assertEquals(1, oneCompleted.completedCount)
        assertEquals(3, twoCompleted.totalCount)
        assertEquals(2, twoCompleted.completedCount)
    }

    @Test
    fun `new work joins an active batch and a later batch starts clean`() {
        val running = nextDownloadBatchProgress(
            DownloadBatchProgress(),
            listOf(item("a", "downloading"))
        )
        val expanded = nextDownloadBatchProgress(
            running,
            listOf(item("a", "completed"), item("b", "pending"))
        )
        val idle = nextDownloadBatchProgress(expanded, listOf(item("a", "completed"), item("b", "completed")))
        val next = nextDownloadBatchProgress(idle, listOf(item("c", "pending")))

        assertEquals(2, expanded.totalCount)
        assertEquals(1, expanded.completedCount)
        assertEquals(DownloadBatchProgress(), idle)
        assertEquals(DownloadBatchProgress(1, 0, setOf("c")), next)
    }

    private fun item(mediaKey: String, status: String) = DownloadItemEntity(
        mediaKey = mediaKey,
        itemType = "THEME",
        itemId = mediaKey.hashCode().toLong(),
        mode = "TV_SIZE",
        status = status,
        createdAt = 1,
        updatedAt = 1
    )
}
