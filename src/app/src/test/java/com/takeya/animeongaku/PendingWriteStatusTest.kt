package com.takeya.animeongaku

import com.takeya.animeongaku.sync.SyncPushResult
import com.takeya.animeongaku.sync.pendingWriteStatusMessage
import com.takeya.animeongaku.sync.pendingWritesNeedRetry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingWriteStatusTest {
    @Test
    fun `successful flush result does not request retry`() {
        assertFalse(pendingWritesNeedRetry(SyncPushResult(opCount = 1, playCount = 0, failed = false)))
    }

    @Test
    fun `retained pending failure requests retry`() {
        assertTrue(pendingWritesNeedRetry(SyncPushResult(opCount = 0, playCount = 0, failed = true)))
    }

    @Test
    fun `no pending playlist writes has no message`() {
        assertNull(pendingWriteStatusMessage(pendingCount = 0, retriedCount = 0, isOnline = true))
    }

    @Test
    fun `offline playlist writes explain they are saved locally`() {
        assertEquals(
            "Saved on this phone. 2 playlist changes will sync when you're back online.",
            pendingWriteStatusMessage(pendingCount = 2, retriedCount = 0, isOnline = false)
        )
    }

    @Test
    fun `retried playlist writes explain server retry`() {
        assertEquals(
            "Saved on this phone. Retrying 1 playlist change with the server.",
            pendingWriteStatusMessage(pendingCount = 1, retriedCount = 1, isOnline = true)
        )
    }
}
