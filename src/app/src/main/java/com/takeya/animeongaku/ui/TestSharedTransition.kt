package com.takeya.animeongaku.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.core.SeekableTransitionState
import androidx.compose.animation.core.rememberTransition
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun TestSharedTransition() {
    val state = remember { SeekableTransitionState(false) }
    val transition = rememberTransition(state)
    
    SharedTransitionLayout {
        transition.AnimatedContent(
            contentKey = { it }
        ) { expanded ->
            if (expanded) {
                // Expanded
            } else {
                // Collapsed
            }
        }
    }
}
