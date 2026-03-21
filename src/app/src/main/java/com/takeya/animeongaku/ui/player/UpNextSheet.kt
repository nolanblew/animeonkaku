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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.DragHandle
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.SheetValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.ui.common.MarqueeText
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.common.dragDropItem
import com.takeya.animeongaku.ui.common.dragHandle
import com.takeya.animeongaku.ui.common.rememberDragDropState
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
    listState: LazyListState,
    isOffline: Boolean = false,
    downloadedThemeIds: Set<Long> = emptySet(),
    dislikedThemeIds: Set<Long> = emptySet(),
    viewModel: PlayerViewModel,
    onDismiss: () -> Unit
) {
    // Measured height of the sheet content — used to compute the dismiss threshold.
    var sheetHeightPx by remember { mutableIntStateOf(0) }

    // Holder populated right after sheetState is created to avoid a forward-reference
    // inside the confirmValueChange lambda (sheetState can't reference itself).
    val sheetStateHolder = remember { mutableStateOf<SheetState?>(null) }

    // Only allow the sheet to dismiss if the user dragged it down by more than 30% of its
    // height. Anything less snaps back to the expanded position.
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { newValue: SheetValue ->
            when {
                newValue != SheetValue.Hidden -> true
                else -> {
                    val offset = runCatching { sheetStateHolder.value?.requireOffset() }.getOrNull()
                    offset != null && (sheetHeightPx == 0 || offset > sheetHeightPx * 0.30f)
                }
            }
        }
    )
    sheetStateHolder.value = sheetState

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink900,
        dragHandle = { BottomSheetDefaults.DragHandle() }
    ) {
        UpNextContent(
            npState = npState,
            nowPlayingManager = nowPlayingManager,
            listState = listState,
            isOffline = isOffline,
            downloadedThemeIds = downloadedThemeIds,
            dislikedThemeIds = dislikedThemeIds,
            viewModel = viewModel,
            modifier = Modifier
                .fillMaxHeight(0.95f)
                .onSizeChanged { sheetHeightPx = it.height }
        )
    }
}

private fun historyKey(index: Int, themeId: Long): String = "history-$index-$themeId"

private fun queueKey(queueIdx: Int): String = "queue-$queueIdx"

private fun queueIndexFromKey(key: Any): Int? =
    (key as? String)?.removePrefix("queue-")?.toIntOrNull()

@Composable
private fun UpNextContent(
    npState: NowPlayingState,
    nowPlayingManager: NowPlayingManager,
    listState: LazyListState,
    isOffline: Boolean = false,
    downloadedThemeIds: Set<Long> = emptySet(),
    dislikedThemeIds: Set<Long> = emptySet(),
    viewModel: PlayerViewModel,
    modifier: Modifier = Modifier
) {
    val history = npState.history
    val currentTheme = npState.currentTheme
    val upcoming = npState.upcomingTracks

    // Track whether this is the first render. On first render we skip the scroll animation
    // because PlayerScreen pre-positions the list — animating would cause a visible jump.
    var isFirstRender by remember { mutableStateOf(true) }

    val dragDropState = rememberDragDropState(listState) { fromKey, toKey ->
        val fromQueueIdx = queueIndexFromKey(fromKey)
        val toQueueIdx = queueIndexFromKey(toKey)
        
        // Only allow moving items that are in the upcoming tracks section
        if (fromQueueIdx != null && toQueueIdx != null && fromQueueIdx > npState.currentIndex && toQueueIdx > npState.currentIndex) {
            nowPlayingManager.moveItem(fromQueueIdx, toQueueIdx)
            true
        } else {
            false
        }
    }

    // After the LazyColumn has consumed all the scroll/fling it can, consume any remaining
    // downward movement so it doesn't propagate to the sheet's dismiss handler.
    // Using onPostScroll/onPostFling (not onPreScroll) so the list itself still scrolls normally.
    val blockSheetDismissScroll = remember {
        object : NestedScrollConnection {
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                return if (available.y > 0f) Offset(0f, available.y) else Offset.Zero
            }
            override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
                return if (available.y > 0f) Velocity(0f, available.y) else Velocity.Zero
            }
        }
    }

    val suggestedSet = remember(npState.suggestedItems) { npState.suggestedItems.toSet() }
    val firstSuggestedIdx = remember(upcoming, suggestedSet) { upcoming.indexOfFirst { it in suggestedSet } }
    val upNextCount = remember(firstSuggestedIdx, upcoming) { if (firstSuggestedIdx == -1) upcoming.size else firstSuggestedIdx }

    LaunchedEffect(history.size) {
        // On first render the list is pre-positioned by PlayerScreen — skip animation to
        // avoid a visible jump. On subsequent changes (new song plays) animate smoothly.
        if (isFirstRender) {
            isFirstRender = false
            return@LaunchedEffect
        }
        if (history.isNotEmpty() && dragDropState.draggingItemKey == null) {
            listState.animateScrollToItem(history.size)
        }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 8.dp),
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
        
        var selectedActionTheme by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<Pair<Int, ThemeEntity>?>(null) }
        selectedActionTheme?.let { (npIdx, t) ->
            val isDisliked = t.id in dislikedThemeIds
            ActionSheet(
                config = ActionSheetConfig(
                    title = t.title,
                    subtitle = npState.animeMap[t.animeId]?.title ?: "Unknown Anime",
                    imageUrl = npState.animeMap[t.animeId]?.primaryArtworkUrl(),
                    isSkippedContext = isDisliked,
                    showPlayNext = npIdx != npState.currentIndex,
                    showAddToQueue = false, showReplaceQueue = false, showSaveToPlaylist = false,
                    showRemoveFromQueue = npIdx != npState.currentIndex,
                    showRemoveDislike = isDisliked,
                    showUnskip = isDisliked
                ),
                onDismiss = { selectedActionTheme = null },
                onPlayNext = { nowPlayingManager.moveToPlayNext(npIdx) },
                onRemoveFromQueue = { nowPlayingManager.removeFromQueue(npIdx) },
                onUnskip = { nowPlayingManager.unskip(npIdx) },
                onRemoveDislike = { viewModel.toggleDislike(t.id) }
            )
        }

        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .nestedScroll(blockSheetDismissScroll)
        ) {
            // History section
            if (history.isNotEmpty()) {
                item {
                    Text(
                        text = "Previously played",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200.copy(alpha = 0.6f),
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)
                    )
                }
                itemsIndexed(
                    items = history,
                    key = { index, theme -> historyKey(index, theme.id) }
                ) { index, theme ->
                    val queueIdx = index
                    val anime = theme.animeId?.let { npState.animeMap[it] }
                    val isUnavailable = isOffline && theme.id !in downloadedThemeIds
                    val isDisliked = theme.id in dislikedThemeIds
                    val key = historyKey(index, theme.id)
                    val isDragging = dragDropState.draggingItemKey == key
                    QueueTrackRow(
                        theme = theme,
                        anime = anime,
                        isHistory = true,
                        isCurrent = false,
                        isUnavailable = isUnavailable,
                        isDisliked = isDisliked,
                        onClick = { if (!isUnavailable) nowPlayingManager.rewindTo(index) },
                        onLongClick = { selectedActionTheme = queueIdx to theme },
                        modifier = Modifier
                            .then(if (isDragging) Modifier else Modifier.animateItem())
                            .dragDropItem(dragDropState, key)
                    )
                }
                item {
                    HorizontalDivider(
                        color = Mist200.copy(alpha = 0.1f),
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
                }
            }

            if (currentTheme != null) {
                item(key = queueKey(npState.currentIndex)) {
                    val key = queueKey(npState.currentIndex)
                    val anime = currentTheme.animeId?.let { npState.animeMap[it] }
                    QueueTrackRow(
                        theme = currentTheme,
                        anime = anime,
                        isHistory = false,
                        isCurrent = true,
                        isDisliked = currentTheme.id in dislikedThemeIds,
                        onClick = { },
                        onLongClick = { selectedActionTheme = npState.currentIndex to currentTheme },
                        modifier = Modifier.dragDropItem(dragDropState, key)
                    )
                }
            }

            // Up next / Autoplay sections

            if (upNextCount > 0) {
                item {
                    Text(
                        text = "Up next",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)
                    )
                }
                items(
                    count = upNextCount,
                    key = { idx -> queueKey(npState.currentIndex + 1 + idx) }
                ) { idx ->
                    val theme = upcoming[idx]
                    val queueIdx = npState.currentIndex + 1 + idx
                    val anime = theme.animeId?.let { npState.animeMap[it] }
                    val isUnavailable = isOffline && theme.id !in downloadedThemeIds
                    val isDisliked = theme.id in dislikedThemeIds
                    val key = queueKey(queueIdx)
                    val isDragging = dragDropState.draggingItemKey == key
                    QueueTrackRow(
                        theme = theme,
                        anime = anime,
                        isHistory = false,
                        isCurrent = false,
                        isSuggested = false,
                        isUnavailable = isUnavailable,
                        isDisliked = isDisliked,
                        onClick = { if (!isUnavailable) nowPlayingManager.skipTo(queueIdx) },
                        onLongClick = { selectedActionTheme = queueIdx to theme },
                        modifier = Modifier
                            .then(if (isDragging) Modifier else Modifier.animateItem())
                            .dragDropItem(dragDropState, key),
                        dragModifier = Modifier.dragHandle(dragDropState, key)
                    )
                }
            }

            if (firstSuggestedIdx != -1) {
                item {
                    Text(
                        text = "Autoplay",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200.copy(alpha = 0.6f),
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
                }
                val autoplayCount = upcoming.size - firstSuggestedIdx
                items(
                    count = autoplayCount,
                    key = { offset -> queueKey(npState.currentIndex + 1 + firstSuggestedIdx + offset) }
                ) { offset ->
                    val idx = firstSuggestedIdx + offset
                    val theme = upcoming[idx]
                    val queueIdx = npState.currentIndex + 1 + idx
                    val anime = theme.animeId?.let { npState.animeMap[it] }
                    val isUnavailable = isOffline && theme.id !in downloadedThemeIds
                    val isDisliked = theme.id in dislikedThemeIds
                    val key = queueKey(queueIdx)
                    val isDragging = dragDropState.draggingItemKey == key
                    QueueTrackRow(
                        theme = theme,
                        anime = anime,
                        isHistory = false,
                        isCurrent = false,
                        isSuggested = theme in suggestedSet,
                        isUnavailable = isUnavailable,
                        isDisliked = isDisliked,
                        onClick = { if (!isUnavailable) nowPlayingManager.skipTo(queueIdx) },
                        onLongClick = { selectedActionTheme = queueIdx to theme },
                        modifier = Modifier
                            .then(if (isDragging) Modifier else Modifier.animateItem())
                            .dragDropItem(dragDropState, key),
                        dragModifier = Modifier.dragHandle(dragDropState, key)
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
    onLongClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    dragModifier: Modifier = Modifier
) {
    val info = theme.displayInfo(anime)
    val imageUrls = remember(anime) { anime?.primaryArtworkUrls() ?: emptyList() }
    val alpha = when {
        isUnavailable || isDisliked -> 0.3f
        isHistory -> 0.45f
        isCurrent -> 1f
        isSuggested -> 0.6f
        else -> 0.85f
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .alpha(alpha)
            .let { if (isCurrent) it.background(Rose500.copy(alpha = 0.08f)) else it }
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onClick() },
                    onLongPress = { onLongClick?.invoke() }
                )
            }
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (isCurrent) {
            Icon(
                Icons.Rounded.GraphicEq,
                contentDescription = "Now playing",
                tint = Rose500,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
        }

        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Ink800)
        ) {
            if (imageUrls.isNotEmpty()) {
                FallbackAsyncImage(
                    urls = imageUrls,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize()
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

        if (dragModifier != Modifier) {
            Spacer(modifier = Modifier.width(8.dp))
            Box(
                modifier = dragModifier.size(48.dp),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Rounded.DragHandle,
                    contentDescription = "Reorder",
                    tint = Mist200,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}
