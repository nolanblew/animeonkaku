package com.takeya.animeongaku.ui.adaptive

import androidx.compose.runtime.staticCompositionLocalOf

val LocalAdaptiveLayoutInfo = staticCompositionLocalOf {
    AdaptiveLayoutPolicy.forWidth(0)
}
