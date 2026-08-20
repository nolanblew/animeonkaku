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
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudDownload
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.FilterList
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material.icons.rounded.LibraryAdd
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.automirrored.rounded.PlaylistPlay
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.automirrored.rounded.Undo
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
    val imageUrls: List<String> = emptyList(),
    val isSkippedContext: Boolean = false,
    val showPlayNext: Boolean = true,
    val showAddToQueue: Boolean = true,
    val showReplaceQueue: Boolean = true,
    val showPlayVideo: Boolean = false,
    val showSaveToPlaylist: Boolean = true,
    val showAddToLibrary: Boolean = false,
    val showGoToArtist: Boolean = false,
    val showGoToAnime: Boolean = false,
    val showRelatedMusic: Boolean = false,
    val showDownload: Boolean = false,
    val showDownloading: Boolean = false,
    val showRemoveDownload: Boolean = false,
    val showLike: Boolean = false,
    val isLiked: Boolean = false,
    val showDislike: Boolean = false,
    val isDisliked: Boolean = false,
    val showRemoveDislike: Boolean = false,
    val showUnskip: Boolean = false,
    val showRemoveFromQueue: Boolean = false,
    val showEditFilters: Boolean = false,
    val showSettings: Boolean = false,
    val settingsLabel: String = "Settings",
    val showRefresh: Boolean = false,
    val showDelete: Boolean = false,
    val deleteLabel: String = "Delete",
    val artistName: String? = null,
    val animeName: String? = null,
    val customActions: List<ActionSheetAction> = emptyList()
)

data class ActionSheetAction(
    val key: String,
    val label: String,
    val supportingText: String? = null,
    val enabled: Boolean = true
)

const val PREFER_FULL_SIZE_ACTION = "prefer_full_size"
const val PREFER_TV_SIZE_ACTION = "prefer_tv_size"

fun themeModePreferenceAction(
    fullSizeAvailable: Boolean?,
    preferredMode: String?
): ActionSheetAction? {
    if (fullSizeAvailable != true) return null
    return if (preferredMode == "FULL_SIZE") {
        ActionSheetAction(PREFER_TV_SIZE_ACTION, "Prefer TV Size")
    } else {
        ActionSheetAction(PREFER_FULL_SIZE_ACTION, "Prefer Full Size")
    }
}

fun preferredModeForThemeAction(key: String): String? = when (key) {
    PREFER_FULL_SIZE_ACTION -> "FULL_SIZE"
    PREFER_TV_SIZE_ACTION -> "TV_SIZE"
    else -> null
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionSheet(
    config: ActionSheetConfig,
    onDismiss: () -> Unit,
    onPlayNext: () -> Unit = {},
    onAddToQueue: () -> Unit = {},
    onReplaceQueue: () -> Unit = {},
    onPlayVideo: () -> Unit = {},
    onSaveToPlaylist: () -> Unit = {},
    onAddToLibrary: () -> Unit = {},
    onGoToArtist: () -> Unit = {},
    onGoToAnime: () -> Unit = {},
    onRelatedMusic: () -> Unit = {},
    onDownload: () -> Unit = {},
    onRemoveDownload: () -> Unit = {},
    onLike: () -> Unit = {},
    onDislike: () -> Unit = {},
    onRemoveDislike: () -> Unit = {},
    onUnskip: () -> Unit = {},
    onRemoveFromQueue: () -> Unit = {},
    onEditFilters: () -> Unit = {},
    onSettings: () -> Unit = {},
    onRefresh: () -> Unit = {},
    onDelete: () -> Unit = {},
    onCustomAction: (String) -> Unit = {}
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    fun dismissThen(action: () -> Unit) {
        onDismiss()
        action()
    }

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
                    val headerImageUrls = config.imageUrls.ifEmpty {
                        listOfNotNull(config.imageUrl?.takeIf { it.isNotBlank() })
                    }
                    if (headerImageUrls.isNotEmpty()) {
                        FallbackAsyncImage(
                            urls = headerImageUrls,
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
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = config.subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = Mist200,
                        maxLines = 2,
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
                        onClick = { dismissThen(onPlayNext) }
                    )
                }
            }
            if (config.showSaveToPlaylist) {
                topActions.add { mod ->
                    ActionButton(
                        icon = { Icon(Icons.AutoMirrored.Rounded.PlaylistAdd, contentDescription = null, tint = Mist100, modifier = Modifier.size(24.dp)) },
                        label = "Save to playlist",
                        modifier = mod,
                        onClick = { dismissThen(onSaveToPlaylist) }
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
            if (config.showLike) {
                OptionRow(
                    icon = { Icon(if (config.isLiked) Icons.Rounded.ThumbUp else Icons.Outlined.ThumbUp, contentDescription = null, tint = Mist100) },
                    label = if (config.isLiked) "Remove Like" else "Like",
                    onClick = { dismissThen(onLike) }
                )
            }
            if (config.showUnskip) {
                OptionRow(
                    icon = { Icon(Icons.AutoMirrored.Rounded.Undo, contentDescription = null, tint = Mist100) },
                    label = "Unskip",
                    onClick = { dismissThen(onUnskip) }
                )
            }
            if (config.showRemoveDislike) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.ThumbDown, contentDescription = null, tint = Mist100) },
                    label = if (config.isSkippedContext) "Remove Dislike" else "Remove Dislike",
                    onClick = { dismissThen(onRemoveDislike) }
                )
            }
            if (config.showAddToQueue) {
                OptionRow(
                    icon = { Icon(Icons.AutoMirrored.Rounded.QueueMusic, contentDescription = null, tint = Mist100) },
                    label = "Add to queue",
                    onClick = { dismissThen(onAddToQueue) }
                )
            }
            if (config.showReplaceQueue) {
                OptionRow(
                    icon = { Icon(Icons.AutoMirrored.Rounded.PlaylistPlay, contentDescription = null, tint = Mist100) },
                    label = "Replace queue",
                    onClick = { dismissThen(onReplaceQueue) }
                )
            }
            if (config.showDislike) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.ThumbDown, contentDescription = null, tint = Mist100) },
                    label = if (config.isDisliked) "Remove Dislike" else "Dislike",
                    onClick = { dismissThen(onDislike) }
                )
            }
            if (config.showPlayVideo) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.PlayArrow, contentDescription = null, tint = Mist100) },
                    label = "Play Video",
                    onClick = { dismissThen(onPlayVideo) }
                )
            }
            if (config.showRemoveFromQueue) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.Close, contentDescription = null, tint = Mist100) },
                    label = "Remove from queue",
                    onClick = { dismissThen(onRemoveFromQueue) }
                )
            }
            if (config.showAddToLibrary) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.LibraryAdd, contentDescription = null, tint = Mist100) },
                    label = "Add to library",
                    onClick = { dismissThen(onAddToLibrary) }
                )
            }
            if (config.showGoToArtist) {
                val label = config.artistName?.let { "Go to $it" } ?: "Go to artist"
                OptionRow(
                    icon = { Icon(Icons.Rounded.Person, contentDescription = null, tint = Mist100) },
                    label = label,
                    onClick = { dismissThen(onGoToArtist) }
                )
            }
            if (config.showGoToAnime) {
                val label = config.animeName?.let { "Go to $it" } ?: "Go to anime"
                OptionRow(
                    icon = { Icon(Icons.Rounded.Movie, contentDescription = null, tint = Mist100) },
                    label = label,
                    onClick = { dismissThen(onGoToAnime) }
                )
            }
            if (config.showRelatedMusic) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.Album, contentDescription = null, tint = Mist100) },
                    label = "Related Music",
                    onClick = { dismissThen(onRelatedMusic) }
                )
            }
            config.customActions.forEach { action ->
                OptionRow(
                    icon = { Icon(Icons.Rounded.Album, contentDescription = null, tint = Mist100) },
                    label = action.label,
                    supportingText = action.supportingText,
                    enabled = action.enabled,
                    onClick = { dismissThen { onCustomAction(action.key) } }
                )
            }
            if (config.showDownloading) {
                OptionRow(
                    icon = {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = Mist200,
                            strokeWidth = 2.dp
                        )
                    },
                    label = "Downloading…",
                    onClick = {}
                )
            } else if (config.showDownload) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.CloudDownload, contentDescription = null, tint = Mist100) },
                    label = "Download",
                    onClick = { dismissThen(onDownload) }
                )
            }
            if (config.showRemoveDownload) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.CloudDone, contentDescription = null, tint = Rose500) },
                    label = "Remove download",
                    onClick = { dismissThen(onRemoveDownload) }
                )
            }
            if (config.showEditFilters) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.FilterList, contentDescription = null, tint = Mist100) },
                    label = "Edit filters",
                    onClick = { dismissThen(onEditFilters) }
                )
            }
            if (config.showSettings) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.Settings, contentDescription = null, tint = Mist100) },
                    label = config.settingsLabel,
                    onClick = { dismissThen(onSettings) }
                )
            }
            if (config.showRefresh) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.Refresh, contentDescription = null, tint = Mist100) },
                    label = "Refresh now",
                    onClick = { dismissThen(onRefresh) }
                )
            }
            if (config.showDelete) {
                OptionRow(
                    icon = { Icon(Icons.Rounded.Delete, contentDescription = null, tint = Rose500) },
                    label = config.deleteLabel,
                    onClick = { dismissThen(onDelete) }
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
    supportingText: String? = null,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        icon()
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = if (enabled) Mist100 else Mist200
            )
            supportingText?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = Mist200
                )
            }
        }
    }
}
