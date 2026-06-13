package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.DownloadRequestEntity
import com.takeya.animeongaku.download.downloadFailureStatus
import com.takeya.animeongaku.download.downloadFileExtension
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

    @Test
    fun `extensionless server media url uses default extension instead of host suffix`() {
        assertEquals(
            "ogg",
            downloadFileExtension(
                url = "http://127.0.0.1:8080/v1/media/audio/6663",
                defaultExtension = "ogg"
            )
        )
    }

    @Test
    fun `media url extension is read from path segment only`() {
        assertEquals(
            "webm",
            downloadFileExtension(
                url = "https://cdn.example.test/audio/theme.webm?token=abc",
                defaultExtension = "ogg"
            )
        )
    }
}
