package com.takeya.animeongaku.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationRoutesTest {

    @Test
    fun `anime detail route shows library badges by default`() {
        assertEquals("animeDetail/123?showLibraryBadges=true", animeDetailRoute("123"))
    }

    @Test
    fun `anime detail route can suppress library badges`() {
        assertEquals(
            "animeDetail/123?showLibraryBadges=false",
            animeDetailRoute("123", showLibraryBadges = false)
        )
    }

    @Test
    fun `artist detail route encodes names and preserves badge mode`() {
        assertEquals(
            "artistDetail/Yoko%20Kanno?showLibraryBadges=false",
            artistDetailRoute("Yoko Kanno", showLibraryBadges = false)
        )
    }
}
