package com.takeya.animeongaku.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.data.repository.RelatedRelease
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

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
    val animeArtworkUrls = remember(anime) { anime?.primaryArtworkUrls().orEmpty() }
    val selectedRelease = selected
    var sheetTrack by remember { mutableStateOf<RelatedTrack?>(null) }
    var pickerTrack by remember { mutableStateOf<RelatedTrack?>(null) }

    sheetTrack?.let { track ->
        val pref by viewModel.observePreference(track.song.id).collectAsStateWithLifecycle(initialValue = null)
        ActionSheet(
            config = ActionSheetConfig(
                title = track.song.title,
                subtitle = listOf(track.song.artistCredit, track.release.title).filter(String::isNotBlank).joinToString(" · "),
                imageUrl = relatedReleaseArtworkUrls(track.release.artworkUrl, track.owner.artworkUrl, animeArtworkUrls).firstOrNull(),
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

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Ink900, Ink800, Ink700)))
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            val hasContent = selectedRelease != null || releases.isNotEmpty()
            relatedMusicRefreshMessage(hasContent, error != null)?.let { message ->
                item { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) }
            }
            if (selectedRelease != null) {
                val releaseArtworkUrls = relatedReleaseArtworkUrls(
                    selectedRelease.release.artworkUrl,
                    selectedRelease.owner.artworkUrl,
                    animeArtworkUrls
                )
                item {
                    RelatedReleaseHero(
                        release = selectedRelease,
                        artworkUrls = releaseArtworkUrls,
                        onBack = onBack
                    )
                }
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Button(
                            onClick = { viewModel.playRelease(selectedRelease); onPlay() },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = Rose500),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Icon(Icons.Rounded.PlayArrow, null, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Play")
                        }
                        OutlinedButton(
                            onClick = { viewModel.downloadRelease(selectedRelease) },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp)
                        ) { Text("Download album") }
                    }
                }
                item {
                    Text(
                        "Tracks",
                        color = Mist100,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)
                    )
                }
                items(selectedRelease.tracks, key = { it.song.id }) { track ->
                    TrackRow(track, { viewModel.play(track); onPlay() }, { sheetTrack = track })
                }
                item { Spacer(Modifier.height(24.dp)) }
            } else {
                item { RelatedMusicListHeader(anime?.title, onBack) }
                if (releases.isEmpty()) {
                    item {
                        when (relatedMusicBodyState(isRefreshing, hasContent = false, hasError = error != null)) {
                            RelatedMusicBodyState.Loading -> CircularProgressIndicator(Modifier.padding(horizontal = 20.dp, vertical = 32.dp))
                            RelatedMusicBodyState.LoadFailed -> Text("Couldn’t load related music. Try again.", color = Mist100, modifier = Modifier.padding(horizontal = 20.dp, vertical = 32.dp))
                            RelatedMusicBodyState.Empty -> Text("No related music is available for this anime yet.", color = Mist100, modifier = Modifier.padding(horizontal = 20.dp, vertical = 32.dp))
                            RelatedMusicBodyState.Content -> Unit
                        }
                    }
                } else {
                    item {
                        Text(
                            "Albums and soundtracks",
                            color = Mist100,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp)
                        )
                    }
                    items(releases, key = { it.release.id }) { related ->
                        RelatedReleaseRow(
                            related = related,
                            artworkUrls = relatedReleaseArtworkUrls(
                                related.release.artworkUrl,
                                related.owner.artworkUrl,
                                animeArtworkUrls
                            ),
                            onOpen = { onOpenRelease(related.release.id) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RelatedReleaseHero(
    release: RelatedRelease,
    artworkUrls: List<String>,
    onBack: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.35f)
            .background(Ink800)
    ) {
        if (artworkUrls.isNotEmpty()) {
            FallbackAsyncImage(
                urls = artworkUrls,
                contentDescription = release.release.title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
        }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Color.Transparent, Ink900.copy(alpha = 0.28f), Ink900)
                    )
                )
        )
        IconButton(
            onClick = onBack,
            modifier = Modifier.align(Alignment.TopStart).padding(8.dp)
        ) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Mist100) }
        Column(
            modifier = Modifier.align(Alignment.BottomStart).padding(horizontal = 20.dp, vertical = 16.dp)
        ) {
            Text(
                release.release.title,
                color = Mist100,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                release.release.artistCredit,
                color = Mist200,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                "${release.relationshipType.displayRelationship()} · ${release.tracks.size} tracks",
                color = Mist200,
                style = MaterialTheme.typography.labelMedium
            )
        }
    }
}

@Composable
private fun RelatedMusicListHeader(animeTitle: String?, onBack: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Mist100) }
        Text(
            "Related Music",
            color = Mist100,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 8.dp)
        )
        animeTitle?.let {
            Text(it, color = Mist200, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 8.dp))
        }
    }
}

@Composable
private fun RelatedReleaseRow(related: RelatedRelease, artworkUrls: List<String>, onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onOpen)
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(68.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Ink700)
        ) {
            if (artworkUrls.isNotEmpty()) {
                FallbackAsyncImage(
                    urls = artworkUrls,
                    contentDescription = related.release.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(related.release.title, color = Mist100, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(related.release.artistCredit, color = Mist200, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(related.relationshipType.displayRelationship(), color = Mist200, style = MaterialTheme.typography.labelSmall)
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

internal fun relatedReleaseArtworkUrls(
    releaseArtworkUrl: String?,
    ownerArtworkUrl: String?,
    animeArtworkUrls: List<String>
): List<String> = buildList {
    addAll(listOfNotNull(releaseArtworkUrl, ownerArtworkUrl).filter(String::isNotBlank))
    addAll(animeArtworkUrls.filter(String::isNotBlank))
}.distinct()

private fun String.displayRelationship(): String =
    replace('_', ' ').lowercase().replaceFirstChar(Char::titlecase)

@Composable
private fun TrackRow(track: RelatedTrack, onPlay: () -> Unit, onMore: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onPlay).padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(track.trackNumber?.toString() ?: "•", modifier = Modifier.width(32.dp), color = Mist200, style = MaterialTheme.typography.bodySmall)
        Column(Modifier.weight(1f)) {
            Text(track.song.title, color = Mist100, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(track.song.artistCredit, color = Mist200, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onMore) { Icon(Icons.Rounded.MoreVert, "More actions", tint = Mist200) }
    }
}
