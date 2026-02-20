package com.takeya.animeongaku.ui.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.takeya.animeongaku.ui.common.MarqueeText
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import kotlin.math.max

@Composable
fun MiniPlayer(
    onExpand: () -> Unit,
    viewModel: PlayerViewModel = hiltViewModel()
) {
    val npState by viewModel.nowPlayingState.collectAsStateWithLifecycle()
    val pbState by viewModel.playbackState.collectAsStateWithLifecycle()
    val controllerManager = viewModel.mediaControllerManager

    // Derive display info from NowPlayingManager (single source of truth)
    val currentTheme = npState.currentTheme
    val animeEntity = currentTheme?.animeId?.let { npState.animeMap[it] }
    val artUrl = animeEntity?.coverUrl ?: animeEntity?.thumbnailUrl
    val trackInfo = currentTheme?.displayInfo(animeEntity)
    val title = trackInfo?.primaryText ?: ""
    val artist = trackInfo?.secondaryText ?: ""
    val isVisible = npState.nowPlaying.isNotEmpty() && pbState.hasMedia

    val duration = max(pbState.durationMs, 1L)
    val progress = (pbState.positionMs.toFloat() / duration).coerceIn(0f, 1f)

    AnimatedVisibility(
        visible = isVisible,
        enter = slideInVertically(initialOffsetY = { it }),
        exit = slideOutVertically(targetOffsetY = { it })
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Ink900.copy(alpha = 0.95f))
                .border(
                    width = 0.5.dp,
                    color = Mist200.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)
                )
                .clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp))
                .clickable { onExpand() }
        ) {
            val smoothProgress by animateFloatAsState(
                targetValue = progress,
                animationSpec = tween(durationMillis = 150, easing = LinearEasing),
                label = "miniProgress"
            )
            LinearProgressIndicator(
                progress = { smoothProgress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(2.dp),
                color = Rose500,
                trackColor = Ink800
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Ink800)
                ) {
                    if (artUrl != null) {
                        AsyncImage(
                            model = artUrl,
                            contentDescription = null,
                            modifier = Modifier.size(44.dp),
                            contentScale = ContentScale.Crop
                        )
                    }
                }

                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    MarqueeText(
                        text = title,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Mist100
                    )
                    MarqueeText(
                        text = artist,
                        style = MaterialTheme.typography.bodySmall,
                        color = Mist200
                    )
                }

                IconButton(
                    onClick = {
                        if (pbState.isPlaying) controllerManager.pause() else controllerManager.play()
                    },
                    modifier = Modifier
                        .size(40.dp)
                        .background(Rose500.copy(alpha = 0.15f), CircleShape)
                ) {
                    Icon(
                        imageVector = if (pbState.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = "Play or pause",
                        tint = Mist100,
                        modifier = Modifier.size(24.dp)
                    )
                }

                IconButton(
                    onClick = { controllerManager.seekToNext() },
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.SkipNext,
                        contentDescription = "Next",
                        tint = Mist200,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
        }
    }
}
