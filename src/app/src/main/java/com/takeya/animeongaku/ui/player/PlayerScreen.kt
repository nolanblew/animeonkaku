package com.takeya.animeongaku.ui.player

import android.content.ComponentName
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Forward10
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
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
import com.takeya.animeongaku.media.MediaPlaybackService
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Gold400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.math.max

private data class SampleTrack(
    val id: String,
    val title: String,
    val artist: String,
    val audioUrl: String
)

@Composable
fun PlayerScreen() {
    val sampleTrack = remember {
        SampleTrack(
            id = "sample_theme_01",
            title = "Starlight Circuit",
            artist = "Hikari Nova",
            audioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
        )
    }

    val mediaController = rememberMediaController()
    val playerState = rememberPlayerUiState(mediaController)

    LaunchedEffect(mediaController) {
        mediaController?.let { controller ->
            if (controller.mediaItemCount == 0) {
                controller.setMediaItem(sampleTrack.toMediaItem())
                controller.prepare()
            }
        }
    }

    val backgroundGradient = Brush.verticalGradient(
        listOf(
            Ink900,
            Ink800,
            Ink700
        )
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundGradient)
    ) {
        BackdropGlow()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp)
                .padding(top = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            PlayerTopBar()
            AlbumArtCard(sampleTrack)
            TrackInfo(playerState)
            SeekBar(playerState, mediaController)
            PlaybackControls(playerState, mediaController)
            SupportingActions()
        }
    }
}

@Composable
private fun BackdropGlow() {
    Canvas(modifier = Modifier.fillMaxSize()) {
        val softStroke = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round)
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(Rose500.copy(alpha = 0.35f), Color.Transparent),
                radius = size.minDimension * 0.65f
            ),
            radius = size.minDimension * 0.65f,
            center = center.copy(x = size.width * 0.8f, y = size.height * 0.2f)
        )
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(Ember400.copy(alpha = 0.3f), Color.Transparent),
                radius = size.minDimension * 0.7f
            ),
            radius = size.minDimension * 0.7f,
            center = center.copy(x = size.width * 0.2f, y = size.height * 0.75f)
        )
        drawCircle(
            color = Mist200.copy(alpha = 0.12f),
            radius = size.minDimension * 0.55f,
            center = center.copy(x = size.width * 0.55f, y = size.height * 0.5f),
            style = softStroke
        )
    }
}

@Composable
private fun PlayerTopBar() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        GlassIconButton(onClick = { /* TODO */ }) {
            Icon(
                imageVector = Icons.Rounded.KeyboardArrowDown,
                contentDescription = "Collapse player",
                tint = Mist100
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "NOW PLAYING",
                style = MaterialTheme.typography.labelMedium,
                color = Mist200
            )
            Text(
                text = "Anime Ongaku",
                style = MaterialTheme.typography.titleLarge,
                color = Mist100
            )
        }
        GlassIconButton(onClick = { /* TODO */ }) {
            Icon(
                imageVector = Icons.Rounded.MoreVert,
                contentDescription = "More options",
                tint = Mist100
            )
        }
    }
}

@Composable
private fun AlbumArtCard(track: SampleTrack) {
    val shimmerShift by animateFloatAsState(
        targetValue = 1f,
        animationSpec = tween(durationMillis = 2600, easing = FastOutSlowInEasing),
        label = "shimmer"
    )

    val cardShape = RoundedCornerShape(28.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(320.dp)
            .shadow(30.dp, cardShape)
            .clip(cardShape)
            .background(
                brush = Brush.linearGradient(
                    0.0f to Ink800,
                    0.35f to Rose500.copy(alpha = 0.7f),
                    0.7f to Ember400.copy(alpha = 0.9f),
                    1.0f to Ink700
                )
            )
            .border(1.dp, Mist200.copy(alpha = 0.2f), cardShape)
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Gold400.copy(alpha = 0.4f), Color.Transparent),
                    radius = size.minDimension * 0.45f
                ),
                radius = size.minDimension * 0.45f,
                center = center.copy(x = size.width * (0.3f + shimmerShift * 0.2f), y = size.height * 0.3f)
            )
            drawLine(
                color = Mist100.copy(alpha = 0.15f),
                start = center.copy(x = size.width * 0.15f, y = size.height * 0.75f),
                end = center.copy(x = size.width * 0.85f, y = size.height * 0.55f),
                strokeWidth = 6.dp.toPx(),
                cap = StrokeCap.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(24f, 18f), phase = 8f)
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(20.dp)
                .background(
                    color = Ink900.copy(alpha = 0.5f),
                    shape = RoundedCornerShape(16.dp)
                )
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Text(
                text = "${track.title} Theme",
                style = MaterialTheme.typography.titleLarge,
                color = Mist100
            )
            Text(
                text = "Volume I",
                style = MaterialTheme.typography.bodyMedium,
                color = Mist200
            )
        }
    }
}

@Composable
private fun TrackInfo(state: PlayerUiState) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = state.title,
            style = MaterialTheme.typography.headlineSmall,
            color = Mist100,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = state.artist,
            style = MaterialTheme.typography.bodyLarge,
            color = Mist200
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TagChip("Hi-Fi")
            TagChip("Japanese")
            TagChip("OP 1")
        }
    }
}

@Composable
private fun TagChip(text: String) {
    Box(
        modifier = Modifier
            .border(1.dp, Mist200.copy(alpha = 0.4f), RoundedCornerShape(20.dp))
            .background(Ink800.copy(alpha = 0.7f), RoundedCornerShape(20.dp))
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = Mist100
        )
    }
}

@Composable
private fun SeekBar(state: PlayerUiState, controller: MediaController?) {
    val duration = max(state.durationMs, 1L)
    var scrubFraction by remember { mutableFloatStateOf(0f) }
    var isScrubbing by remember { mutableStateOf(false) }
    val positionFraction = if (isScrubbing) scrubFraction else (state.positionMs.toFloat() / duration)

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val activeColor by animateColorAsState(
            targetValue = Rose500,
            animationSpec = tween(500),
            label = "sliderColor"
        )
        Slider(
            value = positionFraction,
            onValueChange = {
                scrubFraction = it
                isScrubbing = true
            },
            onValueChangeFinished = {
                val newPosition = (scrubFraction * duration).toLong()
                controller?.seekTo(newPosition)
                isScrubbing = false
            },
            colors = androidx.compose.material3.SliderDefaults.colors(
                thumbColor = activeColor,
                activeTrackColor = activeColor,
                inactiveTrackColor = Ink700
            )
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = formatTime((positionFraction * duration).toLong()),
                style = MaterialTheme.typography.labelMedium,
                color = Mist200
            )
            Text(
                text = formatTime(duration),
                style = MaterialTheme.typography.labelMedium,
                color = Mist200
            )
        }
    }
}

@Composable
private fun PlaybackControls(state: PlayerUiState, controller: MediaController?) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = { controller?.shuffleModeEnabled = !(controller?.shuffleModeEnabled ?: false) }) {
            Icon(
                imageVector = Icons.Rounded.Shuffle,
                contentDescription = "Shuffle",
                tint = if (controller?.shuffleModeEnabled == true) Rose500 else Mist200
            )
        }

        IconButton(onClick = { controller?.seekToPrevious() }) {
            Icon(
                imageVector = Icons.Rounded.SkipPrevious,
                contentDescription = "Previous",
                tint = Mist100,
                modifier = Modifier.size(36.dp)
            )
        }

        PlayButton(isPlaying = state.isPlaying) {
            if (state.isPlaying) {
                controller?.pause()
            } else {
                controller?.play()
            }
        }

        IconButton(onClick = { controller?.seekToNext() }) {
            Icon(
                imageVector = Icons.Rounded.SkipNext,
                contentDescription = "Next",
                tint = Mist100,
                modifier = Modifier.size(36.dp)
            )
        }

        IconButton(onClick = { controller?.repeatMode = Player.REPEAT_MODE_ALL }) {
            Icon(
                imageVector = Icons.Rounded.Repeat,
                contentDescription = "Repeat",
                tint = if (controller?.repeatMode == Player.REPEAT_MODE_ALL) Rose500 else Mist200
            )
        }
    }
}

@Composable
private fun PlayButton(isPlaying: Boolean, onClick: () -> Unit) {
    val containerColor by animateColorAsState(
        targetValue = if (isPlaying) Rose500 else Ember400,
        animationSpec = tween(500),
        label = "playColor"
    )

    Box(
        modifier = Modifier
            .size(72.dp)
            .shadow(18.dp, CircleShape)
            .background(containerColor, CircleShape)
            .border(1.dp, Mist100.copy(alpha = 0.6f), CircleShape)
            .clip(CircleShape),
        contentAlignment = Alignment.Center
    ) {
        IconButton(onClick = onClick) {
            Icon(
                imageVector = if (isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                contentDescription = "Play or pause",
                tint = Ink900,
                modifier = Modifier.size(40.dp)
            )
        }
    }
}

@Composable
private fun SupportingActions() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        GlassIconButton(onClick = { /* TODO */ }) {
            Icon(
                imageVector = Icons.Rounded.Favorite,
                contentDescription = "Like",
                tint = Rose500
            )
        }
        GlassActionPill(icon = Icons.Rounded.Speed, label = "1.0x")
        GlassActionPill(icon = Icons.Rounded.Forward10, label = "10s")
    }
}

@Composable
private fun GlassActionPill(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String) {
    Row(
        modifier = Modifier
            .background(Ink800.copy(alpha = 0.7f), RoundedCornerShape(24.dp))
            .border(1.dp, Mist200.copy(alpha = 0.25f), RoundedCornerShape(24.dp))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(icon, contentDescription = null, tint = Mist100, modifier = Modifier.size(18.dp))
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = Mist100)
    }
}

@Composable
private fun GlassIconButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(44.dp)
            .background(Ink800.copy(alpha = 0.6f), CircleShape)
            .border(1.dp, Mist200.copy(alpha = 0.3f), CircleShape),
        contentAlignment = Alignment.Center
    ) {
        IconButton(onClick = onClick) {
            content()
        }
    }
}

@Composable
private fun rememberMediaController(): MediaController? {
    val context = LocalContext.current
    val isPreview = LocalInspectionMode.current
    var controller by remember { mutableStateOf<MediaController?>(null) }

    DisposableEffect(context) {
        if (isPreview) return@DisposableEffect onDispose { }
        val sessionToken = SessionToken(context, ComponentName(context, MediaPlaybackService::class.java))
        val controllerFuture = MediaController.Builder(context, sessionToken).buildAsync()
        val executor = ContextCompat.getMainExecutor(context)

        controllerFuture.addListener(
            {
                controller = controllerFuture.get()
            },
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
private fun rememberPlayerUiState(controller: Player?): PlayerUiState {
    var state by remember {
        mutableStateOf(
            PlayerUiState(
                title = "Loading...",
                artist = "Connecting",
                isPlaying = false,
                positionMs = 0L,
                durationMs = 1L,
                bufferedPositionMs = 0L
            )
        )
    }

    DisposableEffect(controller) {
        if (controller == null) return@DisposableEffect onDispose { }

        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                state = state.copy(isPlaying = isPlaying)
            }

            override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) {
                val title = mediaMetadata.title?.toString().orEmpty().ifBlank { state.title }
                val artist = mediaMetadata.artist?.toString().orEmpty().ifBlank { state.artist }
                state = state.copy(title = title, artist = artist)
            }
        }

        controller.addListener(listener)

        onDispose {
            controller.removeListener(listener)
        }
    }

    LaunchedEffect(controller) {
        while (isActive) {
            controller?.let {
                val duration = it.duration.takeIf { value -> value > 0 } ?: state.durationMs
                state = state.copy(
                    positionMs = it.currentPosition,
                    durationMs = duration,
                    bufferedPositionMs = it.bufferedPosition
                )
            }
            delay(500)
        }
    }

    return state
}

private fun SampleTrack.toMediaItem(): MediaItem {
    return MediaItem.Builder()
        .setMediaId(id)
        .setUri(audioUrl)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist)
                .build()
        )
        .build()
}

private fun formatTime(durationMs: Long): String {
    val totalSeconds = max(durationMs, 0L) / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%d:%02d".format(minutes, seconds)
}

private data class PlayerUiState(
    val title: String,
    val artist: String,
    val isPlaying: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val bufferedPositionMs: Long
)
