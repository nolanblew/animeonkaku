package com.takeya.animeongaku.ui.adaptive

import kotlin.math.roundToInt

enum class AdaptiveWindowSize {
    Compact,
    Medium,
    Expanded
}

enum class AdaptiveNavigation {
    BottomBar,
    Rail
}

enum class AdaptivePlayerPresentation {
    FullScreen,
    SidePanel
}

enum class AdaptivePlayerState {
    Collapsed,
    SidePanel,
    FullScreen;

    fun open(layout: AdaptiveLayoutInfo): AdaptivePlayerState = when (this) {
        SidePanel, FullScreen -> this
        Collapsed -> when (layout.playerPresentation) {
            AdaptivePlayerPresentation.FullScreen -> FullScreen
            AdaptivePlayerPresentation.SidePanel -> SidePanel
        }
    }

    fun expandToFullScreen(): AdaptivePlayerState = if (this == Collapsed) Collapsed else FullScreen

    fun back(layout: AdaptiveLayoutInfo): AdaptivePlayerState = when (this) {
        Collapsed -> Collapsed
        SidePanel -> Collapsed
        FullScreen -> if (layout.playerPresentation == AdaptivePlayerPresentation.SidePanel) {
            SidePanel
        } else {
            Collapsed
        }
    }

    fun reconcile(layout: AdaptiveLayoutInfo): AdaptivePlayerState = when {
        this == SidePanel && layout.playerPresentation == AdaptivePlayerPresentation.FullScreen -> FullScreen
        else -> this
    }
}

enum class AdaptiveContentKind {
    Browse,
    Form
}

data class AdaptiveLayoutInfo(
    val widthDp: Int,
    val windowSize: AdaptiveWindowSize,
    val navigation: AdaptiveNavigation,
    val playerPresentation: AdaptivePlayerPresentation,
    val playerPanelWidthDp: Int,
    val supportsTwoPaneDetails: Boolean
) {
    fun contentWidthDp(kind: AdaptiveContentKind): Int = minOf(
        widthDp,
        when (kind) {
            AdaptiveContentKind.Browse -> 1440
            AdaptiveContentKind.Form -> 960
        }
    )
}

object AdaptiveLayoutPolicy {
    private const val MediumBreakpointDp = 600
    private const val ExpandedBreakpointDp = 840
    private const val MinimumPlayerPanelWidthDp = 360
    private const val MaximumPlayerPanelWidthDp = 520
    private const val PlayerPanelWidthFraction = 0.46f

    fun forWidth(widthDp: Int): AdaptiveLayoutInfo {
        val safeWidth = widthDp.coerceAtLeast(0)
        val windowSize = when {
            safeWidth < MediumBreakpointDp -> AdaptiveWindowSize.Compact
            safeWidth < ExpandedBreakpointDp -> AdaptiveWindowSize.Medium
            else -> AdaptiveWindowSize.Expanded
        }
        val playerPresentation = if (windowSize == AdaptiveWindowSize.Compact) {
            AdaptivePlayerPresentation.FullScreen
        } else {
            AdaptivePlayerPresentation.SidePanel
        }

        return AdaptiveLayoutInfo(
            widthDp = safeWidth,
            windowSize = windowSize,
            navigation = if (windowSize == AdaptiveWindowSize.Expanded) {
                AdaptiveNavigation.Rail
            } else {
                AdaptiveNavigation.BottomBar
            },
            playerPresentation = playerPresentation,
            playerPanelWidthDp = if (playerPresentation == AdaptivePlayerPresentation.SidePanel) {
                (safeWidth * PlayerPanelWidthFraction)
                    .roundToInt()
                    .coerceIn(MinimumPlayerPanelWidthDp, MaximumPlayerPanelWidthDp)
            } else {
                safeWidth
            },
            supportsTwoPaneDetails = windowSize == AdaptiveWindowSize.Expanded
        )
    }
}
