package com.takeya.animeongaku.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.LibraryAdd
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.automirrored.rounded.PlaylistPlay
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

data class ActionSheetConfig(
    val title: String,
    val subtitle: String,
    val imageUrl: String? = null,
    val showPlayNext: Boolean = true,
    val showAddToQueue: Boolean = true,
    val showReplaceQueue: Boolean = true,
    val showSaveToPlaylist: Boolean = true,
    val showAddToLibrary: Boolean = false,
    val showGoToArtist: Boolean = false,
    val showGoToAnime: Boolean = false,
    val artistName: String? = null,
    val animeName: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionSheet(
    config: ActionSheetConfig,
    onDismiss: () -> Unit,
    onPlayNext: () -> Unit = {},
    onAddToQueue: () -> Unit = {},
    onReplaceQueue: () -> Unit = {},
    onSaveToPlaylist: () -> Unit = {},
    onAddToLibrary: () -> Unit = {},
    onGoToArtist: () -> Unit = {},
    onGoToAnime: () -> Unit = {}
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink900,
        dragHandle = null
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 24.dp)
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Ink800)
                ) {
                    if (!config.imageUrl.isNullOrBlank()) {
                        AsyncImage(
                            model = config.imageUrl,
                            contentDescription = null,
                            modifier = Modifier.matchParentSize(),
                            contentScale = ContentScale.Crop
                        )
                    }
                }
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = config.title,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = Mist100,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = config.subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = Mist200,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Rounded.Close, contentDescription = "Close", tint = Mist200)
                }
            }

            // Top action buttons
            val topActions = mutableListOf<@Composable (Modifier) -> Unit>()
            if (config.showPlayNext) {
                topActions.add { mod ->
                    ActionButton(
                        icon = { Icon(Icons.Rounded.SkipNext, contentDescription = null, tint = Mist100, modifier = Modifier.size(24.dp)) },
                        label = "Play next",
                        modifier = mod,
                        onClick = { onPlayNext(); onDismiss() }
                    )
                }
            }
            if (config.showSaveToPlaylist) {
                topActions.add { mod ->
                    ActionButton(
                        icon = { Icon(Icons.AutoMirrored.Rounded.PlaylistAdd, contentDescription = null, tint = Mist100, modifier = Modifier.size(24.dp)) },
                        label = "Save to playlist",
                        modifier = mod,
                        onClick = { onSaveToPlaylist(); onDismiss() }
                    )
                }
            }

            if (topActions.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    topActions.forEach { action -> action(Modifier.weight(1f)) }
                }
            }

            Spacer(modifier = Modifier.height(4.dp))
            HorizontalDivider(color = Mist200.copy(alpha = 0.1f), modifier = Modifier.padding(horizontal = 16.dp))
            Spacer(modifier = Modifier.height(4.dp))

            // List items
            if (config.showAddToQueue) {
                OptionRow(
                    icon = { Icon(Icons.AutoMirrored.Rounded.QueueMusic, contentDescription = null, tint = Mist100) },
                    label = "Add to queue",
                    onClick = { onAddToQueue(); onDismiss() }
                )
            }
            if (config.showReplaceQueue) {
                OptionRow(
                    icon = { Icon(Icons.AutoMirrored.Rounded.PlaylistPlay, contentDescription = null, tint = Mist100) },
                    label = "Replace queue",
                    onClick = { onReplaceQueue(); onDismiss() }
                )
            }
            if (config.showAddToLibrary) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.LibraryAdd, contentDescription = null, tint = Mist100) },
                    label = "Add to library",
                    onClick = { onAddToLibrary(); onDismiss() }
                )
            }
            if (config.showGoToArtist) {
                val label = config.artistName?.let { "Go to $it" } ?: "Go to artist"
                OptionRow(
                    icon = { Icon(Icons.Rounded.Person, contentDescription = null, tint = Mist100) },
                    label = label,
                    onClick = { onGoToArtist(); onDismiss() }
                )
            }
            if (config.showGoToAnime) {
                val label = config.animeName?.let { "Go to $it" } ?: "Go to anime"
                OptionRow(
                    icon = { Icon(Icons.Rounded.Movie, contentDescription = null, tint = Mist100) },
                    label = label,
                    onClick = { onGoToAnime(); onDismiss() }
                )
            }
        }
    }
}

@Composable
private fun ActionButton(
    icon: @Composable () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Ink700.copy(alpha = 0.6f))
            .clickable { onClick() }
            .padding(vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        icon()
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = Mist200
        )
    }
}

@Composable
private fun OptionRow(
    icon: @Composable () -> Unit,
    label: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        icon()
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = Mist100
        )
    }
}
