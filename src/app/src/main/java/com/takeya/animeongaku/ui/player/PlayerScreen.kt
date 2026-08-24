package com.takeya.animeongaku.ui.player

import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.playerDisplayInfo
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import com.takeya.animeongaku.ui.common.BrowseVideoWarningDialog

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material.icons.rounded.Fullscreen
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
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
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.media.MediaControllerManager
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.preferredModeForThemeAction
import com.takeya.animeongaku.ui.common.themeModePreferenceAction
import com.takeya.animeongaku.ui.common.MarqueeText
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import kotlin.math.max

@OptIn(ExperimentalMotionApi::class, ExperimentalFoundationApi::class)
@Composable
fun PlayerScreen(
    progress: Float,
    swipeUpTrigger: Boolean = false,
    onSwipeUpHandled: () -> Unit = {},
    onExpand: () -> Unit = {},
    onCollapse: () -> Unit = {},
    onRequestFullscreen: (() -> Unit)? = null,
    onOpenAnime: (String) -> Unit = {},
    onOpenRelatedMusic: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
    playerWidth: Dp? = null,
    playerHeight: Dp? = null,
    minimumArtworkSize: Dp = PLAYER_ARTWORK_MIN_DP.dp,
    showQueueInline: Boolean = false,
    viewModel: PlayerViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val npState by viewModel.nowPlayingState.collectAsStateWithLifecycle()
    val pbState by viewModel.playbackState.collectAsStateWithLifecycle()
    val modeUiState by viewModel.modeUiState.collectAsStateWithLifecycle()
    val mediaController by viewModel.mediaControllerManager.mediaController.collectAsStateWithLifecycle()
    val currentPreference by viewModel.currentPreference.collectAsStateWithLifecycle()
    val currentSongPreference by viewModel.currentSongPreference.collectAsStateWithLifecycle()
    val hasRelatedMusic by viewModel.hasRelatedMusic.collectAsStateWithLifecycle()
    val nowPlayingManager = viewModel.nowPlayingManager
    val controllerManager = viewModel.mediaControllerManager

    var showUpNext by remember { mutableStateOf(false) }
    var scopedDislikeThemeId by remember { mutableStateOf<Long?>(null) }
    var showPlayerSheet by remember { mutableStateOf(false) }
    var pendingModeConfirmation by remember {
        mutableStateOf<Pair<Long, ModeSelectionDecision.Confirm>?>(null)
    }
    var pendingBrowseVideo by remember {
        mutableStateOf<Pair<Long, BrowseVideoStartRequest>?>(null)
    }

    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    val playlistCoverUrls by viewModel.playlistCoverUrls.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    val downloadedMediaKeys by viewModel.downloadedMediaKeys.collectAsStateWithLifecycle()
    val dislikedThemeIds by viewModel.dislikedThemeIds.collectAsStateWithLifecycle()
    val queuedThemeModesById by viewModel.queuedThemeModesById.collectAsStateWithLifecycle()

    pendingBrowseVideo?.let { (queueId, request) ->
        BrowseVideoWarningDialog(request, { pendingBrowseVideo = null }) {
            pendingBrowseVideo = null
            if (viewModel.startQueuedThemeVideo(queueId, request)) onExpand()
        }
    }

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
            isOffline = !isOnline,
            downloadedMediaKeys = downloadedMediaKeys,
            dislikedThemeIds = dislikedThemeIds,
            viewModel = viewModel,
            inline = showQueueInline,
            onDismiss = { showUpNext = false }
        )
        if (showQueueInline) return
    }

    if (showPlayerSheet) {
        val currentEntry = npState.currentEntry
        if (currentEntry != null) {
            val item = currentEntry.item
            val theme = currentEntry.themeOrNull
            val animeEntity = item.anime ?: theme?.animeId?.let { npState.animeMap[it] }
            val animeImageUrls = buildList {
                item.display.artworkUrl?.let(::add)
                addAll(animeEntity?.primaryArtworkUrls().orEmpty())
            }.distinct()
            var songInLibrary by remember { mutableStateOf(true) }
            LaunchedEffect(theme?.id) {
                songInLibrary = theme?.let { viewModel.isInLibrary(it.id) } ?: true
            }
            ActionSheet(
                config = ActionSheetConfig(
                    title = item.display.title,
                    subtitle = listOfNotNull(item.display.artist, item.display.animeTitle ?: item.display.album)
                        .joinToString(" · "),
                    imageUrl = animeImageUrls.firstOrNull(), imageUrls = animeImageUrls,
                    showPlayNext = false, showAddToQueue = false, showReplaceQueue = false,
                    showSaveToPlaylist = theme != null,
                    showAddToLibrary = theme != null && !songInLibrary,
                    showGoToArtist = !item.display.artist.isNullOrBlank(),
                    showGoToAnime = animeEntity?.kitsuId != null,
                    showRelatedMusic = animeEntity?.kitsuId != null && hasRelatedMusic,
                    showDownload = item is PlayableItem.RelatedSong || theme != null,
                    showPlayVideo = theme != null && BrowseVideoActionPolicy.singleTheme(
                        isOnline, queuedThemeModesById[theme.id]
                    ),
                    artistName = item.display.artist?.split(",")?.firstOrNull()?.trim(),
                    animeName = animeEntity?.title,
                    customActions = if (theme == null) emptyList() else listOfNotNull(
                        themeModePreferenceAction(
                            queuedThemeModesById[theme.id]?.fullSizeUrl?.isNotBlank(),
                            currentPreference?.preferredMode
                        )
                    )
                ),
                onDismiss = { showPlayerSheet = false },
                onPlayVideo = {
                    val queueId = npState.currentEntry?.queueId ?: return@ActionSheet
                    val request = viewModel.requestQueuedThemeVideo(queueId) ?: return@ActionSheet
                    if (request.warning != null) pendingBrowseVideo = queueId to request
                    else if (viewModel.startQueuedThemeVideo(queueId, request)) onExpand()
                },
                onSaveToPlaylist = { theme?.let { pickerThemeIds = listOf(it.id) } },
                onGoToArtist = { item.display.artist?.split(",")?.firstOrNull()?.trim()?.let { onOpenArtist(it) } },
                onGoToAnime = { animeEntity?.kitsuId?.let { onOpenAnime(it) } },
                onRelatedMusic = { animeEntity?.kitsuId?.let { onOpenRelatedMusic(it) } },
                onAddToLibrary = { theme?.let { viewModel.saveSongToLibrary(it, animeEntity) } },
                onDownload = { viewModel.downloadCurrent(item) },
                onCustomAction = { key ->
                    val mode = preferredModeForThemeAction(key)
                    if (theme != null && mode != null) viewModel.setPreferredMode(theme.id, mode)
                }
            )
        }
    }

    pickerThemeIds?.let { ids ->
        PlaylistPickerSheet(
            playlists = playlists, coverUrls = playlistCoverUrls, onDismiss = { pickerThemeIds = null },
            onSelectPlaylist = { playlistId -> viewModel.addToPlaylist(playlistId, ids); pickerThemeIds = null },
            onCreatePlaylist = { name -> viewModel.createAndAddToPlaylist(name, ids); pickerThemeIds = null },
            showThemeModeChoice = true,
            onSelectPlaylistWithMode = { playlistId, modeOverride ->
                viewModel.addToPlaylist(playlistId, ids, modeOverride)
                pickerThemeIds = null
            },
            onCreatePlaylistWithMode = { name, modeOverride ->
                viewModel.createAndAddToPlaylist(name, ids, modeOverride)
                pickerThemeIds = null
            }
        )
    }

    val currentEntry = npState.currentEntry
    val currentItem = currentEntry?.item
    val currentTheme = currentEntry?.themeOrNull
    val currentSong = (currentItem as? PlayableItem.RelatedSong)?.song
    val animeEntity = currentItem?.anime ?: currentTheme?.animeId?.let { npState.animeMap[it] }
    val backgroundArtUrl = currentItem?.display?.artworkUrl ?: animeEntity?.backgroundArtworkUrl()
    val playerDisplay = currentItem?.let { playerDisplayInfo(it, animeEntity) }
    val title = playerDisplay?.primaryText ?: "Select a song"
    val artist = playerDisplay?.secondaryText ?: "Choose a track from your library"
    val expandedTitle = title
    val expandedArtist = artist
    val upNextEntry = npState.upcomingEntries.firstOrNull { entry ->
        val queueIdx = npState.indexOfQueueId(entry.queueId)
        entry.themeOrNull?.id !in dislikedThemeIds || entry.queueId in npState.unskippedEntryIds
    }
    val upNextTheme = upNextEntry?.themeOrNull
    val upNextItem = upNextEntry?.item
    val upNextAnime = upNextItem?.anime ?: upNextTheme?.animeId?.let { npState.animeMap[it] }
    val upNextArtworkUrls = buildList {
        upNextItem?.display?.artworkUrl?.let(::add)
        addAll(upNextAnime?.primaryArtworkUrls().orEmpty())
    }.distinct()
    val upNextAnimeName = upNextItem?.display?.animeTitle ?: upNextItem?.display?.album ?: "Nothing queued"
    val upNextThemeTag = formatThemeTag(upNextTheme?.themeType)
    val isExpanded = progress > 0.5f
    val configuration = LocalConfiguration.current
    val expandedArtworkSize = expandedPlayerArtworkSize(
        playerWidth ?: configuration.screenWidthDp.dp,
        playerHeight ?: configuration.screenHeightDp.dp,
        minimumArtworkSize
    )
    val artHorizontalInset = if (modeUiState.isVideo) 0 else PLAYER_CONTENT_MARGIN_DP
    val fullscreenVideo = isFullscreenVideo(
        orientation = configuration.orientation,
        isVideo = modeUiState.isVideo,
        isExpanded = isExpanded
    )

    pendingModeConfirmation?.let { (queueId, confirmation) ->
        AlertDialog(
            onDismissRequest = { pendingModeConfirmation = null },
            title = { Text("Content warning") },
            text = { Text(confirmation.warning.message) },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingModeConfirmation = null
                        if (npState.currentEntry?.queueId == queueId) {
                            viewModel.selectThemeMode(confirmation.mode)
                        }
                    }
                ) { Text("Play video") }
            },
            dismissButton = {
                TextButton(onClick = { pendingModeConfirmation = null }) { Text("Cancel") }
            }
        )
    }

    val topInsetDp = WindowInsets.systemBars.asPaddingValues().calculateTopPadding().value.toInt()
    // Sit just clear of the status bar rather than well below it. Every dp saved here is a dp
    // the artwork can use, and the header was reading as floating in the middle of the gap.
    val endTopMargin = max(8, topInsetDp + 6)

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
                     art: { width: 'spread', height: ${expandedArtworkSize.value}, start: ['parent', 'start', $artHorizontalInset], end: ['parent', 'end', $artHorizontalInset], top: ['topBar', 'bottom', 6], custom: { corner: 24 } },
                     titles: { width: 'spread', height: 'wrap', start: ['parent', 'start', 24], end: ['parent', 'end', 24], top: ['art', 'bottom', 8] },
                     statusBadge: { width: 'wrap', height: 'wrap', end: ['art', 'end', 8], bottom: ['art', 'bottom', 8], alpha: 0 },
                     playPause: { width: 68, height: 68, start: ['parent', 'start'], end: ['parent', 'end'], top: ['playbackControls', 'top'], bottom: ['playbackControls', 'bottom'] },
                     next: { width: 48, height: 48, start: ['playPause', 'end', 12], top: ['playbackControls', 'top'], bottom: ['playbackControls', 'bottom'] },
                     miniProgress: { width: 'spread', height: 2, start: ['parent', 'start'], end: ['parent', 'end'], top: ['parent', 'top'], alpha: 0 },
                     sliderControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', $PLAYER_CONTENT_MARGIN_DP], end: ['parent', 'end', $PLAYER_CONTENT_MARGIN_DP], top: ['titles', 'bottom', 6], alpha: 1 },
                     playbackControls: { width: 'spread', height: 'wrap', start: ['parent', 'start', 12], end: ['parent', 'end', 12], top: ['sliderControls', 'bottom', 4], alpha: 1 },
                     reactionRow: { width: 'spread', height: 'wrap', start: ['parent', 'start', 72], end: ['parent', 'end', 72], top: ['playbackControls', 'bottom', 4], bottom: ['upNextRow', 'top', 8], alpha: 1 },
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

        Box(modifier = Modifier.layoutId("topBar").fillMaxWidth()) {
            IconButton(onClick = onCollapse, modifier = Modifier.align(Alignment.CenterStart)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Collapse player", tint = Rose500)
            }
            Text(
                text = "Now Playing",
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                color = Mist100,
                maxLines = 1,
                modifier = Modifier.align(Alignment.Center)
            )
            Row(modifier = Modifier.align(Alignment.CenterEnd)) {
                if (onRequestFullscreen != null) {
                    IconButton(onClick = onRequestFullscreen, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Rounded.Fullscreen, "Expand player full screen", tint = Rose500)
                    }
                }
                IconButton(onClick = { showPlayerSheet = true }, modifier = Modifier.size(40.dp)) {
                    Icon(Icons.Rounded.MoreVert, "More options", tint = Rose500)
                }
            }
        }

        val onModeSelected: (PlaybackMode) -> Unit = { mode ->
            when (val decision = modeUiState.selectionDecision(mode)) {
                ModeSelectionDecision.Ignore -> Unit
                is ModeSelectionDecision.Apply -> viewModel.selectThemeMode(decision.mode)
                is ModeSelectionDecision.Confirm -> {
                    npState.currentEntry?.queueId?.let { queueId ->
                        pendingModeConfirmation = queueId to decision
                    }
                }
            }
        }

        val cornerProps = motionProperties(id = "art")
        val cornerRadius = cornerProps.value.int("corner") ?: 8
        val artSize = dpLerp(44.dp, expandedArtworkSize, progress.coerceIn(0f, 1f))
        // Build the pager queue: exclude disliked tracks entirely so the user
        // never sees them while swiping. This mirrors shouldIncludeInPlayer()
        // in MediaControllerManager, keeping the pager and media player in sync.
        val playableQueue = remember(npState.nowPlayingEntries, dislikedThemeIds, npState.unskippedEntryIds, npState.currentIndex) {
            npState.nowPlayingEntries.mapIndexedNotNull { index, entry ->
                val isCurrent = index == npState.currentIndex
                val isUnskipped = entry.queueId in npState.unskippedEntryIds
                val isNotDisliked = entry.themeOrNull?.id !in dislikedThemeIds

                if (isCurrent || isUnskipped || isNotDisliked) {
                    index to entry
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

        Box(
            modifier = Modifier.layoutId("art"),
            contentAlignment = Alignment.Center
        ) {
            androidx.compose.foundation.pager.HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize(),
                pageSpacing = if (modeUiState.isVideo) 0.dp else 16.dp,
                userScrollEnabled = isSlightlyExpanded,
                flingBehavior = androidx.compose.foundation.pager.PagerDefaults.flingBehavior(
                    state = pagerState,
                    snapPositionalThreshold = 0.8f
                )
            ) { page ->
                if (modeUiState.isVideo) {
                    if (fullscreenVideo) {
                        Box(Modifier.fillMaxSize().background(Color.Black))
                    } else if (page == pagerState.currentPage) {
                        PlayerVideoSurface(
                            controller = mediaController,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Box(Modifier.fillMaxSize().background(Color.Black))
                    }
                } else {
                    val entry = playableQueue.getOrNull(page)?.second
                    val item = entry?.item
                    val theme = entry?.themeOrNull
                    val anime = item?.anime ?: theme?.animeId?.let { npState.animeMap[it] }
                    val pageArtUrls = buildList {
                        item?.display?.artworkUrl?.let(::add)
                        addAll(anime?.primaryArtworkUrls().orEmpty())
                    }.distinct()
                    val pageTitle = item?.display?.title ?: title
                    // A pager page lays its content out top-start by default. Without this the
                    // artwork hugs the left edge of its page whenever it is narrower than the
                    // page — which is any time the size cap binds — and reads as off-centre.
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Box(
                            modifier = Modifier
                                .size(artSize)
                                .shadow(if (isExpandedThreshold) 24.dp else 0.dp, RoundedCornerShape(cornerRadius.dp))
                                .clip(RoundedCornerShape(cornerRadius.dp))
                                .background(Ink800, RoundedCornerShape(cornerRadius.dp))
                                .border(1.dp, Mist200.copy(alpha = 0.15f), RoundedCornerShape(cornerRadius.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            if (pageArtUrls.isNotEmpty()) {
                                FallbackAsyncImage(
                                    urls = pageArtUrls,
                                    contentDescription = pageTitle,
                                    modifier = Modifier.fillMaxSize(),
                                    loadOriginalSize = playerArtworkLoadsOriginalSize(progress),
                                    crossfade = true
                                )
                            }
                        }
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
                val showsModeStatus = modeUiState.showsModeStatus()
                if (showsModeStatus) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .graphicsLayer { alpha = titlesAlpha },
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        PlayerModeChip(
                            state = modeUiState,
                            onModeSelected = onModeSelected
                        )
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
             if (currentTheme != null) {
                 IconButton(onClick = {
                     if (currentPreference?.isDisliked == true) {
                         viewModel.toggleDislike(currentTheme.id)
                     } else {
                         scopedDislikeThemeId = currentTheme.id
                         viewModel.toggleDislike(currentTheme.id)
                     }
                 }) {
                     Icon(
                         Icons.Rounded.ThumbDown,
                         if (currentPreference?.isDisliked == true) {
                             "Remove dislike"
                         } else {
                             "Dislike all versions, or choose one version only"
                         },
                         tint = if (currentPreference?.isDisliked == true) Rose500 else Mist200,
                         modifier = Modifier.size(26.dp)
                     )
                 }
             } else {
                 IconButton(onClick = { currentSong?.id?.let(viewModel::toggleSongDislike) }) {
                     Icon(
                         Icons.Rounded.ThumbDown,
                         if (currentSongPreference?.isDisliked == true) "Remove Dislike" else "Dislike",
                         tint = if (currentSongPreference?.isDisliked == true) Rose500 else Mist200,
                         modifier = Modifier.size(26.dp)
                     )
                 }
                 Spacer(Modifier.size(48.dp))
             }
             IconButton(onClick = {
                 currentTheme?.id?.let(viewModel::toggleLike)
                     ?: currentSong?.id?.let(viewModel::toggleSongLike)
             }) {
                 Icon(
                     Icons.Rounded.ThumbUp,
                     if (currentPreference?.isLiked == true || currentSongPreference?.isLiked == true) "Remove Like" else "Like",
                     tint = if (currentPreference?.isLiked == true || currentSongPreference?.isLiked == true) Rose500 else Mist200,
                     modifier = Modifier.size(26.dp)
                 )
            }
        }

        scopedDislikeThemeId?.let { themeId ->
            AlertDialog(
                onDismissRequest = { scopedDislikeThemeId = null },
                title = { Text("Dislike this theme") },
                text = { Text("All versions are now hidden. Choose one option to keep the other version visible instead.") },
                confirmButton = {
                    TextButton(onClick = {
                        viewModel.setOnlyModeDislike(themeId, fullSize = true)
                        scopedDislikeThemeId = null
                    }) {
                        Text("Full Size only")
                    }
                },
                dismissButton = {
                    Row {
                        TextButton(onClick = {
                            viewModel.setOnlyModeDislike(themeId, fullSize = false)
                            scopedDislikeThemeId = null
                        }) {
                            Text("TV Size only")
                        }
                        TextButton(onClick = { scopedDislikeThemeId = null }) { Text("Cancel") }
                    }
                }
            )
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
                            text = "  \u00B7  ",
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

    if (fullscreenVideo) {
        LandscapeVideoOverlay(
            controller = mediaController,
            isPlaying = pbState.isPlaying,
            isLiked = currentPreference?.isLiked == true || currentSongPreference?.isLiked == true,
            isDisliked = currentPreference?.isDisliked == true || currentSongPreference?.isDisliked == true,
            onToggleLike = {
                currentTheme?.id?.let(viewModel::toggleLike)
                    ?: currentSong?.id?.let(viewModel::toggleSongLike)
            },
            onToggleDislike = {
                currentTheme?.id?.let(viewModel::toggleDislike)
                    ?: currentSong?.id?.let(viewModel::toggleSongDislike)
            },
            onPrevious = controllerManager::seekToPrevious,
            onPlayPause = { if (pbState.isPlaying) controllerManager.pause() else controllerManager.play() },
            onNext = controllerManager::seekToNext,
            modifier = Modifier.fillMaxSize()
        )
    }
}

/**
 * The artwork pager is first measured at mini-player size and then grows with the player.
 * Switch to a distinct original-size Coil request as soon as expansion starts so the small
 * mini-player decode cannot remain stretched across the full player.
 */
internal fun playerArtworkLoadsOriginalSize(progress: Float): Boolean = progress > 0.1f

/**
 * The horizontal margin shared by the expanded player's artwork and its seek bar, so the
 * two edges line up and cannot drift apart. Artwork is allowed to grow until it hits this
 * margin, which is the tightest the expanded player ever gets.
 */
internal const val PLAYER_CONTENT_MARGIN_DP = 20

/**
 * Vertical space the expanded player's control stack needs below the artwork: the title block,
 * seek bar, transport row, reaction row and the Up Next card, plus comfortable gaps between
 * them. Artwork yields to this rather than the other way round, so the reaction row never gets
 * squeezed down against Up Next.
 */
internal const val PLAYER_STACK_BELOW_ART_DP = 545

/** Never shrink the artwork past this, even on a very short window. */
internal const val PLAYER_ARTWORK_MIN_DP = 200

/** Never grow past this, so a tablet does not turn a square image into a control-stack blocker. */
internal const val PLAYER_ARTWORK_MAX_DP = 400

/**
 * Artwork is the flexible element of the expanded player. It grows until either its margins
 * match the seek bar's or the control stack below it would start to crowd, whichever binds
 * first, so everything fits on screen with even spacing.
 */
internal fun expandedPlayerArtworkSize(
    screenWidth: androidx.compose.ui.unit.Dp,
    availableHeight: androidx.compose.ui.unit.Dp,
    minimumArtworkSize: androidx.compose.ui.unit.Dp = PLAYER_ARTWORK_MIN_DP.dp
): androidx.compose.ui.unit.Dp {
    val widthBound = (screenWidth - (PLAYER_CONTENT_MARGIN_DP * 2).dp).coerceAtLeast(0.dp)
    val heightBound = availableHeight - PLAYER_STACK_BELOW_ART_DP.dp
    return minOf(widthBound, heightBound)
        .coerceIn(minimumArtworkSize, PLAYER_ARTWORK_MAX_DP.dp)
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
