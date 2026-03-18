package com.takeya.animeongaku.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.calculateTargetValue
import androidx.compose.animation.splineBasedDecay
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun PlayerContainer(
    isExpanded: Boolean,
    onExpand: () -> Unit,
    onCollapse: () -> Unit,
    showMiniPlayer: Boolean,
    modifier: Modifier = Modifier,
    bottomPadding: Dp = 0.dp,
    onOpenAnime: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {}
) {
    if (!showMiniPlayer && !isExpanded) return

    val density = LocalDensity.current

    var swipeUpTrigger by remember { mutableStateOf(false) }

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val screenHeightPx = constraints.maxHeight.toFloat()
        val miniPlayerHeightPx = with(density) { 64.dp.toPx() }
        val bottomPaddingPx = with(density) { bottomPadding.toPx() }

        val minOffset = 0f
        val maxOffset = screenHeightPx - miniPlayerHeightPx - bottomPaddingPx

        val offsetY = remember { Animatable(if (isExpanded) minOffset else maxOffset) }
        val coroutineScope = rememberCoroutineScope()

        LaunchedEffect(isExpanded, maxOffset) {
            val target = if (isExpanded) minOffset else maxOffset
            if (offsetY.targetValue != target) {
                if (isExpanded || offsetY.value == offsetY.targetValue) {
                    if (offsetY.value != minOffset && !isExpanded) {
                        offsetY.snapTo(target)
                    } else {
                        offsetY.animateTo(target)
                    }
                } else {
                     offsetY.animateTo(target)
                }
            }
        }

        val decay = splineBasedDecay<Float>(density)

        val progress = if (maxOffset > minOffset) {
            1f - ((offsetY.value - minOffset) / (maxOffset - minOffset)).coerceIn(0f, 1f)
        } else 0f

        val draggableState = rememberDraggableState { delta ->
            coroutineScope.launch {
                if (offsetY.value <= minOffset && delta < -5f) {
                    swipeUpTrigger = true
                } else {
                    offsetY.snapTo((offsetY.value + delta).coerceIn(minOffset, maxOffset))
                }
            }
        }

        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .height(with(density) { constraints.maxHeight.toDp() })
                .offset { IntOffset(0, offsetY.value.roundToInt()) }
                .clip(
                    object : Shape {
                        override fun createOutline(
                            size: Size,
                            layoutDirection: LayoutDirection,
                            density: Density
                        ): Outline {
                            val currentHeight = miniPlayerHeightPx + (size.height - miniPlayerHeightPx) * progress
                            return Outline.Rectangle(Rect(0f, 0f, size.width, currentHeight))
                        }
                    }
                )
                .draggable(
                    state = draggableState,
                    orientation = Orientation.Vertical,
                    onDragStopped = { velocity ->
                        val targetOffset = decay.calculateTargetValue(offsetY.value, velocity)
                        val shouldExpand = targetOffset < (maxOffset + minOffset) / 2
                        if (shouldExpand) {
                            coroutineScope.launch { offsetY.animateTo(minOffset, initialVelocity = velocity) }
                            onExpand()
                        } else {
                            coroutineScope.launch { offsetY.animateTo(maxOffset, initialVelocity = velocity) }
                            onCollapse()
                        }
                    }
                )
        ) {
            PlayerScreen(
                progress = progress,
                swipeUpTrigger = swipeUpTrigger,
                onSwipeUpHandled = { swipeUpTrigger = false },
                onExpand = {
                    coroutineScope.launch { offsetY.animateTo(minOffset) }
                    onExpand()
                },
                onCollapse = {
                    coroutineScope.launch { offsetY.animateTo(maxOffset) }
                    onCollapse()
                },
                onOpenAnime = onOpenAnime,
                onOpenArtist = onOpenArtist
            )
        }
    }
}
