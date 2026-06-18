package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.sync.planThemePrefApply
import org.junit.Assert.assertEquals
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
}
