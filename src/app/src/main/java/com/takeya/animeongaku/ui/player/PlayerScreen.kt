package com.takeya.animeongaku.ui.player

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.unit.lerp as dpLerp
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.constraintlayout.compose.ExperimentalMotionApi
import androidx.constraintlayout.compose.MotionLayout
import androidx.constraintlayout.compose.MotionScene
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
import coil.compose.AsyncImage
import coil.request.ImageRequest
import coil.size.Size
import com.takeya.animeongaku.data.local.backgroundArtworkUrl
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
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
    val context = LocalContext.current
    val npState by viewModel.nowPlayingState.collectAsStateWithLifecycle()
    val pbState by viewModel.playbackState.collectAsStateWithLifecycle()
    val currentPreference by viewModel.currentPreference.collectAsStateWithLifecycle()
    val nowPlayingManager = viewModel.nowPlayingManager
    val controllerManager = viewModel.mediaControllerManager

    var showUpNext by remember { mutableStateOf(false) }
    var showPlayerSheet by remember { mutableStateOf(false) }

    // Held here (not inside UpNextSheet) so the scroll position survives close/reopen.
    // Initialized to history.size so the list opens at the current track without animation.
    val upNextListState = rememberLazyListState(
        initialFirstVisibleItemIndex = npState.history.size.coerceAtLeast(0)
    )
    // When the sheet is closed and history grows (new song plays), silently update position
    // so the next open immediately shows the current track.
    LaunchedEffect(npState.history.size) {
        if (!showUpNext) {
            upNextListState.scrollToItem(npState.history.size.coerceAtLeast(0))
        }
    }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()
    val dislikedThemeIds by viewModel.dislikedThemeIds.collectAsStateWithLifecycle()

    LaunchedEffect(swipeUpTrigger) {
        if (swipeUpTrigger) {
            showUpNext = true
            onSwipeUpHandled()
        }
    }

    if (showUpNext) {
        UpNextSheet(
            npState = npState,
            nowPlayingManager = nowPlayingManager,
            listState = upNextListState,
            isOffline = !isOnline,
            downloadedThemeIds = downloadedThemeIds,
            dislikedThemeIds = dislikedThemeIds,
            viewModel = viewModel,
            onDismiss = { showUpNext = false }
        )
    }

    if (showPlayerSheet) {
        val theme = npState.currentTheme
        if (theme != null) {
            val animeEntity = theme.animeId?.let { npState.animeMap[it] }
            val info = theme.displayInfo(animeEntity)
            var songInLibrary by remember { mutableStateOf(true) }
            LaunchedEffect(theme.id) {
                songInLibrary = viewModel.isInLibrary(theme.id)
            }
            ActionSheet(
                config = ActionSheetConfig(
                    title = info.primaryText, subtitle = info.secondaryText, imageUrl = animeEntity?.primaryArtworkUrl(),
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
    val backgroundArtUrl = animeEntity?.backgroundArtworkUrl()
    val trackInfo = currentTheme?.displayInfo(animeEntity)
    val title = trackInfo?.primaryText ?: "Select a song"
    val artist = trackInfo?.secondaryText ?: "Choose a track from your library"
    val expandedTitle = currentTheme?.title ?: "Select a song"
    val expandedArtist = currentTheme?.artistName ?: animeEntity?.title ?: "Choose a track from your library"
    val eyebrowAnimeName = animeEntity?.title?.takeIf { it.isNotBlank() }
    val eyebrowThemeTag = formatThemeTag(currentTheme?.themeType)
    val upNextTheme = npState.upcomingTracks.firstOrNull { theme ->
        val queueIdx = npState.nowPlaying.indexOf(theme)
        !dislikedThemeIds.contains(theme.id) || npState.unskippedIndices.contains(queueIdx)
    }
    val upNextAnime = upNextTheme?.animeId?.let { npState.animeMap[it] }
    val upNextArtworkUrls = upNextAnime?.primaryArtworkUrls() ?: emptyList()
    val upNextAnimeName = upNextAnime?.title?.takeIf { it.isNotBlank() } ?: "Nothing queued"
    val upNextThemeTag = formatThemeTag(upNextTheme?.themeType)

    val topInsetDp = WindowInsets.systemBars.asPaddingValues().calculateTopPadding().value.toInt()
    val endTopMargin = max(16, topInsetDp + 16)

    val motionScene = MotionScene("""{
            ConstraintSets: {
                 start: {
                     bg: { width: 'spread', height: 64, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'] },
                     topBar: { width: 'spread', height: 48, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], alpha: 0 },
                     art: { width: 44, height: 44, start: ['parent', 'start', 12], top: ['parent', 'top', 10], custom: { corner: 8 } },
                     titles: { width: 'spread', height: 'wrap', start: ['art', 'end', 12], end: ['playPause', 'start', 12], top: ['parent', 'top', 12], bottom: ['bg', 'bottom', 12] },
                     statusBadge: { width: 'wrap', height: 'wrap', end: ['art', 'end', 8], bottom: ['art', 'bottom', 8], alpha: 0 },
                     playPause: { width: 40, height: 40, end: ['next', 'start', 12], top: ['parent', 'top', 12], bottom: ['bg', 'bottom', 12] },
                     next: { width: 36, height: 36, end: ['parent', 'end', 12], top: ['parent', 'top', 14], bottom: ['bg', 'bottom', 14] },
                     miniProgress: { width: 'spread', height: 2, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], alpha: 1 },
                     sliderControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['titles', 'bottom', 20], alpha: 0 },
                     playbackControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['sliderControls', 'bottom', 20], alpha: 0 },
                     reactionRow: { width: 'spread', height: 'wrap', start: ['parent', 'start', 48], end: ['parent', 'end', 48], top: ['playbackControls', 'bottom', 14], alpha: 0 },
                     upNextRow: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['reactionRow', 'bottom', 18], alpha: 0 }
                 },
                 end: {
                     bg: { width: 'spread', height: 'spread', start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], bottom: ['parent', 'bottom'] },
                     topBar: { width: 'spread', height: 48, start: ['parent', 'start', 16], end: ['parent', 'end', 16], top: ['parent', 'top', $endTopMargin], alpha: 1 },
                     art: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['topBar', 'bottom', 8], custom: { corner: 24 } },
                     titles: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['art', 'bottom', 12] },
                     statusBadge: { width: 'wrap', height: 'wrap', end: ['art', 'end', 8], bottom: ['art', 'bottom', 8], alpha: 0 },
                     playPause: { width: 72, height: 72, start: ['parent', 'start'], end: ['parent', 'end'], top: ['playbackControls', 'top'], bottom: ['playbackControls', 'bottom'] },
                     next: { width: 48, height: 48, start: ['playPause', 'end', 12], top: ['playbackControls', 'top'], bottom: ['playbackControls', 'bottom'] },
                     miniProgress: { width: 'spread', height: 2, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], alpha: 0 },
                     sliderControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 20], end: ['parent', 'end', 20], top: ['titles', 'bottom', 10], alpha: 1 },
                     playbackControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 12], end: ['parent', 'end', 12], top: ['sliderControls', 'bottom', 8], alpha: 1 },
                     reactionRow: { width: 'spread', height: 'wrap', start: ['parent', 'start', 72], end: ['parent', 'end', 72], top: ['playbackControls', 'bottom', 8], alpha: 1 },
                     upNextRow: { width: 'spread', height: 'wrap', start: ['parent', 'start', 16], end: ['parent', 'end', 16], bottom: ['parent', 'bottom', 24], alpha: 1 }
                 }
             },
             Transitions: { default: { from: 'start', to: 'end' } }
         }""")

    MotionLayout(motionScene = motionScene, progress = progress, modifier = Modifier.fillMaxSize()) {
        val isExpandedThreshold = progress > 0.5f
        val isSlightlyExpanded = progress > 0.1f
        val backgroundGradient = Brush.verticalGradient(listOf(Ink900, if (isSlightlyExpanded) Ink800 else Ink900, if (isSlightlyExpanded) Ink700 else Ink900))
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
            if (isSlightlyExpanded) {
                PlayerBackgroundArt(backgroundArtUrl)
                BackdropGlow()
            }
        }

        Row(modifier = Modifier.layoutId("topBar"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            IconButton(onClick = onCollapse) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Collapse player", tint = Rose500)
            }
            Text(
                text = "Now Playing",
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                color = Mist100
            )
            IconButton(onClick = { showPlayerSheet = true }) {
                Icon(Icons.Rounded.MoreVert, "More options", tint = Rose500)
            }
        }

        val cornerProps = motionProperties(id = "art")
        val cornerRadius = cornerProps.value.int("corner") ?: 8
        BoxWithConstraints(
            modifier = Modifier.layoutId("art").shadow(if (isExpandedThreshold) 24.dp else 0.dp, RoundedCornerShape(cornerRadius.dp)).clip(RoundedCornerShape(cornerRadius.dp)).then(if (isExpandedThreshold) Modifier.background(Ink800, RoundedCornerShape(cornerRadius.dp)).border(1.dp, Mist200.copy(alpha=0.15f), RoundedCornerShape(cornerRadius.dp)) else Modifier),
            contentAlignment = Alignment.Center
        ) {
            val artSize = dpLerp(44.dp, maxWidth, progress.coerceIn(0f, 1f))
            Box(
                modifier = Modifier.size(artSize),
                contentAlignment = Alignment.Center
            ) {
                // Build the pager queue: exclude disliked tracks entirely so the user
                // never sees them while swiping. This mirrors shouldIncludeInPlayer()
                // in MediaControllerManager, keeping the pager and media player in sync.
                val playableQueue = remember(npState.nowPlaying, dislikedThemeIds, npState.unskippedIndices, npState.currentIndex) {
                    npState.nowPlaying.mapIndexedNotNull { index, theme ->
                        val isCurrent = index == npState.currentIndex
                        val isUnskipped = npState.unskippedIndices.contains(index)
                        val isNotDisliked = !dislikedThemeIds.contains(theme.id)

                        if (isCurrent || isUnskipped || isNotDisliked) {
                            index to theme
                        } else {
                            null
                        }
                    }
                }

                val currentPageIndex = playableQueue.indexOfFirst { it.first == npState.currentIndex }.coerceAtLeast(0)

                val pagerState = androidx.compose.foundation.pager.rememberPagerState(
                    initialPage = currentPageIndex,
                    pageCount = { playableQueue.size }
                )

                var lastQueueVersion by remember { androidx.compose.runtime.mutableLongStateOf(npState.queueVersion) }

                LaunchedEffect(currentPageIndex, npState.queueVersion) {
                    if (npState.queueVersion != lastQueueVersion) {
                        pagerState.scrollToPage(currentPageIndex)
                        lastQueueVersion = npState.queueVersion
                    } else if (pagerState.currentPage != currentPageIndex && !pagerState.isScrollInProgress) {
                        pagerState.animateScrollToPage(currentPageIndex)
                    }
                }

                LaunchedEffect(pagerState.isScrollInProgress) {
                    if (!pagerState.isScrollInProgress) {
                        if (pagerState.currentPage != currentPageIndex) {
                            val targetItem = playableQueue.getOrNull(pagerState.currentPage)
                            if (targetItem != null && targetItem.first != npState.currentIndex) {
                                // Always navigate by exact queue index rather than using
                                // seekToNext/seekToPrevious, which can rewind the current
                                // track instead of changing it (ExoPlayer's default behaviour
                                // when played past a few seconds).
                                nowPlayingManager.skipTo(targetItem.first)
                            }

                            // Always force snap exactly to center to fix the 5% peeking issue
                            if (kotlin.math.abs(pagerState.currentPageOffsetFraction) > 0.001f) {
                                pagerState.animateScrollToPage(pagerState.currentPage)
                            }
                        }
                    }
                }

                androidx.compose.foundation.pager.HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxSize(),
                    pageSpacing = 16.dp,
                    userScrollEnabled = isSlightlyExpanded,
                    flingBehavior = androidx.compose.foundation.pager.PagerDefaults.flingBehavior(
                        state = pagerState,
                        snapPositionalThreshold = 0.8f
                    )
                ) { page ->
                    val theme = playableQueue.getOrNull(page)?.second
                    val anime = theme?.animeId?.let { npState.animeMap[it] }
                    val pageArtUrls = anime?.primaryArtworkUrls() ?: emptyList()
                    val pageTitle = theme?.displayInfo(anime)?.primaryText ?: title
                    if (pageArtUrls.isNotEmpty()) {
                        FallbackAsyncImage(
                            urls = pageArtUrls,
                            contentDescription = pageTitle,
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                }
            }
        }

        val titlesAlpha by androidx.compose.animation.core.animateFloatAsState(
            targetValue = if (progress > 0.6f) 1f else 0f,
            animationSpec = tween(durationMillis = 180),
            label = "titlesAlpha"
        )
        Column(
            modifier = Modifier.layoutId("titles").fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(if (isExpandedThreshold) 4.dp else 2.dp),
            horizontalAlignment = if (isExpandedThreshold) Alignment.CenterHorizontally else Alignment.Start
        ) {
            if (isExpandedThreshold) {
                if (eyebrowAnimeName != null || eyebrowThemeTag != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .graphicsLayer { alpha = titlesAlpha },
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (eyebrowAnimeName != null) {
                            MarqueeText(
                                text = eyebrowAnimeName,
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                                color = Color(0xFF56E8F5),
                                modifier = Modifier.weight(1f, fill = false)
                            )
                        }
                        if (eyebrowAnimeName != null && eyebrowThemeTag != null) {
                            Text(
                                text = "  ·  ",
                                style = MaterialTheme.typography.labelLarge,
                                color = Mist200
                            )
                        }
                        if (eyebrowThemeTag != null) {
                            Text(
                                text = eyebrowThemeTag,
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium),
                                color = Mist200,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }
                MarqueeText(
                    text = expandedTitle,
                    modifier = Modifier
                        .fillMaxWidth()
                        .graphicsLayer { alpha = titlesAlpha },
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
                    color = Mist100
                )
                MarqueeText(
                    text = expandedArtist,
                    modifier = Modifier
                        .fillMaxWidth()
                        .graphicsLayer { alpha = titlesAlpha },
                    style = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.Center),
                    color = Mist200
                )
            } else {
                MarqueeText(text = title, style = MaterialTheme.typography.bodyMedium, color = Mist100)
                MarqueeText(text = artist, style = MaterialTheme.typography.bodySmall, color = Mist200)
            }
        }

        val playBgColor by animateColorAsState(
            targetValue = when {
                isExpandedThreshold && pbState.isPlaying -> Rose500
                isExpandedThreshold -> Ember400
                else -> Rose500.copy(alpha = 0.15f)
            },
            animationSpec = tween(durationMillis = 300),
            label = "playBgColor"
        )
        val playIconTint by animateColorAsState(
            targetValue = if (isExpandedThreshold) Ink900 else Mist100,
            animationSpec = tween(durationMillis = 300),
            label = "playIconTint"
        )
        Box(
            modifier = Modifier
                .layoutId("playPause")
                .shadow(if (isExpandedThreshold) 18.dp else 0.dp, CircleShape)
                .background(playBgColor, CircleShape)
                .clip(CircleShape)
                .clickable { if (pbState.isPlaying) controllerManager.pause() else controllerManager.play() },
            contentAlignment = Alignment.Center
        ) {
            if (pbState.isBuffering && !pbState.isPlaying && isExpandedThreshold) {
                CircularProgressIndicator(modifier = Modifier.size(36.dp), color = Ink900, strokeWidth = 3.dp)
            } else {
                Icon(
                    if (pbState.isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    "Play or pause",
                    tint = playIconTint,
                    modifier = Modifier.size(if (isExpandedThreshold) 34.dp else 24.dp)
                )
            }
        }

        // Next/skip button — direct child of MotionLayout so it animates independently
        // of the playbackControls Row (which has alpha: 0 in mini player state).
        Box(
            modifier = Modifier
                .layoutId("next")
                .clip(CircleShape)
                .clickable { controllerManager.seekToNext() },
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Rounded.SkipNext,
                "Next",
                tint = if (isExpandedThreshold) Mist100 else Mist200,
                modifier = Modifier.size(if (isExpandedThreshold) 36.dp else 22.dp)
            )
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
        
        Row(
            modifier = Modifier.layoutId("playbackControls").fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = { nowPlayingManager.toggleShuffle() }, modifier = Modifier.size(52.dp)) {
                Icon(Icons.Rounded.Shuffle, "Shuffle", tint = if (npState.isShuffled) Rose500 else Mist100, modifier = Modifier.size(24.dp))
            }
            IconButton(onClick = { controllerManager.seekToPrevious() }, modifier = Modifier.size(52.dp)) {
                Icon(Icons.Rounded.SkipPrevious, "Previous", tint = Mist100, modifier = Modifier.size(34.dp))
            }
            Box(modifier = Modifier.size(72.dp))
            Box(modifier = Modifier.size(52.dp)) // Next button spacer — actual button is a direct MotionLayout child
            IconButton(onClick = { controllerManager.toggleRepeatMode() }, modifier = Modifier.size(52.dp)) {
                Icon(
                    if (pbState.repeatMode == Player.REPEAT_MODE_ONE) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
                    "Repeat",
                    tint = if (pbState.repeatMode == Player.REPEAT_MODE_OFF) Mist100 else Rose500,
                    modifier = Modifier.size(24.dp)
                )
            }
        }

        Row(
            modifier = Modifier.layoutId("reactionRow").fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
         ) {
             IconButton(onClick = { currentTheme?.id?.let { viewModel.toggleDislike(it) } }) {
                 Icon(
                     Icons.Rounded.ThumbDown,
                     "Dislike",
                     tint = if (currentPreference?.isDisliked == true) Rose500 else Mist200,
                     modifier = Modifier.size(26.dp)
                 )
             }
             IconButton(onClick = { currentTheme?.id?.let { viewModel.toggleLike(it) } }) {
                 Icon(
                     Icons.Rounded.ThumbUp,
                     "Like",
                     tint = if (currentPreference?.isLiked == true) Rose500 else Mist200,
                     modifier = Modifier.size(26.dp)
                 )
            }
        }

        Row(
            modifier = Modifier
                .layoutId("upNextRow")
                .fillMaxWidth()
                .background(Ink800.copy(alpha = 0.78f), RoundedCornerShape(22.dp))
                .border(1.dp, Mist200.copy(alpha = 0.1f), RoundedCornerShape(22.dp))
                .clickable { showUpNext = true }
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(52.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Ember400.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center
            ) {
                if (upNextArtworkUrls.isNotEmpty()) {
                    FallbackAsyncImage(
                        urls = upNextArtworkUrls,
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Icon(Icons.AutoMirrored.Rounded.QueueMusic, contentDescription = null, tint = Mist200)
                }
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = "UP NEXT",
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = Color(0xFF56E8F5)
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(0.dp)
                ) {
                    MarqueeText(
                        text = upNextAnimeName,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = Mist100,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (upNextThemeTag != null) {
                        Text(
                            text = "  ·  ",
                            style = MaterialTheme.typography.titleMedium,
                            color = Mist200
                        )
                        Text(
                            text = upNextThemeTag,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                            color = Mist200,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
            Icon(
                Icons.AutoMirrored.Rounded.QueueMusic,
                contentDescription = "Open queue",
                tint = Mist200,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

@Composable
fun PlayerBackgroundArt(imageUrl: String?) {
    if (imageUrl.isNullOrBlank()) return
    val context = LocalContext.current
    AsyncImage(
        model = ImageRequest.Builder(context)
            .data(imageUrl)
            .size(Size.ORIGINAL)
            .memoryCacheKey("$imageUrl#player-bg")
            .crossfade(true)
            .build(),
        contentDescription = null,
        modifier = Modifier.fillMaxSize(),
        contentScale = ContentScale.Crop,
        alpha = 0.18f
    )
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

private fun formatThemeTag(themeType: String?): String? {
    val raw = themeType?.trim()?.takeIf { it.isNotBlank() } ?: return null
    val match = Regex("^(OP|ED)(\\d+)$", RegexOption.IGNORE_CASE).matchEntire(raw)
    return if (match != null) {
        "${match.groupValues[1].uppercase()} ${match.groupValues[2]}"
    } else {
        raw.uppercase()
    }
}
