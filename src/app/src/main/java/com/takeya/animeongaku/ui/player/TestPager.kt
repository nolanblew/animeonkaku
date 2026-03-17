package com.takeya.animeongaku.ui.player

import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerDefaults
import androidx.compose.foundation.pager.PagerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun TestPagerBehavior(state: PagerState) {
    HorizontalPager(
        state = state,
        modifier = Modifier,
        pageSpacing = 24.dp,
        flingBehavior = PagerDefaults.flingBehavior(
            state = state,
            snapPositionalThreshold = 0.8f
        )
    ) { page -> }
}
