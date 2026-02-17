package com.takeya.animeongaku.ui.player

import android.content.ComponentName
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
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.takeya.animeongaku.media.MediaPlaybackService
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.common.MarqueeText
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import android.net.Uri
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.math.max

@Composable
fun PlayerScreen(
    onCollapse: () -> Unit = {},
    viewModel: PlayerViewModel = hiltViewModel()
) {
    val npState by viewModel.nowPlayingState.collectAsStateWithLifecycle()
    val nowPlayingManager = viewModel.nowPlayingManager

    val mediaController = rememberMediaController()
    val playerState = rememberPlayerUiState(mediaController, nowPlayingManager)

    var lastLoadedVersion by remember { mutableStateOf(-1L) }
    var showUpNext by remember { mutableStateOf(false) }

    if (showUpNext) {
        UpNextSheet(
            npState = npState,
            nowPlayingManager = nowPlayingManager,
            onDismiss = { showUpNext = false }
        )
    }

    LaunchedEffect(mediaController, npState.queueVersion) {
        mediaController?.let { controller ->
            if (npState.nowPlaying.isNotEmpty()) {
                if (lastLoadedVersion != npState.queueVersion) {

                    // Helper: surgically rebuild the queue around the current track
                    // without interrupting playback of the current song.
                    fun syncQueueAroundCurrent() {
                        val controllerCount = controller.mediaItemCount
                        val currentMediaIdx = controller.currentMediaItemIndex

                        // Remove all items after current
                        if (controllerCount > currentMediaIdx + 1) {
                            controller.removeMediaItems(currentMediaIdx + 1, controllerCount)
                        }
                        // Remove all items before current
                        if (currentMediaIdx > 0) {
                            controller.removeMediaItems(0, currentMediaIdx)
                        }
                        // Now controller has only the current item at index 0.
                        // Add items before current
                        val beforeItems = npState.nowPlaying.subList(0, npState.currentIndex).map { theme ->
                            val anime = theme.animeId?.let { npState.animeMap[it] }
                            theme.toMediaItem(anime)
                        }
                        for ((i, item) in beforeItems.withIndex()) {
                            controller.addMediaItem(i, item)
                        }
                        // Add items after current
                        if (npState.currentIndex + 1 < npState.nowPlaying.size) {
                            val afterItems = npState.nowPlaying.subList(npState.currentIndex + 1, npState.nowPlaying.size).map { theme ->
                                val anime = theme.animeId?.let { npState.animeMap[it] }
                                theme.toMediaItem(anime)
                            }
                            for (item in afterItems) {
                                controller.addMediaItem(item)
                            }
                        }
                    }

                    if (lastLoadedVersion == -1L) {
                        // PlayerScreen just composed (e.g. MiniPlayer expand).
                        // Check if the MediaController already has the right track playing.
                        val currentTheme = npState.currentTheme
                        val controllerMediaId = controller.currentMediaItem?.mediaId
                        val alreadyPlaying = controllerMediaId != null &&
                                currentTheme != null &&
                                controllerMediaId == currentTheme.id.toString() &&
                                controller.mediaItemCount > 0

                        if (alreadyPlaying) {
                            // Controller has the right song — sync surrounding queue
                            // without restarting the current track.
                            syncQueueAroundCurrent()
                        } else {
                            // Genuine first load or new play() call
                            val items = npState.nowPlaying.map { theme ->
                                val anime = theme.animeId?.let { npState.animeMap[it] }
                                theme.toMediaItem(anime)
                            }
                            controller.setMediaItems(items, npState.currentIndex, C.TIME_UNSET)
                            controller.playWhenReady = true
                            controller.prepare()
                        }
                    } else if (npState.isFullReload) {
                        // Full reload: new play() call, skipTo, rewindTo
                        val items = npState.nowPlaying.map { theme ->
                            val anime = theme.animeId?.let { npState.animeMap[it] }
                            theme.toMediaItem(anime)
                        }
                        controller.setMediaItems(items, npState.currentIndex, C.TIME_UNSET)
                        controller.playWhenReady = true
                        controller.prepare()
                    } else {
                        // Queue mutation while PlayerScreen is visible
                        syncQueueAroundCurrent()
                    }
                    lastLoadedVersion = npState.queueVersion
                }
            } else {
                controller.clearMediaItems()
                controller.stop()
                lastLoadedVersion = -1L
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
        val currentTheme = npState.currentTheme
        val animeArt = currentTheme?.animeId?.let { npState.animeMap[it] }
        val artUrl = animeArt?.coverUrl ?: animeArt?.thumbnailUrl

        PlayerBackgroundArt(artUrl)
        BackdropGlow()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp)
                .padding(top = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            PlayerTopBar(onCollapse)
            Box(contentAlignment = Alignment.Center) {
                AlbumArtCard(playerState.title, artUrl)
                if (playerState.isBuffering) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(48.dp),
                        color = Mist100.copy(alpha = 0.8f),
                        strokeWidth = 3.dp
                    )
                }
            }
            TrackInfo(playerState)
            playerState.errorMessage?.let { error ->
                Text(
                    text = error,
                    style = MaterialTheme.typography.labelSmall,
                    color = Rose500,
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 2
                )
            }
            SeekBar(playerState, mediaController)
            PlaybackControls(playerState, mediaController, npState, nowPlayingManager)
            SupportingActions(mediaController, onUpNext = { showUpNext = true })
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
private fun PlayerTopBar(onCollapse: () -> Unit) {
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
        Spacer(modifier = Modifier.size(44.dp))
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
private fun TrackInfo(state: PlayerUiState) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        MarqueeText(
            text = state.title,
            style = MaterialTheme.typography.headlineSmall,
            color = Mist100
        )
        MarqueeText(
            text = state.artist,
            style = MaterialTheme.typography.bodyLarge,
            color = Mist200
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
private fun PlaybackControls(
    state: PlayerUiState,
    controller: MediaController?,
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

        IconButton(onClick = { controller?.toggleRepeatMode() }) {
            Icon(
                imageVector = Icons.Rounded.Repeat,
                contentDescription = "Repeat",
                tint = if (controller?.repeatMode == Player.REPEAT_MODE_OFF) Mist200 else Rose500
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
private fun SupportingActions(controller: MediaController?, onUpNext: () -> Unit = {}) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)
    ) {
        GlassActionPill(
            icon = Icons.Rounded.Replay10,
            label = "10s",
            onClick = { controller?.seekBackTenSeconds() }
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
private fun rememberPlayerUiState(
    controller: Player?,
    nowPlayingManager: com.takeya.animeongaku.media.NowPlayingManager
): PlayerUiState {
    var state by remember {
        mutableStateOf(
            PlayerUiState(
                title = "Select a song",
                artist = "Choose a track from your library",
                isPlaying = false,
                mediaId = null,
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

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                state = state.copy(mediaId = mediaItem?.mediaId, errorMessage = null)
                // Sync NowPlayingManager with the player's current index
                val idx = controller.currentMediaItemIndex
                nowPlayingManager.onTrackChanged(idx)
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                state = state.copy(
                    isBuffering = playbackState == Player.STATE_BUFFERING,
                    errorMessage = if (playbackState == Player.STATE_IDLE && state.errorMessage != null) state.errorMessage else null
                )
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                state = state.copy(
                    errorMessage = "Playback error: ${error.localizedMessage ?: "Unknown error"}",
                    isBuffering = false
                )
            }
        }

        controller.addListener(listener)

        // Read initial state from controller (already playing when opened from MiniPlayer)
        val meta = controller.mediaMetadata
        val initTitle = meta.title?.toString().orEmpty().ifBlank { state.title }
        val initArtist = meta.artist?.toString().orEmpty().ifBlank { state.artist }
        val initDuration = controller.duration.takeIf { it > 0 } ?: state.durationMs
        state = state.copy(
            title = initTitle,
            artist = initArtist,
            isPlaying = controller.isPlaying,
            mediaId = controller.currentMediaItem?.mediaId,
            positionMs = controller.currentPosition,
            durationMs = initDuration,
            bufferedPositionMs = controller.bufferedPosition,
            isBuffering = controller.playbackState == Player.STATE_BUFFERING
        )

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

private fun ThemeEntity.toMediaItem(anime: AnimeEntity? = null): MediaItem {
    val artworkUrl = anime?.coverUrl ?: anime?.thumbnailUrl
    val animeName = anime?.title
    val typeTag = themeType

    // Primary line: "Anime Name · OP1" or just anime name or theme type
    val primaryLine = when {
        !animeName.isNullOrBlank() && !typeTag.isNullOrBlank() -> "$animeName · $typeTag"
        !animeName.isNullOrBlank() -> animeName
        !typeTag.isNullOrBlank() -> "$typeTag · $title"
        else -> title
    }
    // Secondary line: "Song Title · Artist" or just song title
    val secondaryLine = when {
        !artistName.isNullOrBlank() -> "$title · $artistName"
        else -> title
    }

    return MediaItem.Builder()
        .setMediaId(id.toString())
        .setUri(audioUrl)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(primaryLine)
                .setArtist(secondaryLine)
                .setAlbumTitle(animeName)
                .apply {
                    if (!artworkUrl.isNullOrBlank()) {
                        setArtworkUri(Uri.parse(artworkUrl))
                    }
                }
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

private fun MediaController.toggleRepeatMode() {
    repeatMode = when (repeatMode) {
        Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
        Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
    }
}

private fun MediaController.seekBackTenSeconds() {
    val newPosition = (currentPosition - 10_000).coerceAtLeast(0L)
    seekTo(newPosition)
}

private data class PlayerUiState(
    val title: String,
    val artist: String,
    val isPlaying: Boolean,
    val mediaId: String?,
    val positionMs: Long,
    val durationMs: Long,
    val bufferedPositionMs: Long,
    val isBuffering: Boolean = false,
    val errorMessage: String? = null
)
