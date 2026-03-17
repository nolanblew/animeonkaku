package com.takeya.animeongaku.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.ui.common.MarqueeText
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpNextSheet(
    npState: NowPlayingState,
    nowPlayingManager: NowPlayingManager,
    isOffline: Boolean = false,
    downloadedThemeIds: Set<Long> = emptySet(),
    dislikedThemeIds: Set<Long> = emptySet(),
    viewModel: PlayerViewModel,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink900,
        dragHandle = null
    ) {
        UpNextContent(
            npState = npState,
            nowPlayingManager = nowPlayingManager,
            isOffline = isOffline,
            downloadedThemeIds = downloadedThemeIds,
            dislikedThemeIds = dislikedThemeIds,
            viewModel = viewModel,
            modifier = Modifier.fillMaxHeight(0.95f)
        )
    }
}

@Composable
private fun UpNextContent(
    npState: NowPlayingState,
    nowPlayingManager: NowPlayingManager,
    isOffline: Boolean = false,
    downloadedThemeIds: Set<Long> = emptySet(),
    dislikedThemeIds: Set<Long> = emptySet(),
    viewModel: PlayerViewModel,
    modifier: Modifier = Modifier
) {
    val history = npState.history
    val currentTheme = npState.currentTheme
    val upcoming = npState.upcomingTracks

    // Build a unified list: history items + current + upcoming
    // We'll use the history size as the scroll target
    val listState = rememberLazyListState()

    LaunchedEffect(history.size) {
        // Auto-scroll to keep current track visible
        if (history.isNotEmpty()) {
            listState.animateScrollToItem(history.size)
        }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Now Playing",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = Mist100
                )
                if (npState.contextLabel.isNotBlank()) {
                    Text(
                        text = "Playing from ${npState.contextLabel}",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            if (npState.isShuffled) {
                Text(
                    text = "Shuffle on",
                    style = MaterialTheme.typography.labelSmall,
                    color = Rose500,
                    modifier = Modifier.padding(start = 12.dp)
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
        
        var selectedDislikedTheme by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<Pair<Int, ThemeEntity>?>(null) }
        selectedDislikedTheme?.let { (npIdx, t) ->
            ActionSheet(
                config = ActionSheetConfig(
                    title = "Skipping because disliked",
                    subtitle = "This song was skipped. You can unskip to play it.",
                    isSkippedContext = true,
                    showPlayNext = false, showAddToQueue = false, showReplaceQueue = false, showSaveToPlaylist = false,
                    showRemoveDislike = true,
                    showUnskip = true
                ),
                onDismiss = { selectedDislikedTheme = null },
                onUnskip = { nowPlayingManager.unskip(npIdx); selectedDislikedTheme = null },
                onRemoveDislike = { viewModel.toggleDislike(t.id); selectedDislikedTheme = null }
            )
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize()
        ) {
            // History section
            if (history.isNotEmpty()) {
                item {
                    Text(
                        text = "Previously played",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200.copy(alpha = 0.6f),
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
                }
                itemsIndexed(history) { index, theme ->
                    val anime = theme.animeId?.let { npState.animeMap[it] }
                    val isUnavailable = isOffline && theme.id !in downloadedThemeIds
                    val isDisliked = theme.id in dislikedThemeIds
                    QueueTrackRow(
                        theme = theme,
                        anime = anime,
                        isHistory = true,
                        isCurrent = false,
                        isUnavailable = isUnavailable,
                        isDisliked = isDisliked,
                        onClick = { if (!isUnavailable) nowPlayingManager.rewindTo(index) },
                        onLongClick = if (isDisliked) { { selectedDislikedTheme = index to theme } } else null
                    )
                }
                item {
                    HorizontalDivider(
                        color = Mist200.copy(alpha = 0.1f),
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
                }
            }

            // Current track
            if (currentTheme != null) {
                item {
                    val anime = currentTheme.animeId?.let { npState.animeMap[it] }
                    QueueTrackRow(
                        theme = currentTheme,
                        anime = anime,
                        isHistory = false,
                        isCurrent = true,
                        isDisliked = currentTheme.id in dislikedThemeIds,
                        onClick = { },
                        onLongClick = null
                    )
                }
            }

            // Split upcoming into regular and suggested
            val suggestedSet = npState.suggestedItems.toSet()
            val regularUpcoming = upcoming.filter { it !in suggestedSet }
            val suggestedUpcoming = upcoming.filter { it in suggestedSet }

            // Up next section (user-chosen queue items)
            if (regularUpcoming.isNotEmpty()) {
                item {
                    Text(
                        text = "Up next",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
                }
                // We need the original upcoming index for skipTo
                val regularIndices = upcoming.indices.filter { upcoming[it] !in suggestedSet }
                regularIndices.forEachIndexed { _, upcomingIdx ->
                    val theme = upcoming[upcomingIdx]
                    val anime = theme.animeId?.let { npState.animeMap[it] }
                    val isUnavailable = isOffline && theme.id !in downloadedThemeIds
                    val isDisliked = theme.id in dislikedThemeIds
                    item {
                        QueueTrackRow(
                            theme = theme,
                            anime = anime,
                            isHistory = false,
                            isCurrent = false,
                            isUnavailable = isUnavailable,
                            isDisliked = isDisliked,
                            onClick = { if (!isUnavailable) nowPlayingManager.skipTo(npState.currentIndex + 1 + upcomingIdx) },
                            onLongClick = if (isDisliked) { { selectedDislikedTheme = (npState.currentIndex + 1 + upcomingIdx) to theme } } else null
                        )
                    }
                }
            }

            // Autoplay / suggested section
            if (suggestedUpcoming.isNotEmpty()) {
                item {
                    Text(
                        text = "Autoplay",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200.copy(alpha = 0.6f),
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
                }
                val suggestedIndices = upcoming.indices.filter { upcoming[it] in suggestedSet }
                suggestedIndices.forEachIndexed { _, upcomingIdx ->
                    val theme = upcoming[upcomingIdx]
                    val anime = theme.animeId?.let { npState.animeMap[it] }
                    val isUnavailable = isOffline && theme.id !in downloadedThemeIds
                    val isDisliked = theme.id in dislikedThemeIds
                    item {
                        QueueTrackRow(
                            theme = theme,
                            anime = anime,
                            isHistory = false,
                            isCurrent = false,
                            isSuggested = true,
                            isUnavailable = isUnavailable,
                            isDisliked = isDisliked,
                            onClick = { if (!isUnavailable) nowPlayingManager.skipTo(npState.currentIndex + 1 + upcomingIdx) },
                            onLongClick = if (isDisliked) { { selectedDislikedTheme = (npState.currentIndex + 1 + upcomingIdx) to theme } } else null
                        )
                    }
                }
            }

            // Fallback: if no suggested items, show regular "Up next" for all
            if (upcoming.isNotEmpty() && regularUpcoming.isEmpty() && suggestedUpcoming.isEmpty()) {
                item {
                    Text(
                        text = "Up next",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
                }
                itemsIndexed(upcoming) { index, theme ->
                    val anime = theme.animeId?.let { npState.animeMap[it] }
                    val isUnavailable = isOffline && theme.id !in downloadedThemeIds
                    val isDisliked = theme.id in dislikedThemeIds
                    QueueTrackRow(
                        theme = theme,
                        anime = anime,
                        isHistory = false,
                        isCurrent = false,
                        isUnavailable = isUnavailable,
                        isDisliked = isDisliked,
                        onClick = { if (!isUnavailable) nowPlayingManager.skipTo(npState.currentIndex + 1 + index) },
                        onLongClick = if (isDisliked) { { selectedDislikedTheme = (npState.currentIndex + 1 + index) to theme } } else null
                    )
                }
            }

            item {
                Spacer(modifier = Modifier.height(40.dp))
            }
        }
    }
}

@Composable
private fun QueueTrackRow(
    theme: ThemeEntity,
    anime: AnimeEntity?,
    isHistory: Boolean,
    isCurrent: Boolean,
    isSuggested: Boolean = false,
    isUnavailable: Boolean = false,
    isDisliked: Boolean = false,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null
) {
    val info = theme.displayInfo(anime)
    val imageUrl = anime?.coverUrl ?: anime?.thumbnailUrl
    val alpha = when {
        isUnavailable || isDisliked -> 0.3f
        isHistory -> 0.45f
        isCurrent -> 1f
        isSuggested -> 0.6f
        else -> 0.85f
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(alpha)
            .let { if (isCurrent) it.background(Rose500.copy(alpha = 0.08f)) else it }
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onClick() },
                    onLongPress = { onLongClick?.invoke() }
                )
            }
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (isCurrent) {
            Icon(
                Icons.Rounded.GraphicEq,
                contentDescription = "Now playing",
                tint = Rose500,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
        }

        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Ink800)
        ) {
            if (!imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            MarqueeText(
                text = info.primaryText,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal
                ),
                color = if (isCurrent) Rose500 else Mist100
            )
            MarqueeText(
                text = info.secondaryText,
                style = MaterialTheme.typography.bodySmall,
                color = Mist200
            )
        }
        if (isDisliked) {
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.Rounded.Block, contentDescription = "Skipped", tint = Mist200, modifier = Modifier.size(16.dp))
        }
    }
}
