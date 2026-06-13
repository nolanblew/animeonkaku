package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.DownloadRequestEntity
import com.takeya.animeongaku.download.downloadFailureStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadRetryStatusTest {
    @Test
    fun `failed download with remaining attempts is retrying`() {
        assertEquals(
            DownloadRequestEntity.STATUS_RETRYING,
            downloadFailureStatus(runAttemptCount = 0, maxAttempts = 3)
        )
    }

    @Test
    fun `failed download on final attempt is failed`() {
        assertEquals(
            DownloadRequestEntity.STATUS_FAILED,
            downloadFailureStatus(runAttemptCount = 2, maxAttempts = 3)
        )
    }
}
