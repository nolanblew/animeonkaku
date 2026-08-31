package com.takeya.animeongaku

import com.takeya.animeongaku.ui.common.uniquePlaylistCoverGroups
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaylistCoverArtTest {
    @Test
    fun `playlist cover groups keep only unique image urls across tiles and fallbacks`() {
        assertEquals(
            listOf(
                listOf("cover-a", "thumb-a"),
                listOf("cover-b"),
                listOf("cover-c")
            ),
            uniquePlaylistCoverGroups(
                listOf(
                    listOf("cover-a", "thumb-a", "cover-a"),
                    listOf("cover-a", "cover-b"),
                    listOf("cover-b", "cover-c")
                )
            )
        )
    }
}
