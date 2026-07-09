package com.takeya.animeongaku

import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.filter.SortAttribute
import com.takeya.animeongaku.data.filter.SortDirection
import com.takeya.animeongaku.data.filter.SortKey
import com.takeya.animeongaku.data.filter.SortSpec
import com.takeya.animeongaku.data.filter.applyDynamicDeviceOverlay
import com.takeya.animeongaku.data.filter.buildDynamicOverlayContext
import com.takeya.animeongaku.data.filter.shouldApplyDynamicDeviceOverlay
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.ThemeEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DynamicPlaylistDeviceOverlayTest {
    @Test
    fun `downloaded OR liked filter narrows server superset using local device state`() {
        val tracks = listOf(track(1L), track(2L), track(3L))
        val filter = FilterNode.Or(listOf(FilterNode.Downloaded(), FilterNode.Liked()))
        val context = buildDynamicOverlayContext(
            tracks = tracks,
            anime = emptyList(),
            genreRefs = emptyList(),
            likedThemeIds = setOf(2L),
            dislikedThemeIds = emptySet(),
            downloadedThemeIds = setOf(1L),
            playCounts = emptyList(),
            nowMillis = 100L
        )

        val result = applyDynamicDeviceOverlay(tracks, filter, SortSpec.DEFAULT, context)

        assertEquals(listOf(1L, 2L), result.map { it.theme.id })
    }

    @Test
    fun `not downloaded filter narrows server superset to non downloaded tracks`() {
        val tracks = listOf(track(1L), track(2L), track(3L))
        val filter = FilterNode.Not(FilterNode.Downloaded())
        val context = buildDynamicOverlayContext(
            tracks = tracks,
            anime = emptyList(),
            genreRefs = emptyList(),
            likedThemeIds = emptySet(),
            dislikedThemeIds = emptySet(),
            downloadedThemeIds = setOf(2L),
            playCounts = emptyList(),
            nowMillis = 100L
        )

        val result = applyDynamicDeviceOverlay(tracks, filter, SortSpec.DEFAULT, context)

        assertEquals(listOf(1L, 3L), result.map { it.theme.id })
    }

    @Test
    fun `downloaded sort uses local device state for server managed auto playlists`() {
        val tracks = listOf(
            track(1L, "Charlie"),
            track(2L, "Bravo"),
            track(3L, "Alpha")
        )
        val sort = SortSpec(
            listOf(
                SortKey(SortAttribute.DOWNLOADED, SortDirection.ASC),
                SortKey(SortAttribute.TITLE, SortDirection.ASC)
            )
        )
        val context = buildDynamicOverlayContext(
            tracks = tracks,
            anime = emptyList(),
            genreRefs = emptyList(),
            likedThemeIds = emptySet(),
            dislikedThemeIds = emptySet(),
            downloadedThemeIds = setOf(1L, 3L),
            playCounts = emptyList(),
            nowMillis = 100L
        )

        val result = applyDynamicDeviceOverlay(tracks, null, sort, context)

        assertEquals(listOf(3L, 1L, 2L), result.map { it.theme.id })
    }

    @Test
    fun `overlay only applies to server managed auto specs with downloaded dimensions`() {
        val filter = FilterNode.Downloaded()
        val downloadedSort = SortSpec(listOf(SortKey(SortAttribute.DOWNLOADED)))
        val titleSort = SortSpec(listOf(SortKey(SortAttribute.TITLE)))

        assertTrue(shouldApplyDynamicDeviceOverlay(spec(serverManaged = true, mode = "AUTO"), filter, titleSort))
        assertTrue(shouldApplyDynamicDeviceOverlay(spec(serverManaged = true, mode = "AUTO"), null, downloadedSort))
        assertFalse(shouldApplyDynamicDeviceOverlay(spec(serverManaged = false, mode = "AUTO"), filter, titleSort))
        assertFalse(shouldApplyDynamicDeviceOverlay(spec(serverManaged = true, mode = "SNAPSHOT"), filter, titleSort))
        assertFalse(shouldApplyDynamicDeviceOverlay(spec(serverManaged = true, mode = "AUTO"), null, titleSort))
    }

    private fun track(id: Long, title: String = "Song $id"): PlaylistTrack =
        PlaylistTrack(
            theme = ThemeEntity(
                id = id,
                animeId = null,
                title = title,
                artistName = null,
                audioUrl = "https://example.com/$id.mp3",
                videoUrl = null,
                isDownloaded = false,
                localFilePath = null
            ),
            orderIndex = id.toInt()
        )

    private fun spec(serverManaged: Boolean, mode: String): DynamicPlaylistSpecEntity =
        DynamicPlaylistSpecEntity(
            playlistId = 77L,
            filterJson = """{"type":"downloaded"}""",
            mode = mode,
            createdMode = "SIMPLE",
            serverManaged = serverManaged
        )
}
