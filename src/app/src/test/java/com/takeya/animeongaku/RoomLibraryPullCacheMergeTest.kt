package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.sync.planThemePrefApply
import com.takeya.animeongaku.sync.autoPlaylistIdsToPrune
import com.takeya.animeongaku.sync.shouldApplyIncomingPlaylist
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomLibraryPullCacheMergeTest {
    @Test
    fun `play counts apply even when an older preference row is skipped`() {
        val plan = planThemePrefApply(
            preferences = listOf(
                UserPreferenceEntity(
                    themeId = 100L,
                    isLiked = true,
                    isDisliked = false,
                    updatedAt = 100L
                )
            ),
            playCounts = listOf(
                PlayCountEntity(
                    themeId = 100L,
                    playCount = 7,
                    lastPlayedAt = 150L
                )
            ),
            localById = mapOf(
                100L to UserPreferenceEntity(
                    themeId = 100L,
                    isLiked = false,
                    isDisliked = true,
                    updatedAt = 200L
                )
            )
        )

        assertEquals(emptyList<UserPreferenceEntity>(), plan.preferences)
        assertEquals(
            listOf(PlayCountEntity(themeId = 100L, playCount = 7, lastPlayedAt = 150L)),
            plan.playCounts
        )
    }

    @Test
    fun `incoming playlist applies only when it is at least as fresh as local state`() {
        val local = PlaylistEntity(
            id = 77L,
            name = "Local",
            createdAt = 1L,
            updatedAt = 200L
        )
        val olderIncoming = PlaylistEntity(
            id = 77L,
            name = "Older Server",
            createdAt = 1L,
            updatedAt = 100L
        )
        val fresherIncoming = PlaylistEntity(
            id = 77L,
            name = "Fresh Server",
            createdAt = 1L,
            updatedAt = 300L
        )

        assertFalse(shouldApplyIncomingPlaylist(olderIncoming, local))
        assertTrue(shouldApplyIncomingPlaylist(fresherIncoming, local))
        assertTrue(shouldApplyIncomingPlaylist(fresherIncoming, null))
    }

    @Test
    fun `full pull preserves pending dynamic drafts but prunes missing established playlists`() {
        val pruned = autoPlaylistIdsToPrune(
            localAutoIds = listOf(10L, -20L, 30L, 40L),
            serverAutoIds = setOf(30L),
            protectedDynamicIds = setOf(-20L)
        )

        assertEquals(listOf(10L, 40L), pruned)
    }
}
