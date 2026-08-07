package com.takeya.animeongaku

import com.takeya.animeongaku.sync.OfflineSync
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineSyncTest {

    @Test
    fun `incoming applies when nothing local`() {
        assertTrue(OfflineSync.shouldApplyIncoming(incomingTs = 1000, localTs = null))
    }

    @Test
    fun `newer incoming wins`() {
        assertTrue(OfflineSync.shouldApplyIncoming(incomingTs = 2000, localTs = 1000))
    }

    @Test
    fun `stale incoming does not clobber a newer local offline edit`() {
        // Local edit at 2000 not yet synced; a stale server pull from 1000 must be ignored.
        assertFalse(OfflineSync.shouldApplyIncoming(incomingTs = 1000, localTs = 2000))
    }

    @Test
    fun `tie favors incoming for idempotent reconcile`() {
        assertTrue(OfflineSync.shouldApplyIncoming(incomingTs = 1500, localTs = 1500))
    }

    @Test
    fun `temp ids are negative and remap to server ids`() {
        val temp = OfflineSync.tempIdFrom(System.nanoTime())
        assertTrue(OfflineSync.isTempId(temp))
        assertFalse(OfflineSync.isTempId(42))

        val entries = listOf(temp, 5L, temp, 9L)
        assertEquals(listOf(100L, 5L, 100L, 9L), OfflineSync.remapId(entries, temp, 100L))
    }

    @Test
    fun `allocated temp ids stay negative and unique across rapid creates`() {
        val first = OfflineSync.nextTempId()
        val second = OfflineSync.nextTempId()

        assertTrue(first < 0L)
        assertTrue(second < 0L)
        assertTrue(first != second)
    }
}
