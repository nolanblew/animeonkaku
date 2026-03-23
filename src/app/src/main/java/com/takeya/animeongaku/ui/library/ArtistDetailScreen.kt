package com.takeya.animeongaku.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun ArtistDetailScreen(
    onBack: () -> Unit,
    onPlayTheme: () -> Unit,
    onOpenAnime: (String) -> Unit = {},
    viewModel: ArtistDetailViewModel = hiltViewModel()
) {
    val themes by viewModel.themes.collectAsStateWithLifecycle()
    val topSongs by viewModel.topSongs.collectAsStateWithLifecycle()
    val allSongsSorted by viewModel.allSongsSorted.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    val playlistCoverUrls by viewModel.playlistCoverUrls.collectAsStateWithLifecycle()
    val artistImageUrl by viewModel.artistImageUrl.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val fetchError by viewModel.fetchError.collectAsStateWithLifecycle()
    val isInLibrary by viewModel.isInLibrary.collectAsStateWithLifecycle()
    val libraryThemeIds by viewModel.libraryThemeIds.collectAsStateWithLifecycle()
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()
    val downloadingThemeIds by viewModel.downloadingThemeIds.collectAsStateWithLifecycle()
    val likedThemeIds by viewModel.likedThemeIds.collectAsStateWithLifecycle()
    val dislikedThemeIds by viewModel.dislikedThemeIds.collectAsStateWithLifecycle()
    val artistName = viewModel.artistName
    val background = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    val animeByThemesId = remember(anime) {
        anime.mapNotNull { entry -> entry.animeThemesId?.let { id -> id to entry } }.toMap()
    }

    var sheetTheme by remember { mutableStateOf<ThemeEntity?>(null) }
    var showArtistSheet by remember { mutableStateOf(false) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
    var showAllSongs by remember { mutableStateOf(false) }

    sheetTheme?.let { theme ->
        val sheetAnime = theme.animeId?.let { animeByThemesId[it] }
        val info = theme.displayInfo(sheetAnime)
        val songInLibrary = theme.id in libraryThemeIds
        val isDownloaded = theme.id in downloadedThemeIds
        val isDownloading = theme.id in downloadingThemeIds
        ActionSheet(
            config = ActionSheetConfig(
                title = info.primaryText,
                subtitle = info.secondaryText,
                imageUrl = sheetAnime?.primaryArtworkUrl(),
                showGoToAnime = sheetAnime?.kitsuId != null,
                animeName = sheetAnime?.title,
                showAddToLibrary = !songInLibrary,
                showDownload = !isDownloaded && !isDownloading,
                showDownloading = isDownloading,
                showRemoveDownload = isDownloaded,
                showLike = true,
                isLiked = theme.id in likedThemeIds,
                showRemoveDislike = theme.id in dislikedThemeIds
            ),
            onDismiss = { sheetTheme = null },
            onPlayNext = { viewModel.nowPlayingManager.playNext(theme, sheetAnime) },
            onAddToQueue = { viewModel.nowPlayingManager.addToQueue(theme, sheetAnime) },
            onReplaceQueue = { viewModel.nowPlayingManager.play("Now Playing", listOf(theme), 0, animeMap = sheetAnime?.let { a -> theme.animeId?.let { mapOf(it to a) } } ?: emptyMap()) },
            onSaveToPlaylist = { pickerThemeIds = listOf(theme.id) },
            onGoToAnime = { sheetAnime?.kitsuId?.let { onOpenAnime(it) } },
            onAddToLibrary = { viewModel.saveSongToLibrary(theme.id) },
            onDownload = { viewModel.downloadSong(theme) },
            onRemoveDownload = { viewModel.removeDownload(theme.id) },
            onLike = { viewModel.toggleLike(theme.id) },
            onRemoveDislike = { viewModel.toggleDislike(theme.id) }
        )
    }

    if (showArtistSheet) {
        ActionSheet(
            config = ActionSheetConfig(
                title = artistName,
                subtitle = "${themes.size} songs",
                showAddToLibrary = false
            ),
            onDismiss = { showArtistSheet = false },
            onPlayNext = { viewModel.nowPlayingManager.playNext(themes, animeByThemesId) },
            onAddToQueue = { viewModel.nowPlayingManager.addToQueue(themes, animeByThemesId) },
            onReplaceQueue = { viewModel.playAll(); onPlayTheme() },
            onSaveToPlaylist = { pickerThemeIds = themes.map { it.id } }
        )
    }

    pickerThemeIds?.let { ids ->
        PlaylistPickerSheet(
            playlists = playlists,
            coverUrls = playlistCoverUrls,
            onDismiss = { pickerThemeIds = null },
            onSelectPlaylist = { playlistId ->
                viewModel.addToPlaylist(playlistId, ids)
                pickerThemeIds = null
            },
            onCreatePlaylist = { name ->
                viewModel.createAndAddToPlaylist(name, ids)
                pickerThemeIds = null
            }
        )
    }

    val artistAnime = remember(themes, animeByThemesId) {
        themes.mapNotNull { it.animeId?.let { id -> animeByThemesId[id] } }.distinctBy { it.kitsuId }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            // Hero header
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(260.dp)
                        .background(
                            Brush.verticalGradient(
                                listOf(Rose500.copy(alpha = 0.25f), Ink900)
                            )
                        )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp)
                            .align(Alignment.TopStart),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                                contentDescription = "Back",
                                tint = Mist100
                            )
                        }
                        IconButton(onClick = { showArtistSheet = true }) {
                            Icon(
                                Icons.Rounded.MoreVert,
                                contentDescription = "More options",
                                tint = Mist100
                            )
                        }
                    }
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(top = 32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(
                            modifier = Modifier
                                .size(100.dp)
                                .clip(CircleShape)
                                .background(
                                    Brush.linearGradient(listOf(Rose500.copy(alpha = 0.4f), Ink800)),
                                    CircleShape
                                )
                                .border(2.dp, Mist200.copy(alpha = 0.2f), CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            if (!artistImageUrl.isNullOrBlank()) {
                                AsyncImage(
                                    model = artistImageUrl,
                                    contentDescription = artistName,
                                    modifier = Modifier.matchParentSize().clip(CircleShape),
                                    contentScale = ContentScale.Crop
                                )
                            } else {
                                Text(
                                    text = artistName.take(2).uppercase(),
                                    style = MaterialTheme.typography.headlineMedium,
                                    color = Mist100.copy(alpha = 0.6f)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = artistName,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            color = Mist100,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 32.dp)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${themes.size} songs · ${artistAnime.size} anime",
                            style = MaterialTheme.typography.labelMedium,
                            color = Mist200
                        )
                    }
                }
            }

            // Play / Shuffle
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = { viewModel.playAll(); onPlayTheme() },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Rose500),
                        shape = RoundedCornerShape(12.dp),
                        enabled = themes.isNotEmpty()
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Play")
                    }
                    Button(
                        onClick = { viewModel.shuffleAll(); onPlayTheme() },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Ink800),
                        shape = RoundedCornerShape(12.dp),
                        enabled = themes.isNotEmpty()
                    ) {
                        Icon(Icons.Rounded.Shuffle, contentDescription = null, modifier = Modifier.size(20.dp), tint = Mist100)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Shuffle", color = Mist100)
                    }
                }
            }

            // Songs section
            item {
                val hasTopSongs = topSongs.isNotEmpty()
                Text(
                    text = if (hasTopSongs) "Top Songs" else "Songs",
                    style = MaterialTheme.typography.titleMedium,
                    color = Mist100,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                )
            }

            if (isLoading) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 32.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(color = Rose500, modifier = Modifier.size(32.dp))
                    }
                }
            } else if (themes.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                            .background(Ink800.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
                            .padding(20.dp)
                    ) {
                        Text(
                            text = fetchError ?: "No songs found for this artist.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Mist200
                        )
                    }
                }
            } else {
                val displaySongs = if (topSongs.isNotEmpty() && !showAllSongs) {
                    topSongs
                } else {
                    allSongsSorted.ifEmpty { themes }
                }
                itemsIndexed(displaySongs) { index, theme ->
                    val animeEntry = theme.animeId?.let { animeByThemesId[it] }
                    val imageUrls = animeEntry?.primaryArtworkUrls() ?: emptyList()
                    ArtistSongRow(
                        index = index + 1,
                        theme = theme,
                        anime = animeEntry,
                        imageUrls = imageUrls,
                        inLibrary = theme.id in libraryThemeIds,
                        isDownloaded = theme.id in downloadedThemeIds,
                        isDownloading = theme.id in downloadingThemeIds,
                        onPlay = {
                            viewModel.playTheme(theme.id)
                            onPlayTheme()
                        },
                        onMoreOptions = { sheetTheme = theme }
                    )
                }

                // See more / See less toggle
                if (topSongs.isNotEmpty() && themes.size > topSongs.size) {
                    item {
                        Text(
                            text = if (showAllSongs) "See less" else "See more",
                            style = MaterialTheme.typography.labelLarge,
                            color = Rose500,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .padding(horizontal = 20.dp, vertical = 8.dp)
                                .clickable { showAllSongs = !showAllSongs }
                        )
                    }
                }
            }

            // Anime section
            if (artistAnime.isNotEmpty()) {
                item {
                    Text(
                        text = "Appears In",
                        style = MaterialTheme.typography.titleMedium,
                        color = Mist100,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)
                    )
                }
                items(artistAnime) { animeEntity ->
                    AnimeRow(
                        anime = animeEntity,
                        songCount = themes.count { it.animeId == animeEntity.animeThemesId },
                        onClick = { animeEntity.kitsuId?.let { onOpenAnime(it) } }
                    )
                }
            }

            item {
                Spacer(modifier = Modifier.height(90.dp))
            }
        }
    }
}

@Composable
private fun ArtistSongRow(
    index: Int,
    theme: ThemeEntity,
    anime: AnimeEntity?,
    imageUrls: List<String> = emptyList(),
    inLibrary: Boolean = true,
    isDownloaded: Boolean = false,
    isDownloading: Boolean = false,
    onPlay: () -> Unit,
    onMoreOptions: () -> Unit = {}
) {
    val info = theme.displayInfo(anime)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onPlay() }
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "$index",
            style = MaterialTheme.typography.labelMedium,
            color = Mist200,
            modifier = Modifier.width(24.dp)
        )
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Rose500.copy(alpha = 0.15f))
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = info.primaryText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Mist100,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                if (isDownloading) {
                    Spacer(modifier = Modifier.width(4.dp))
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        color = Rose500.copy(alpha = 0.7f),
                        strokeWidth = 1.5.dp
                    )
                } else if (isDownloaded) {
                    Spacer(modifier = Modifier.width(4.dp))
                    Icon(
                        Icons.Rounded.DownloadDone,
                        contentDescription = "Downloaded",
                        tint = Rose500.copy(alpha = 0.7f),
                        modifier = Modifier.size(14.dp)
                    )
                } else if (inLibrary) {
                    Spacer(modifier = Modifier.width(4.dp))
                    Icon(
                        Icons.Rounded.CheckCircle,
                        contentDescription = "In library",
                        tint = Mist200.copy(alpha = 0.5f),
                        modifier = Modifier.size(14.dp)
                    )
                }
            }
            Text(
                text = info.secondaryText,
                style = MaterialTheme.typography.labelSmall,
                color = Mist200
            )
        }
        IconButton(onClick = onMoreOptions, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Rounded.MoreVert, contentDescription = "More options", tint = Mist200, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun AnimeRow(anime: AnimeEntity, songCount: Int, onClick: () -> Unit = {}) {
    val coverUrls = anime.primaryArtworkUrls()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 20.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(50.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Ember400.copy(alpha = 0.15f))
        ) {
            if (coverUrls.isNotEmpty()) {
                FallbackAsyncImage(
                    urls = coverUrls,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize()
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = anime.title ?: "Unknown",
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = if (songCount == 1) "1 song" else "$songCount songs",
                style = MaterialTheme.typography.labelSmall,
                color = Mist200
            )
        }
    }
}
