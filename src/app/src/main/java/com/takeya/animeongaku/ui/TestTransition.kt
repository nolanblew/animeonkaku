package com.takeya.animeongaku.ui

import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.rememberTransition
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect

@Composable
fun TestTransition() {
    val state = remember { MutableTransitionState(false) }
    LaunchedEffect(Unit) {
        state.targetState = true
    }
}
