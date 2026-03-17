package com.takeya.animeongaku.ui.common

import androidx.compose.foundation.basicMarquee
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp

/**
 * A text composable that scrolls horizontally (marquee style) when the text overflows.
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
    Text(
        text = text,
        modifier = modifier.basicMarquee(
            delayMillis = holdDurationMs.toInt(),
            initialDelayMillis = holdDurationMs.toInt(),
            velocity = scrollSpeedDpPerSec.dp
        ),
        style = style,
        color = color,
        maxLines = 1,
        softWrap = false
    )
}
