package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.LoudnessProfile
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.remote.OngakuTopPickDto
import com.takeya.animeongaku.data.remote.OngakuTopPicksResponse
import com.takeya.animeongaku.data.repository.canRetainFullTopPicks
import com.takeya.animeongaku.data.repository.isCompleteTopPicksResponse
import com.takeya.animeongaku.data.repository.mergeTopPicksPreview
import com.takeya.animeongaku.data.repository.withReadyTopPickTvSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeTopPicksCachePolicyTest {
    @Test
    fun `small full response is complete but empty startup response is retried`() {
        assertTrue(isCompleteTopPicksResponse(response("token", 3, listOf("1", "2", "3")), 60))
        assertFalse(isCompleteTopPicksResponse(response("token", 0, emptyList()), 60))
        assertFalse(isCompleteTopPicksResponse(response("token", 3, listOf("1", "2")), 60))
    }

    @Test
    fun `preview retains full membership only for the same coherent prefix`() {
        val full = response("token", 4, listOf("1", "2", "3", "4"))

        assertTrue(canRetainFullTopPicks(full, response("token", 4, listOf("1", "2")), 60))
        assertFalse(canRetainFullTopPicks(full, response("new-token", 4, listOf("1", "2")), 60))
        assertFalse(canRetainFullTopPicks(full, response("token", 3, listOf("1", "2")), 60))
        assertFalse(canRetainFullTopPicks(full, response("token", 4, listOf("2", "1")), 60))
    }

    @Test
    fun `coherent preview replaces prefix metadata while preserving cached tail`() {
        val full = response("token", 4, listOf("1", "2", "3", "4"))
        val preview = response("token", 4, listOf("1", "2")).copy(
            items = response("token", 4, listOf("1", "2")).items.map { it.copy(reason = "FRESH") }
        )

        val merged = mergeTopPicksPreview(full, preview, 60)

        assertEquals(listOf("1", "2", "3", "4"), merged.items.map { it.key })
        assertEquals(listOf("FRESH", "FRESH", "DISCOVERY", "DISCOVERY"), merged.items.map { it.reason })
    }

    @Test
    fun `non-ready theme cannot expose a TV audio candidate while full remains playable`() {
        val descriptor = ThemeModeEntity(
            themeId = 1,
            tvSizeUrl = "https://server/theme/1",
            tvSizeDurationSeconds = 90,
            tvSizeFileSize = 100,
            fullSizeSongId = 10,
            fullSizeUrl = "https://server/song/10",
            tvSizeLoudness = LoudnessProfile(gainDb = -2.0, state = "READY")
        )

        val unavailableTv = descriptor.withReadyTopPickTvSize("UNAVAILABLE")

        assertEquals("", unavailableTv.tvSizeUrl)
        assertEquals(null, unavailableTv.tvSizeDurationSeconds)
        assertEquals(null, unavailableTv.tvSizeLoudness)
        assertEquals("https://server/song/10", unavailableTv.fullSizeUrl)
    }

    private fun response(snapshot: String, total: Int, keys: List<String>) = OngakuTopPicksResponse(
        serverTime = 1,
        snapshot = snapshot,
        generatedAt = 1,
        expiresAt = Long.MAX_VALUE,
        total = total,
        items = keys.mapIndexed { index, key ->
            OngakuTopPickDto(key, "THEME", index.toLong(), "DISCOVERY")
        }
    )
}
