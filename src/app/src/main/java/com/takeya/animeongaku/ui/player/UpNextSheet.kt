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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.ui.common.MarqueeText
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
            modifier = Modifier.fillMaxHeight(0.95f)
        )
    }
}

@Composable
private fun UpNextContent(
    npState: NowPlayingState,
    nowPlayingManager: NowPlayingManager,
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
                    QueueTrackRow(
                        theme = theme,
                        anime = anime,
                        isHistory = true,
                        isCurrent = false,
                        onClick = { nowPlayingManager.rewindTo(index) }
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
                        onClick = { }
                    )
                }
            }

            // Up next section
            if (upcoming.isNotEmpty()) {
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
                    QueueTrackRow(
                        theme = theme,
                        anime = anime,
                        isHistory = false,
                        isCurrent = false,
                        onClick = { nowPlayingManager.skipTo(npState.currentIndex + 1 + index) }
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
    onClick: () -> Unit
) {
    val info = theme.displayInfo(anime)
    val imageUrl = anime?.coverUrl ?: anime?.thumbnailUrl
    val alpha = when {
        isHistory -> 0.45f
        isCurrent -> 1f
        else -> 0.85f
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(alpha)
            .let { if (isCurrent) it.background(Rose500.copy(alpha = 0.08f)) else it }
            .clickable { onClick() }
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
    }
}
