package com.takeya.animeongaku.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.calculateTargetValue
import androidx.compose.animation.splineBasedDecay
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.takeya.animeongaku.ui.adaptive.AdaptiveLayoutInfo
import com.takeya.animeongaku.ui.adaptive.AdaptivePlayerPresentation
import com.takeya.animeongaku.ui.adaptive.AdaptivePlayerState
import com.takeya.animeongaku.ui.theme.Ink900
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

val MiniPlayerHeight = 64.dp

@Composable
fun PlayerContainer(
    state: AdaptivePlayerState,
    layoutInfo: AdaptiveLayoutInfo,
    onStateChange: (AdaptivePlayerState) -> Unit,
    showMiniPlayer: Boolean,
    modifier: Modifier = Modifier,
    bottomPadding: Dp = 0.dp,
    onOpenAnime: (String) -> Unit = {},
    onOpenRelatedMusic: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
    viewModel: PlayerViewModel = hiltViewModel()
) {
    if (!showMiniPlayer && state == AdaptivePlayerState.Collapsed) return

    when {
        state == AdaptivePlayerState.SidePanel -> WideSidePlayer(
            layoutInfo = layoutInfo,
            onDismiss = { onStateChange(AdaptivePlayerState.Collapsed) },
            onExpandToFullScreen = { onStateChange(state.expandToFullScreen()) },
            onOpenAnime = onOpenAnime,
            onOpenRelatedMusic = onOpenRelatedMusic,
            onOpenArtist = onOpenArtist,
            viewModel = viewModel,
            modifier = modifier
        )

        state == AdaptivePlayerState.Collapsed &&
            layoutInfo.playerPresentation == AdaptivePlayerPresentation.SidePanel -> WideMiniPlayer(
                layoutInfo = layoutInfo,
                onExpand = { onStateChange(state.open(layoutInfo)) },
                bottomPadding = bottomPadding,
                onOpenAnime = onOpenAnime,
                onOpenRelatedMusic = onOpenRelatedMusic,
                onOpenArtist = onOpenArtist,
                viewModel = viewModel,
                modifier = modifier
            )

        else -> VerticalPlayerContainer(
            isExpanded = state == AdaptivePlayerState.FullScreen,
            onExpand = { onStateChange(state.open(layoutInfo)) },
            onCollapse = { onStateChange(state.back(layoutInfo)) },
            showMiniPlayer = showMiniPlayer,
            bottomPadding = bottomPadding,
            onOpenAnime = onOpenAnime,
            onOpenRelatedMusic = onOpenRelatedMusic,
            onOpenArtist = onOpenArtist,
            viewModel = viewModel,
            modifier = modifier
        )
    }
}

@Composable
private fun WideMiniPlayer(
    layoutInfo: AdaptiveLayoutInfo,
    onExpand: () -> Unit,
    bottomPadding: Dp,
    onOpenAnime: (String) -> Unit,
    onOpenRelatedMusic: (String) -> Unit,
    onOpenArtist: (String) -> Unit,
    viewModel: PlayerViewModel,
    modifier: Modifier
) {
    val panelWidth = layoutInfo.playerPanelWidthDp.dp
    Box(modifier = modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(bottom = bottomPadding)
                .width(panelWidth)
                .height(MiniPlayerHeight)
        ) {
            PlayerScreen(
                progress = 0f,
                onExpand = onExpand,
                onCollapse = {},
                onOpenAnime = onOpenAnime,
                onOpenRelatedMusic = onOpenRelatedMusic,
                onOpenArtist = onOpenArtist,
                playerWidth = panelWidth,
                viewModel = viewModel
            )
        }
    }
}

@Composable
private fun WideSidePlayer(
    layoutInfo: AdaptiveLayoutInfo,
    onDismiss: () -> Unit,
    onExpandToFullScreen: () -> Unit,
    onOpenAnime: (String) -> Unit,
    onOpenRelatedMusic: (String) -> Unit,
    onOpenArtist: (String) -> Unit,
    viewModel: PlayerViewModel,
    modifier: Modifier
) {
    val outerWidth = layoutInfo.playerPanelWidthDp.dp
    val panelShape = RoundedCornerShape(topStart = 30.dp, bottomStart = 30.dp)
    Box(modifier = modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss
                )
        )
        Box(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .width(outerWidth)
                .fillMaxHeight()
                .shadow(32.dp, panelShape)
                .clip(panelShape)
                .background(Ink900)
        ) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                PlayerScreen(
                    progress = 1f,
                    onCollapse = onDismiss,
                    onRequestFullscreen = onExpandToFullScreen,
                    onOpenAnime = onOpenAnime,
                    onOpenRelatedMusic = onOpenRelatedMusic,
                    onOpenArtist = onOpenArtist,
                    playerWidth = maxWidth,
                    playerHeight = maxHeight,
                    minimumArtworkSize = 72.dp,
                    showQueueInline = true,
                    viewModel = viewModel
                )
            }
        }
    }
}

@Composable
private fun VerticalPlayerContainer(
    isExpanded: Boolean,
    onExpand: () -> Unit,
    onCollapse: () -> Unit,
    showMiniPlayer: Boolean,
    bottomPadding: Dp,
    onOpenAnime: (String) -> Unit,
    onOpenRelatedMusic: (String) -> Unit,
    onOpenArtist: (String) -> Unit,
    viewModel: PlayerViewModel,
    modifier: Modifier
) {
    if (!showMiniPlayer && !isExpanded) return

    val density = LocalDensity.current
    var swipeUpTrigger by remember { mutableStateOf(false) }

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val containerWidth = maxWidth
        val containerHeight = maxHeight
        val screenHeightPx = constraints.maxHeight.toFloat()
        val miniPlayerHeightPx = with(density) { MiniPlayerHeight.toPx() }
        val bottomPaddingPx = with(density) { bottomPadding.toPx() }
        val minOffset = 0f
        val maxOffset = screenHeightPx - miniPlayerHeightPx - bottomPaddingPx
        val offsetY = remember { Animatable(if (isExpanded) minOffset else maxOffset) }
        val coroutineScope = rememberCoroutineScope()
        var previousMaxOffset by remember { mutableStateOf(maxOffset) }

        LaunchedEffect(isExpanded, maxOffset) {
            if (!isExpanded) viewModel.exitVideoMode()
            val target = if (isExpanded) minOffset else maxOffset
            val navigationChanged = previousMaxOffset != maxOffset
            previousMaxOffset = maxOffset

            if (offsetY.targetValue != target) {
                if (isExpanded || !navigationChanged) offsetY.animateTo(target) else offsetY.snapTo(target)
            } else if (navigationChanged && !isExpanded) {
                offsetY.snapTo(target)
            }
        }

        val decay = splineBasedDecay<Float>(density)
        val progress = if (maxOffset > minOffset) {
            1f - ((offsetY.value - minOffset) / (maxOffset - minOffset)).coerceIn(0f, 1f)
        } else {
            0f
        }
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
                            viewModel.exitVideoMode()
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
                    viewModel.exitVideoMode()
                    onCollapse()
                },
                onOpenAnime = onOpenAnime,
                onOpenRelatedMusic = onOpenRelatedMusic,
                onOpenArtist = onOpenArtist,
                playerWidth = containerWidth,
                playerHeight = containerHeight,
                viewModel = viewModel
            )
        }
    }
}
