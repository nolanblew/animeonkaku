package com.takeya.animeongaku.ui.adaptive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdaptiveLayoutPolicyTest {

    @Test
    fun `window size breakpoints match compact medium and expanded contracts`() {
        assertEquals(AdaptiveWindowSize.Compact, AdaptiveLayoutPolicy.forWidth(599).windowSize)
        assertEquals(AdaptiveWindowSize.Medium, AdaptiveLayoutPolicy.forWidth(600).windowSize)
        assertEquals(AdaptiveWindowSize.Medium, AdaptiveLayoutPolicy.forWidth(839).windowSize)
        assertEquals(AdaptiveWindowSize.Expanded, AdaptiveLayoutPolicy.forWidth(840).windowSize)
    }

    @Test
    fun `compact phones keep bottom navigation and full screen player`() {
        val layout = AdaptiveLayoutPolicy.forWidth(411)

        assertEquals(AdaptiveNavigation.BottomBar, layout.navigation)
        assertEquals(AdaptivePlayerPresentation.FullScreen, layout.playerPresentation)
        assertFalse(layout.supportsTwoPaneDetails)
    }

    @Test
    fun `open foldables keep familiar bottom navigation and use side player`() {
        val layout = AdaptiveLayoutPolicy.forWidth(720)

        assertEquals(AdaptiveNavigation.BottomBar, layout.navigation)
        assertEquals(AdaptivePlayerPresentation.SidePanel, layout.playerPresentation)
        assertEquals(360, layout.playerPanelWidthDp)
        assertFalse(layout.supportsTwoPaneDetails)
    }

    @Test
    fun `tablets use a rail side player and two pane detail capability`() {
        val layout = AdaptiveLayoutPolicy.forWidth(1024)

        assertEquals(AdaptiveNavigation.Rail, layout.navigation)
        assertEquals(AdaptivePlayerPresentation.SidePanel, layout.playerPresentation)
        assertEquals(471, layout.playerPanelWidthDp)
        assertTrue(layout.supportsTwoPaneDetails)
    }

    @Test
    fun `side player width stays usable from small foldables through desktop windows`() {
        assertEquals(360, AdaptiveLayoutPolicy.forWidth(600).playerPanelWidthDp)
        assertEquals(520, AdaptiveLayoutPolicy.forWidth(1600).playerPanelWidthDp)
    }

    @Test
    fun `browse and form routes receive different readable width caps`() {
        val compact = AdaptiveLayoutPolicy.forWidth(500)
        val expanded = AdaptiveLayoutPolicy.forWidth(1800)

        assertEquals(500, compact.contentWidthDp(AdaptiveContentKind.Browse))
        assertEquals(500, compact.contentWidthDp(AdaptiveContentKind.Form))
        assertEquals(1440, expanded.contentWidthDp(AdaptiveContentKind.Browse))
        assertEquals(960, expanded.contentWidthDp(AdaptiveContentKind.Form))
    }
}
