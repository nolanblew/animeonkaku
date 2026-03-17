package com.takeya.animeongaku.ui.common

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * A text composable that scrolls horizontally (marquee style) when the text overflows.
 * Scrolls until the end is visible, holds, and jumps back to the beginning.
 */
@Composable
fun MarqueeText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    startDelayMs: Long = 5000L,
    endDelayMs: Long = 2000L,
    scrollSpeedDpPerSec: Float = 30f,
    endPaddingDp: Float = 16f
) {
    val density = LocalDensity.current
    val textMeasurer = rememberTextMeasurer()

    var containerWidth by remember { mutableIntStateOf(0) }
    
    val measuredWidthPx = remember(text, style) {
        textMeasurer.measure(
            text = text,
            style = style,
            maxLines = 1,
            softWrap = false
        ).size.width.toFloat()
    }

    val paddingPx = with(density) { endPaddingDp.dp.toPx() }
    val overflowPx = (measuredWidthPx - containerWidth).coerceAtLeast(0f)
    
    // Only scroll if we have determined a valid container width and the text is wider than it.
    val needsScroll = containerWidth > 0 && overflowPx > 0f

    if (!needsScroll) {
        // Simple regular text if it fits, or if we are doing initial measurement.
        // It obeys the given modifiers exactly.
        Text(
            text = text,
            modifier = modifier.onSizeChanged { containerWidth = it.width },
            style = style,
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        return
    }

    val maxOffsetPx = overflowPx + paddingPx
    val offsetX = remember(text) { Animatable(0f) }

    LaunchedEffect(text, maxOffsetPx) {
        val scrollSpeedPxPerSec = with(density) { scrollSpeedDpPerSec.dp.toPx() }
        val scrollDurationMs = ((maxOffsetPx / scrollSpeedPxPerSec) * 1000).toInt().coerceAtLeast(500)

        while (true) {
            // Hold at start
            offsetX.snapTo(0f)
            delay(startDelayMs)

            // Scroll to end
            offsetX.animateTo(
                targetValue = -maxOffsetPx,
                animationSpec = tween(
                    durationMillis = scrollDurationMs,
                    easing = LinearEasing
                )
            )

            // Hold at end
            delay(endDelayMs)
        }
    }

    // A custom Box that doesn't expand past its maximum constraints, 
    // mimicking a standard Text component with maxLines=1.
    Box(
        modifier = modifier
            .clipToBounds()
            .onSizeChanged { containerWidth = it.width }
    ) {
        Text(
            text = text,
            modifier = Modifier
                .graphicsLayer { translationX = offsetX.value }
                .layout { measurable, constraints ->
                    // Measure text with infinite width constraints so it never truncates.
                    val placeable = measurable.measure(
                        constraints.copy(
                            maxWidth = Constraints.Infinity,
                            minWidth = 0
                        )
                    )
                    // The wrapper node is sized to the available width (to mimic Ellipsis text), 
                    // preventing it from blowing up the parent's size.
                    val layoutWidth = placeable.width.coerceAtMost(constraints.maxWidth)
                    val layoutHeight = placeable.height.coerceAtMost(constraints.maxHeight)
                    
                    layout(layoutWidth, layoutHeight) {
                        placeable.placeRelative(0, 0)
                    }
                },
            style = style,
            color = color,
            maxLines = 1,
            softWrap = false
        )
    }
}
