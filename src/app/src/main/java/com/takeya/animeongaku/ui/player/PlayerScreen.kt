package com.takeya.animeongaku.ui.player

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Replay10
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.media3.common.Player
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.takeya.animeongaku.media.MediaControllerManager
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.MarqueeText
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import kotlin.math.max

@Composable
fun PlayerScreen(
    onCollapse: () -> Unit = {},
    viewModel: PlayerViewModel = hiltViewModel()
) {
    val npState by viewModel.nowPlayingState.collectAsStateWithLifecycle()
    val pbState by viewModel.playbackState.collectAsStateWithLifecycle()
    val nowPlayingManager = viewModel.nowPlayingManager
    val controllerManager = viewModel.mediaControllerManager

    var showUpNext by remember { mutableStateOf(false) }
    var showPlayerSheet by remember { mutableStateOf(false) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()

    if (showUpNext) {
        UpNextSheet(
            npState = npState,
            nowPlayingManager = nowPlayingManager,
            onDismiss = { showUpNext = false }
        )
    }

    if (showPlayerSheet) {
        val theme = npState.currentTheme
        if (theme != null) {
            val animeEntity = theme.animeId?.let { npState.animeMap[it] }
            val info = theme.displayInfo(animeEntity)
            ActionSheet(
                config = ActionSheetConfig(
                    title = info.primaryText,
                    subtitle = info.secondaryText,
                    imageUrl = animeEntity?.coverUrl ?: animeEntity?.thumbnailUrl,
                    showPlayNext = false,
                    showAddToQueue = false,
                    showReplaceQueue = false,
                    showSaveToPlaylist = true,
                    showAddToLibrary = false
                ),
                onDismiss = { showPlayerSheet = false },
                onSaveToPlaylist = { pickerThemeIds = listOf(theme.id) }
            )
        }
    }

    pickerThemeIds?.let { ids ->
        PlaylistPickerSheet(
            playlists = playlists,
            onDismiss = { pickerThemeIds = null },
            onSelectPlaylist = { playlistId ->
                viewModel.addToPlaylist(playlistId, ids)
                pickerThemeIds = null
            },
            onCreatePlaylist = { name ->
                viewModel.createAndAddToPlaylist(name, ids)
                pickerThemeIds = null
            }
        )
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
        // Derive display info from NowPlayingManager (single source of truth)
        val currentTheme = npState.currentTheme
        val animeEntity = currentTheme?.animeId?.let { npState.animeMap[it] }
        val artUrl = animeEntity?.coverUrl ?: animeEntity?.thumbnailUrl
        val trackInfo = currentTheme?.displayInfo(animeEntity)
        val title = trackInfo?.primaryText ?: "Select a song"
        val artist = trackInfo?.secondaryText ?: "Choose a track from your library"

        PlayerBackgroundArt(artUrl)
        BackdropGlow()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp)
                .padding(top = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            PlayerTopBar(onCollapse, onMore = { showPlayerSheet = true })
            Box(contentAlignment = Alignment.Center) {
                AlbumArtCard(title, artUrl)
                if (pbState.isBuffering) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(48.dp),
                        color = Mist100.copy(alpha = 0.8f),
                        strokeWidth = 3.dp
                    )
                }
            }
            TrackInfo(title, artist)
            pbState.errorMessage?.let { error ->
                Text(
                    text = error,
                    style = MaterialTheme.typography.labelSmall,
                    color = Rose500,
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 2
                )
            }
            SeekBar(pbState, controllerManager)
            PlaybackControls(pbState, controllerManager, npState, nowPlayingManager)
            SupportingActions(controllerManager, onUpNext = { showUpNext = true })
        }
    }
}

@Composable
private fun PlayerBackgroundArt(imageUrl: String?) {
    if (imageUrl.isNullOrBlank()) return
    AsyncImage(
        model = imageUrl,
        contentDescription = null,
        modifier = Modifier
            .fillMaxSize(),
        contentScale = ContentScale.Crop,
        alpha = 0.18f
    )
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
private fun PlayerTopBar(onCollapse: () -> Unit, onMore: () -> Unit = {}) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        GlassIconButton(onClick = onCollapse) {
            Icon(
                imageVector = Icons.Rounded.KeyboardArrowDown,
                contentDescription = "Collapse player",
                tint = Mist100
            )
        }
        Text(
            text = "NOW PLAYING",
            style = MaterialTheme.typography.labelMedium,
            color = Mist200
        )
        GlassIconButton(onClick = onMore) {
            Icon(
                imageVector = Icons.Rounded.MoreVert,
                contentDescription = "More options",
                tint = Mist100
            )
        }
    }
}

@Composable
private fun AlbumArtCard(title: String, imageUrl: String?) {
    val cardShape = RoundedCornerShape(24.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(320.dp)
            .shadow(24.dp, cardShape)
            .clip(cardShape)
            .background(Ink800, cardShape)
            .border(1.dp, Mist200.copy(alpha = 0.15f), cardShape),
        contentAlignment = Alignment.Center
    ) {
        if (!imageUrl.isNullOrBlank()) {
            AsyncImage(
                model = imageUrl,
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0f to Color.Transparent,
                            0.7f to Color.Transparent,
                            1f to Ink900.copy(alpha = 0.6f)
                        )
                    )
            )
        } else {
            Canvas(modifier = Modifier.fillMaxSize()) {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(Rose500.copy(alpha = 0.3f), Color.Transparent),
                        radius = size.minDimension * 0.6f
                    ),
                    radius = size.minDimension * 0.6f,
                    center = center
                )
            }
            Text(
                text = title.take(2).uppercase(),
                style = MaterialTheme.typography.displayLarge,
                color = Mist100.copy(alpha = 0.3f)
            )
        }
    }
}

@Composable
private fun TrackInfo(title: String, artist: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        MarqueeText(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            color = Mist100
        )
        MarqueeText(
            text = artist,
            style = MaterialTheme.typography.bodyLarge,
            color = Mist200
        )
    }
}

@Composable
private fun SeekBar(pbState: PlaybackState, controllerManager: MediaControllerManager) {
    val duration = max(pbState.durationMs, 1L)
    var scrubFraction by remember { mutableFloatStateOf(0f) }
    var isScrubbing by remember { mutableStateOf(false) }
    val rawFraction = (pbState.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    val smoothFraction by androidx.compose.animation.core.animateFloatAsState(
        targetValue = rawFraction,
        animationSpec = tween(durationMillis = 150, easing = androidx.compose.animation.core.LinearEasing),
        label = "seekSmooth"
    )
    val positionFraction = if (isScrubbing) scrubFraction else smoothFraction

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
                controllerManager.seekTo(newPosition)
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
private fun PlaybackControls(
    pbState: PlaybackState,
    controllerManager: MediaControllerManager,
    npState: NowPlayingState,
    nowPlayingManager: com.takeya.animeongaku.media.NowPlayingManager
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = { nowPlayingManager.toggleShuffle() }) {
            Icon(
                imageVector = Icons.Rounded.Shuffle,
                contentDescription = "Shuffle",
                tint = if (npState.isShuffled) Rose500 else Mist200
            )
        }

        IconButton(onClick = { controllerManager.seekToPrevious() }) {
            Icon(
                imageVector = Icons.Rounded.SkipPrevious,
                contentDescription = "Previous",
                tint = Mist100,
                modifier = Modifier.size(36.dp)
            )
        }

        PlayButton(isPlaying = pbState.isPlaying, isBuffering = pbState.isBuffering) {
            if (pbState.isPlaying) {
                controllerManager.pause()
            } else {
                controllerManager.play()
            }
        }

        IconButton(onClick = { controllerManager.seekToNext() }) {
            Icon(
                imageVector = Icons.Rounded.SkipNext,
                contentDescription = "Next",
                tint = Mist100,
                modifier = Modifier.size(36.dp)
            )
        }

        IconButton(onClick = { controllerManager.toggleRepeatMode() }) {
            Icon(
                imageVector = Icons.Rounded.Repeat,
                contentDescription = "Repeat",
                tint = if (pbState.repeatMode == Player.REPEAT_MODE_OFF) Mist200 else Rose500
            )
        }
    }
}

@Composable
private fun PlayButton(isPlaying: Boolean, isBuffering: Boolean = false, onClick: () -> Unit) {
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
        if (isBuffering) {
            CircularProgressIndicator(
                modifier = Modifier.size(36.dp),
                color = Ink900,
                strokeWidth = 3.dp
            )
        } else {
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
}

@Composable
private fun SupportingActions(controllerManager: MediaControllerManager, onUpNext: () -> Unit = {}) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)
    ) {
        GlassActionPill(
            icon = Icons.Rounded.Replay10,
            label = "10s",
            onClick = { controllerManager.seekBackTenSeconds() }
        )
        GlassActionPill(
            icon = Icons.AutoMirrored.Rounded.QueueMusic,
            label = "Up Next",
            onClick = onUpNext
        )
    }
}

@Composable
private fun GlassActionPill(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit = {}
) {
    Row(
        modifier = Modifier
            .background(Ink800.copy(alpha = 0.7f), RoundedCornerShape(24.dp))
            .border(1.dp, Mist200.copy(alpha = 0.25f), RoundedCornerShape(24.dp))
            .clickable { onClick() }
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

private fun formatTime(durationMs: Long): String {
    val totalSeconds = max(durationMs, 0L) / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%d:%02d".format(minutes, seconds)
}
