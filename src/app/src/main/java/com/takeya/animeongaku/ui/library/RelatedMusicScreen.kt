package com.takeya.animeongaku.ui.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RelatedMusicScreen(
    onBack: () -> Unit,
    onOpenRelease: (Long) -> Unit,
    onPlay: () -> Unit,
    viewModel: RelatedMusicViewModel = hiltViewModel()
) {
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val releases by viewModel.releases.collectAsStateWithLifecycle()
    val selected by viewModel.selectedRelease.collectAsStateWithLifecycle()
    val error by viewModel.refreshError.collectAsStateWithLifecycle()
    val isRefreshing by viewModel.isRefreshing.collectAsStateWithLifecycle()
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    var sheetTrack by remember { mutableStateOf<RelatedTrack?>(null) }
    var pickerTrack by remember { mutableStateOf<RelatedTrack?>(null) }
    val title = selected?.release?.title ?: "Related Music"

    sheetTrack?.let { track ->
        val pref by viewModel.observePreference(track.song.id).collectAsStateWithLifecycle(initialValue = null)
        ActionSheet(
            config = ActionSheetConfig(
                title = track.song.title,
                subtitle = listOf(track.song.artistCredit, track.release.title).filter(String::isNotBlank).joinToString(" · "),
                imageUrl = track.release.artworkUrl ?: track.owner.artworkUrl,
                showLike = true,
                isLiked = pref?.isLiked == true,
                showDislike = true,
                isDisliked = pref?.isDisliked == true,
                showDownload = true
            ),
            onDismiss = { sheetTrack = null },
            onPlayNext = { viewModel.playNext(track) },
            onAddToQueue = { viewModel.addToQueue(track) },
            onReplaceQueue = { viewModel.play(track); onPlay() },
            onSaveToPlaylist = { pickerTrack = track },
            onLike = { viewModel.toggleLike(track.song.id) },
            onDislike = { viewModel.toggleDislike(track.song.id) },
            onDownload = { viewModel.download(track) }
        )
    }
    pickerTrack?.let { track ->
        PlaylistPickerSheet(
            playlists = playlists,
            coverUrls = emptyMap(),
            onDismiss = { pickerTrack = null },
            onSelectPlaylist = { id -> viewModel.addToPlaylist(id, track.song.id); pickerTrack = null },
            onCreatePlaylist = { name -> viewModel.createPlaylist(name, track.song.id); pickerTrack = null }
        )
    }

    Scaffold(topBar = {
        TopAppBar(title = { Column { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(anime?.title ?: selected?.owner?.title ?: releases.firstOrNull()?.owner?.title.orEmpty(), style = MaterialTheme.typography.labelSmall) } },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, null) } })
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val hasContent = selected != null || releases.isNotEmpty()
            relatedMusicRefreshMessage(hasContent, error != null)?.let { message ->
                item { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
            if (selected != null) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { viewModel.playRelease(selected!!); onPlay() }) { Icon(Icons.Rounded.PlayArrow, null); Text("Play") }
                        Button(onClick = { viewModel.downloadRelease(selected!!) }) { Text("Download Album") }
                    }
                }
                items(selected!!.tracks, key = { it.song.id }) { track -> TrackRow(track, { viewModel.play(track); onPlay() }, { sheetTrack = track }) }
            } else if (releases.isEmpty()) {
                item {
                    when (relatedMusicBodyState(isRefreshing, hasContent = false, hasError = error != null)) {
                        RelatedMusicBodyState.Loading -> CircularProgressIndicator(Modifier.padding(vertical = 32.dp))
                        RelatedMusicBodyState.LoadFailed -> Text("Couldn’t load related music. Try again.", modifier = Modifier.padding(vertical = 32.dp))
                        RelatedMusicBodyState.Empty -> Text("No related music is available for this anime yet.", modifier = Modifier.padding(vertical = 32.dp))
                        RelatedMusicBodyState.Content -> Unit
                    }
                }
            } else {
                items(releases, key = { it.release.id }) { related ->
                    Row(Modifier.fillMaxWidth().clickable { onOpenRelease(related.release.id) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        FallbackAsyncImage(listOfNotNull(related.release.artworkUrl, related.owner.artworkUrl), related.release.title, Modifier.size(64.dp))
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(related.release.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(related.release.artistCredit, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(related.relationshipType.replace('_', ' '), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}

internal enum class RelatedMusicBodyState { Loading, LoadFailed, Empty, Content }

internal fun relatedMusicBodyState(isRefreshing: Boolean, hasContent: Boolean, hasError: Boolean): RelatedMusicBodyState = when {
    hasContent -> RelatedMusicBodyState.Content
    isRefreshing -> RelatedMusicBodyState.Loading
    hasError -> RelatedMusicBodyState.LoadFailed
    else -> RelatedMusicBodyState.Empty
}

internal fun relatedMusicRefreshMessage(hasContent: Boolean, hasError: Boolean): String? =
    "Couldn’t refresh. Showing saved music.".takeIf { hasContent && hasError }

@Composable
private fun TrackRow(track: RelatedTrack, onPlay: () -> Unit, onMore: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onPlay).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(track.trackNumber?.toString() ?: "•", modifier = Modifier.size(32.dp), style = MaterialTheme.typography.bodySmall)
        Column(Modifier.weight(1f)) {
            Text(track.song.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(track.song.artistCredit, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onMore) { Icon(Icons.Rounded.MoreVert, "More actions") }
    }
}
