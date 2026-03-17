package com.takeya.animeongaku.ui.player

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.unit.dp
import androidx.constraintlayout.compose.ExperimentalMotionApi
import androidx.constraintlayout.compose.MotionLayout
import androidx.constraintlayout.compose.MotionScene
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
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

@OptIn(ExperimentalMotionApi::class)
@Composable
fun PlayerScreen(
    progress: Float,
    swipeUpTrigger: Boolean = false,
    onSwipeUpHandled: () -> Unit = {},
    onExpand: () -> Unit = {},
    onCollapse: () -> Unit = {},
    onOpenAnime: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
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
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()

    androidx.compose.runtime.LaunchedEffect(swipeUpTrigger) {
        if (swipeUpTrigger) {
            showUpNext = true
            onSwipeUpHandled()
        }
    }

    if (showUpNext) {
        UpNextSheet(
            npState = npState,
            nowPlayingManager = nowPlayingManager,
            isOffline = !isOnline,
            downloadedThemeIds = downloadedThemeIds,
            onDismiss = { showUpNext = false }
        )
    }

    if (showPlayerSheet) {
        val theme = npState.currentTheme
        if (theme != null) {
            val animeEntity = theme.animeId?.let { npState.animeMap[it] }
            val info = theme.displayInfo(animeEntity)
            var songInLibrary by remember { mutableStateOf(true) }
            androidx.compose.runtime.LaunchedEffect(theme.id) {
                songInLibrary = viewModel.isInLibrary(theme.id)
            }
            ActionSheet(
                config = ActionSheetConfig(
                    title = info.primaryText, subtitle = info.secondaryText, imageUrl = animeEntity?.coverUrl ?: animeEntity?.thumbnailUrl,
                    showPlayNext = false, showAddToQueue = false, showReplaceQueue = false, showSaveToPlaylist = true,
                    showAddToLibrary = !songInLibrary,
                    showGoToArtist = !theme.artistName.isNullOrBlank(),
                    showGoToAnime = animeEntity?.kitsuId != null,
                    artistName = theme.artistName?.split(",")?.firstOrNull()?.trim(),
                    animeName = animeEntity?.title
                ),
                onDismiss = { showPlayerSheet = false },
                onSaveToPlaylist = { pickerThemeIds = listOf(theme.id) },
                onGoToArtist = { theme.artistName?.split(",")?.firstOrNull()?.trim()?.let { onOpenArtist(it) } },
                onGoToAnime = { animeEntity?.kitsuId?.let { onOpenAnime(it) } },
                onAddToLibrary = { viewModel.saveSongToLibrary(theme, animeEntity) }
            )
        }
    }

    pickerThemeIds?.let { ids ->
        PlaylistPickerSheet(
            playlists = playlists, onDismiss = { pickerThemeIds = null },
            onSelectPlaylist = { playlistId -> viewModel.addToPlaylist(playlistId, ids); pickerThemeIds = null },
            onCreatePlaylist = { name -> viewModel.createAndAddToPlaylist(name, ids); pickerThemeIds = null }
        )
    }

    val currentTheme = npState.currentTheme
    val animeEntity = currentTheme?.animeId?.let { npState.animeMap[it] }
    val artUrl = animeEntity?.coverUrl ?: animeEntity?.thumbnailUrl
    val trackInfo = currentTheme?.displayInfo(animeEntity)
    val title = trackInfo?.primaryText ?: "Select a song"
    val artist = trackInfo?.secondaryText ?: "Choose a track from your library"

    val topInsetDp = WindowInsets.systemBars.asPaddingValues().calculateTopPadding().value.toInt()
    val endTopMargin = max(16, topInsetDp + 16)

    val motionScene = MotionScene("""{
            ConstraintSets: {
                start: {
                    bg: { width: 'spread', height: 64, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'] },
                    topBar: { width: 'spread', height: 48, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], alpha: 0 },
                    art: { width: 44, height: 44, start: ['parent', 'start', 12], top: ['parent', 'top', 10], custom: { corner: 8 } },
                    titles: { width: 'spread', height: 'wrap', start: ['art', 'end', 12], end: ['playPause', 'start', 12], top: ['parent', 'top', 12], bottom: ['bg', 'bottom', 12] },
                    playPause: { width: 40, height: 40, end: ['next', 'start', 12], top: ['parent', 'top', 12], bottom: ['bg', 'bottom', 12] },
                    next: { width: 36, height: 36, end: ['parent', 'end', 12], top: ['parent', 'top', 14], bottom: ['bg', 'bottom', 14] },
                    miniProgress: { width: 'spread', height: 2, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], alpha: 1 },
                    sliderControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['titles', 'bottom', 20], alpha: 0 },
                    playbackControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['sliderControls', 'bottom', 20], alpha: 0 },
                    upNextRow: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['playbackControls', 'bottom', 20], alpha: 0 }
                },
                end: {
                    bg: { width: 'spread', height: 'spread', start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], bottom: ['parent', 'bottom'] },
                    topBar: { width: 'spread', height: 48, start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['parent', 'top', $endTopMargin], alpha: 1 },
                    art: { width: 'spread', height: 320, start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['topBar', 'bottom', 20], custom: { corner: 24 } },
                    titles: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['art', 'bottom', 20] },
                    playPause: { width: 72, height: 72, start: ['parent', 'start'], end: ['parent', 'end'], top: ['playbackControls', 'top'], bottom: ['playbackControls', 'bottom'] },
                    next: { width: 48, height: 48, start: ['playPause', 'end', 12], top: ['playbackControls', 'top'], bottom: ['playbackControls', 'bottom'] },
                    miniProgress: { width: 'spread', height: 2, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], alpha: 0 },
                    sliderControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['titles', 'bottom', 20], alpha: 1 },
                    playbackControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['sliderControls', 'bottom', 20], alpha: 1 },
                    upNextRow: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['playbackControls', 'bottom', 20], alpha: 1 }
                }
            },
            Transitions: { default: { from: 'start', to: 'end' } }
        }""")

    MotionLayout(motionScene = motionScene, progress = progress, modifier = Modifier.fillMaxSize()) {
        val isExpandedThreshold = progress > 0.1f
        val backgroundGradient = Brush.verticalGradient(listOf(Ink900, if (isExpandedThreshold) Ink800 else Ink900, if (isExpandedThreshold) Ink700 else Ink900))
        Box(
            modifier = Modifier.layoutId("bg")
                .background(backgroundGradient)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = { if (progress < 0.5f) onExpand() }
                )
                .then(if (progress < 0.5f) { Modifier.border(0.5.dp, Mist200.copy(alpha = 0.15f), RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)).clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)) } else Modifier)
        ) {
            if (isExpandedThreshold) {
                PlayerBackgroundArt(artUrl)
                BackdropGlow()
            }
        }

        Row(modifier = Modifier.layoutId("topBar"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            GlassIconButton(onClick = onCollapse) { Icon(Icons.Rounded.KeyboardArrowDown, "Collapse player", tint = Mist100) }
            Text("NOW PLAYING", style = MaterialTheme.typography.labelMedium, color = Mist200)
            GlassIconButton(onClick = { showPlayerSheet = true }) { Icon(Icons.Rounded.MoreVert, "More options", tint = Mist100) }
        }

        val cornerProps = motionProperties(id = "art")
        val cornerRadius = cornerProps.value.int("corner") ?: 8
        Box(
            modifier = Modifier.layoutId("art").shadow(if (isExpandedThreshold) 24.dp else 0.dp, RoundedCornerShape(cornerRadius.dp)).clip(RoundedCornerShape(cornerRadius.dp)).background(Ink800, RoundedCornerShape(cornerRadius.dp)).then(if (isExpandedThreshold) Modifier.border(1.dp, Mist200.copy(alpha=0.15f), RoundedCornerShape(cornerRadius.dp)) else Modifier),
            contentAlignment = Alignment.Center
        ) {
            if (!artUrl.isNullOrBlank()) { AsyncImage(model = artUrl, contentDescription = title, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        }

        Column(modifier = Modifier.layoutId("titles"), verticalArrangement = Arrangement.spacedBy(if (isExpandedThreshold) 4.dp else 2.dp)) {
            MarqueeText(text = title, style = if (isExpandedThreshold) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.bodyMedium, color = Mist100)
            MarqueeText(text = artist, style = if (isExpandedThreshold) MaterialTheme.typography.bodyLarge else MaterialTheme.typography.bodySmall, color = Mist200)
        }

        if (isExpandedThreshold) {
            val containerColor by animateColorAsState(targetValue = if (pbState.isPlaying) Rose500 else Ember400, animationSpec = tween(500), label = "playColor")
            Box(
                modifier = Modifier.layoutId("playPause").shadow(18.dp, CircleShape).background(containerColor, CircleShape).border(1.dp, Mist100.copy(alpha = 0.6f), CircleShape).clip(CircleShape),
                contentAlignment = Alignment.Center
            ) {
                if (pbState.isBuffering) { CircularProgressIndicator(modifier = Modifier.size(36.dp), color = Ink900, strokeWidth = 3.dp) } else {
                    IconButton(onClick = { if (pbState.isPlaying) controllerManager.pause() else controllerManager.play() }) { Icon(if (pbState.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, "Play or pause", tint = Ink900, modifier = Modifier.size(40.dp)) }
                }
            }
        } else {
            IconButton(onClick = { if (pbState.isPlaying) controllerManager.pause() else controllerManager.play() }, modifier = Modifier.layoutId("playPause").background(Rose500.copy(alpha = 0.15f), CircleShape)) {
                Icon(if (pbState.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, "Play or pause", tint = Mist100, modifier = Modifier.size(24.dp))
            }
        }

        IconButton(onClick = { controllerManager.seekToNext() }, modifier = Modifier.layoutId("next")) {
            Icon(Icons.Rounded.SkipNext, "Next", tint = if (isExpandedThreshold) Mist100 else Mist200, modifier = Modifier.size(if (isExpandedThreshold) 36.dp else 22.dp))
        }

        val duration = max(pbState.durationMs, 1L)
        val posProgress = (pbState.positionMs.toFloat() / duration).coerceIn(0f, 1f)
        LinearProgressIndicator(progress = { posProgress }, modifier = Modifier.layoutId("miniProgress"), color = Rose500, trackColor = Ink800)

        var scrubFraction by remember { mutableFloatStateOf(0f) }
        var isScrubbing by remember { mutableStateOf(false) }
        val rawFraction = (pbState.positionMs.toFloat() / duration).coerceIn(0f, 1f)
        val smoothFraction by androidx.compose.animation.core.animateFloatAsState(targetValue = rawFraction, animationSpec = tween(durationMillis = 150), label = "seekSmooth")
        val positionFraction = if (isScrubbing) scrubFraction else smoothFraction

        Column(modifier = Modifier.layoutId("sliderControls"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val activeColor by animateColorAsState(targetValue = if (isExpandedThreshold) Rose500 else Color.Transparent, animationSpec = tween(500), label = "sliderColor")
            Slider(
                value = positionFraction, 
                onValueChange = { scrubFraction = it; isScrubbing = true }, 
                onValueChangeFinished = { controllerManager.seekTo((scrubFraction * duration).toLong()); isScrubbing = false }, 
                enabled = isExpandedThreshold,
                colors = androidx.compose.material3.SliderDefaults.colors(
                    thumbColor = activeColor, 
                    activeTrackColor = activeColor, 
                    inactiveTrackColor = if (isExpandedThreshold) Ink700 else Color.Transparent,
                    disabledThumbColor = Color.Transparent,
                    disabledActiveTrackColor = Color.Transparent,
                    disabledInactiveTrackColor = Color.Transparent
                )
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatTime((positionFraction * duration).toLong()), style = MaterialTheme.typography.labelMedium, color = Mist200)
                Text(formatTime(duration), style = MaterialTheme.typography.labelMedium, color = Mist200)
            }
        }
        
        Row(modifier = Modifier.layoutId("playbackControls").fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { nowPlayingManager.toggleShuffle() }) { Icon(Icons.Rounded.Shuffle, "Shuffle", tint = if (npState.isShuffled) Rose500 else Mist200) }
            IconButton(onClick = { controllerManager.seekToPrevious() }) { Icon(Icons.Rounded.SkipPrevious, "Previous", tint = Mist100, modifier = Modifier.size(36.dp)) }
            Box(Modifier.size(72.dp)) // Spacer for middle play button inside MotionLayout
            Box(Modifier.size(48.dp)) // Spacer for next button
            IconButton(onClick = { controllerManager.toggleRepeatMode() }) {
                Icon(if (pbState.repeatMode == Player.REPEAT_MODE_ONE) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat, "Repeat", tint = if (pbState.repeatMode == Player.REPEAT_MODE_OFF) Mist200 else Rose500)
            }
        }
        
        Row(modifier = Modifier.layoutId("upNextRow").fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
            GlassActionPill(icon = Icons.AutoMirrored.Rounded.QueueMusic, label = "Up Next", onClick = { showUpNext = true })
        }
    }
}

@Composable
fun PlayerBackgroundArt(imageUrl: String?) {
    if (imageUrl.isNullOrBlank()) return
    AsyncImage(model = imageUrl, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alpha = 0.18f)
}

@Composable
fun BackdropGlow() {
    Canvas(modifier = Modifier.fillMaxSize()) {
        val softStroke = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round)
        drawCircle(brush = Brush.radialGradient(listOf(Rose500.copy(alpha = 0.35f), Color.Transparent), radius = size.minDimension * 0.65f), radius = size.minDimension * 0.65f, center = center.copy(x = size.width * 0.8f, y = size.height * 0.2f))
        drawCircle(brush = Brush.radialGradient(listOf(Ember400.copy(alpha = 0.3f), Color.Transparent), radius = size.minDimension * 0.7f), radius = size.minDimension * 0.7f, center = center.copy(x = size.width * 0.2f, y = size.height * 0.75f))
        drawCircle(color = Mist200.copy(alpha = 0.12f), radius = size.minDimension * 0.55f, center = center.copy(x = size.width * 0.55f, y = size.height * 0.5f), style = softStroke)
    }
}

@Composable
fun GlassIconButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(modifier = Modifier.size(44.dp).background(Ink800.copy(alpha = 0.6f), CircleShape).border(1.dp, Mist200.copy(alpha = 0.3f), CircleShape), contentAlignment = Alignment.Center) {
        IconButton(onClick = onClick) { content() }
    }
}

@Composable
fun GlassActionPill(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit = {}) {
    Row(modifier = Modifier.background(Ink800.copy(alpha = 0.7f), RoundedCornerShape(24.dp)).border(1.dp, Mist200.copy(alpha = 0.25f), RoundedCornerShape(24.dp)).clickable { onClick() }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, contentDescription = null, tint = Mist100, modifier = Modifier.size(18.dp))
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = Mist100)
    }
}

private fun formatTime(durationMs: Long): String {
    val totalSeconds = max(durationMs, 0L) / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%d:%02d".format(minutes, seconds)
}
