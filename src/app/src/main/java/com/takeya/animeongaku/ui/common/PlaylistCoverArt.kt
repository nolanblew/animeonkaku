package com.takeya.animeongaku.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import kotlin.math.abs

private val gradientPalette = listOf(
    listOf(Color(0xFFFF6B6B), Color(0xFFEE5A24)),
    listOf(Color(0xFF4834D4), Color(0xFF686DE0)),
    listOf(Color(0xFF6AB04C), Color(0xFF009432)),
    listOf(Color(0xFFEB4D4B), Color(0xFFC44569)),
    listOf(Color(0xFF22A6B3), Color(0xFF7ED6DF)),
    listOf(Color(0xFFF97F51), Color(0xFFF8C291)),
    listOf(Color(0xFF574B90), Color(0xFFA29BFE)),
    listOf(Color(0xFFE056A0), Color(0xFFD980FA)),
    listOf(Color(0xFF1B9CFC), Color(0xFF25CCF7)),
    listOf(Color(0xFFFC427B), Color(0xFFF8EFBA)),
)

@Composable
fun PlaylistCoverArt(
    coverUrls: List<String>,
    gradientSeed: Int,
    size: Dp = 44.dp,
    cornerRadius: Dp = 8.dp,
    modifier: Modifier = Modifier
) {
    val shape = RoundedCornerShape(cornerRadius)

    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
    ) {
        when {
            coverUrls.size >= 4 -> CollageGrid(coverUrls.take(4))
            coverUrls.size >= 2 -> CollageGrid(coverUrls.take(coverUrls.size))
            else -> {
                val colors = remember(gradientSeed) {
                    val index = abs(gradientSeed) % gradientPalette.size
                    gradientPalette[index]
                }
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Brush.linearGradient(colors))
                )
            }
        }
    }
}

@Composable
private fun CollageGrid(urls: List<String>) {
    when (urls.size) {
        2 -> {
            Row(modifier = Modifier.fillMaxSize()) {
                AsyncImage(
                    model = urls[0],
                    contentDescription = null,
                    modifier = Modifier.weight(1f).fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
                AsyncImage(
                    model = urls[1],
                    contentDescription = null,
                    modifier = Modifier.weight(1f).fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        3 -> {
            Row(modifier = Modifier.fillMaxSize()) {
                AsyncImage(
                    model = urls[0],
                    contentDescription = null,
                    modifier = Modifier.weight(1f).fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
                Column(modifier = Modifier.weight(1f).fillMaxSize()) {
                    AsyncImage(
                        model = urls[1],
                        contentDescription = null,
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        contentScale = ContentScale.Crop
                    )
                    AsyncImage(
                        model = urls[2],
                        contentDescription = null,
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
        else -> {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    AsyncImage(
                        model = urls[0],
                        contentDescription = null,
                        modifier = Modifier.weight(1f).fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                    AsyncImage(
                        model = urls[1],
                        contentDescription = null,
                        modifier = Modifier.weight(1f).fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                }
                Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    AsyncImage(
                        model = urls[2],
                        contentDescription = null,
                        modifier = Modifier.weight(1f).fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                    AsyncImage(
                        model = urls[3],
                        contentDescription = null,
                        modifier = Modifier.weight(1f).fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
    }
}
