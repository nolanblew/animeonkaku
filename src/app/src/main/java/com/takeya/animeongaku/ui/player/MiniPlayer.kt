package com.takeya.animeongaku.ui.player

import android.content.ComponentName
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import coil.compose.AsyncImage
import com.takeya.animeongaku.media.MediaPlaybackService
import com.takeya.animeongaku.ui.common.MarqueeText
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.math.max

@Composable
fun MiniPlayer(
    onExpand: () -> Unit
) {
    val controller = rememberMiniPlayerController()
    val state = rememberMiniPlayerState(controller)

    AnimatedVisibility(
        visible = state.hasMedia,
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
            LinearProgressIndicator(
                progress = { state.progress },
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
                    if (state.artworkUrl != null) {
                        AsyncImage(
                            model = state.artworkUrl,
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
                        text = state.title,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Mist100
                    )
                    MarqueeText(
                        text = state.artist,
                        style = MaterialTheme.typography.bodySmall,
                        color = Mist200
                    )
                }

                IconButton(
                    onClick = {
                        controller?.let {
                            if (it.isPlaying) it.pause() else it.play()
                        }
                    },
                    modifier = Modifier
                        .size(40.dp)
                        .background(Rose500.copy(alpha = 0.15f), CircleShape)
                ) {
                    Icon(
                        imageVector = if (state.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = "Play or pause",
                        tint = Mist100,
                        modifier = Modifier.size(24.dp)
                    )
                }

                IconButton(
                    onClick = { controller?.seekToNext() },
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

private data class MiniPlayerState(
    val title: String = "",
    val artist: String = "",
    val artworkUrl: String? = null,
    val isPlaying: Boolean = false,
    val hasMedia: Boolean = false,
    val progress: Float = 0f
)

@Composable
private fun rememberMiniPlayerController(): MediaController? {
    val context = LocalContext.current
    val isPreview = LocalInspectionMode.current
    var controller by remember { mutableStateOf<MediaController?>(null) }

    DisposableEffect(context) {
        if (isPreview) return@DisposableEffect onDispose { }
        val sessionToken = SessionToken(context, ComponentName(context, MediaPlaybackService::class.java))
        val controllerFuture = MediaController.Builder(context, sessionToken).buildAsync()
        val executor = ContextCompat.getMainExecutor(context)

        controllerFuture.addListener(
            { controller = controllerFuture.get() },
            executor
        )

        onDispose {
            controller?.release()
            controller = null
        }
    }

    return controller
}

@Composable
private fun rememberMiniPlayerState(controller: MediaController?): MiniPlayerState {
    var state by remember { mutableStateOf(MiniPlayerState()) }

    DisposableEffect(controller) {
        if (controller == null) return@DisposableEffect onDispose { }

        fun updateFromController() {
            val meta = controller.mediaMetadata
            val duration = controller.duration.takeIf { it > 0 } ?: 1L
            state = MiniPlayerState(
                title = meta.title?.toString().orEmpty(),
                artist = meta.artist?.toString().orEmpty(),
                artworkUrl = meta.artworkUri?.toString(),
                isPlaying = controller.isPlaying,
                hasMedia = controller.mediaItemCount > 0,
                progress = (controller.currentPosition.toFloat() / max(duration, 1L)).coerceIn(0f, 1f)
            )
        }

        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { updateFromController() }
            override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) { updateFromController() }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) { updateFromController() }
            override fun onPlaybackStateChanged(playbackState: Int) { updateFromController() }
        }

        controller.addListener(listener)
        updateFromController()

        onDispose { controller.removeListener(listener) }
    }

    LaunchedEffect(controller) {
        while (isActive) {
            controller?.let {
                if (it.mediaItemCount > 0) {
                    val duration = it.duration.takeIf { d -> d > 0 } ?: 1L
                    state = state.copy(
                        progress = (it.currentPosition.toFloat() / max(duration, 1L)).coerceIn(0f, 1f),
                        isPlaying = it.isPlaying,
                        hasMedia = it.mediaItemCount > 0
                    )
                }
            }
            delay(500)
        }
    }

    return state
}
