package com.takeya.animeongaku.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * A text composable that scrolls horizontally (marquee style) when the text overflows.
 * Holds at the start for [holdDurationMs], scrolls to the end, holds again, then resets.
 */
@Composable
fun MarqueeText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    holdDurationMs: Long = 2000L,
    scrollSpeedDpPerSec: Float = 30f
) {
    val density = LocalDensity.current
    val textMeasurer = rememberTextMeasurer()

    var containerSize by remember { mutableStateOf(IntSize.Zero) }
    val measuredWidth = remember(text, style) {
        textMeasurer.measure(text, style).size.width.toFloat()
    }
    val containerWidth = containerSize.width.toFloat()
    val overflowPx = (measuredWidth - containerWidth).coerceAtLeast(0f)
    val needsScroll = overflowPx > 0f

    if (!needsScroll) {
        Text(
            text = text,
            modifier = modifier.onSizeChanged { containerSize = it },
            style = style,
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        return
    }

    val scrollSpeedPxPerSec = with(density) { scrollSpeedDpPerSec.dp.toPx() }
    val scrollDurationMs = ((overflowPx / scrollSpeedPxPerSec) * 1000).toLong().coerceAtLeast(500L)

    var offsetX by remember(text) { mutableFloatStateOf(0f) }

    LaunchedEffect(text, overflowPx) {
        while (true) {
            // Phase 1: Hold at start
            offsetX = 0f
            delay(holdDurationMs)

            // Phase 2: Scroll to end
            val startTime = System.currentTimeMillis()
            while (true) {
                val elapsed = System.currentTimeMillis() - startTime
                val progress = (elapsed.toFloat() / scrollDurationMs).coerceIn(0f, 1f)
                offsetX = -overflowPx * progress
                if (progress >= 1f) break
                delay(16) // ~60fps
            }

            // Phase 3: Hold at end
            delay(holdDurationMs)

            // Phase 4: Snap back
            offsetX = 0f
            delay(500)
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clipToBounds()
            .onSizeChanged { containerSize = it }
    ) {
        Text(
            text = text,
            modifier = Modifier.graphicsLayer { translationX = offsetX },
            style = style,
            color = color,
            maxLines = 1,
            softWrap = false
        )
    }
}
