package com.takeya.animeongaku

import com.takeya.animeongaku.data.remote.OngakuSyncStatusResponse
import com.takeya.animeongaku.sync.SyncPhase
import com.takeya.animeongaku.sync.toSyncState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerSyncStatusMapperTest {
    @Test
    fun `running server phases map to import sync phases`() {
        val fullSync = response(state = "RUNNING", phase = "KITSU_FULL_SYNC").toSyncState()
        val mapThemes = response(state = "RUNNING", phase = "MAP_THEMES").toSyncState()
        val backfill = response(state = "RUNNING", phase = "BACKFILL_SCAN").toSyncState()

        assertTrue(fullSync.isRunning)
        assertEquals(SyncPhase.SyncingLibrary, fullSync.phase)
        assertEquals("Server sync: syncing library", fullSync.status)
        assertEquals(SyncPhase.MappingThemes, mapThemes.phase)
        assertEquals(SyncPhase.Saving, backfill.phase)
    }

    @Test
    fun `terminal server states map to done idle and error`() {
        val done = response(state = "DONE", phase = "DONE", unmatched = listOf("missing")).toSyncState()
        val idle = response(state = "IDLE", phase = null).toSyncState()
        val failed = response(
            state = "FAILED",
            phase = "MAP_THEMES",
            progress = mapOf("error" to "upstream unavailable")
        ).toSyncState()

        assertFalse(done.isRunning)
        assertEquals(SyncPhase.Done, done.phase)
        assertEquals(listOf("missing"), done.unmatchedAnime)
        assertEquals(SyncPhase.Idle, idle.phase)
        assertEquals(SyncPhase.Error, failed.phase)
        assertEquals("Server sync failed: upstream unavailable", failed.errorMessage)
    }

    private fun response(
        state: String,
        phase: String?,
        progress: Map<String, Any?> = emptyMap(),
        unmatched: List<String> = emptyList()
    ) = OngakuSyncStatusResponse(
        state = state,
        phase = phase,
        progress = progress,
        lastCompletedAt = null,
        unmatched = unmatched
    )
}
