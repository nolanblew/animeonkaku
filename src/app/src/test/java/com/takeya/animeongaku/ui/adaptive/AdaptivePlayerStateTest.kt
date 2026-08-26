package com.takeya.animeongaku.ui.adaptive

import org.junit.Assert.assertEquals
import org.junit.Test

class AdaptivePlayerStateTest {

    @Test
    fun `compact player opens full screen and back collapses it`() {
        val layout = AdaptiveLayoutPolicy.forWidth(411)

        val opened = AdaptivePlayerState.Collapsed.open(layout)

        assertEquals(AdaptivePlayerState.FullScreen, opened)
        assertEquals(AdaptivePlayerState.Collapsed, opened.back(layout))
    }

    @Test
    fun `foldable player opens at the side and can expand then return`() {
        val layout = AdaptiveLayoutPolicy.forWidth(720)

        val side = AdaptivePlayerState.Collapsed.open(layout)
        val fullScreen = side.expandToFullScreen()

        assertEquals(AdaptivePlayerState.SidePanel, side)
        assertEquals(AdaptivePlayerState.FullScreen, fullScreen)
        assertEquals(AdaptivePlayerState.SidePanel, fullScreen.back(layout))
        assertEquals(AdaptivePlayerState.Collapsed, side.back(layout))
    }

    @Test
    fun `folding a device reconciles an open side panel to full screen`() {
        val compact = AdaptiveLayoutPolicy.forWidth(411)

        assertEquals(
            AdaptivePlayerState.FullScreen,
            AdaptivePlayerState.SidePanel.reconcile(compact)
        )
    }

    @Test
    fun `unfolding preserves an intentionally full screen player`() {
        val foldable = AdaptiveLayoutPolicy.forWidth(720)

        assertEquals(
            AdaptivePlayerState.FullScreen,
            AdaptivePlayerState.FullScreen.reconcile(foldable)
        )
    }

    @Test
    fun `opening an already visible player is idempotent`() {
        val foldable = AdaptiveLayoutPolicy.forWidth(720)

        assertEquals(
            AdaptivePlayerState.SidePanel,
            AdaptivePlayerState.SidePanel.open(foldable)
        )
        assertEquals(
            AdaptivePlayerState.FullScreen,
            AdaptivePlayerState.FullScreen.open(foldable)
        )
    }
}
