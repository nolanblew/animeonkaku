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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudDownload
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.LibraryAdd
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.takeya.animeongaku.data.local.ThemeEntity
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
fun AnimeDetailScreen(
    onBack: () -> Unit,
    onPlayTheme: () -> Unit,
    onOpenArtist: (String) -> Unit = {},
    viewModel: AnimeDetailViewModel = hiltViewModel()
) {
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val themes by viewModel.themes.collectAsStateWithLifecycle()
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val fetchError by viewModel.fetchError.collectAsStateWithLifecycle()
    val isInLibrary by viewModel.isInLibrary.collectAsStateWithLifecycle()
    val libraryThemeIds by viewModel.libraryThemeIds.collectAsStateWithLifecycle()
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()
    val downloadingThemeIds by viewModel.downloadingThemeIds.collectAsStateWithLifecycle()
    val likedThemeIds by viewModel.likedThemeIds.collectAsStateWithLifecycle()
    val dislikedThemeIds by viewModel.dislikedThemeIds.collectAsStateWithLifecycle()
    val background = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    val coverUrl = anime?.coverUrl ?: anime?.thumbnailUrl
    val posterUrl = anime?.thumbnailUrl ?: anime?.coverUrl

    var sheetTheme by remember { mutableStateOf<ThemeEntity?>(null) }
    var showAnimeSheet by remember { mutableStateOf(false) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }

    sheetTheme?.let { theme ->
        val info = theme.displayInfo(anime)
        val songInLibrary = theme.id in libraryThemeIds
        val isDownloaded = theme.id in downloadedThemeIds
        val isDownloading = theme.id in downloadingThemeIds
        ActionSheet(
            config = ActionSheetConfig(
                title = info.primaryText,
                subtitle = info.secondaryText,
                imageUrl = posterUrl,
                showGoToArtist = !theme.artistName.isNullOrBlank(),
                artistName = theme.artistName?.split(",")?.firstOrNull()?.trim(),
                showAddToLibrary = !songInLibrary,
                showDownload = !isDownloaded && !isDownloading,
                showDownloading = isDownloading,
                showRemoveDownload = isDownloaded,
                showLike = true,
                isLiked = theme.id in likedThemeIds,
                showRemoveDislike = theme.id in dislikedThemeIds
            ),
            onDismiss = { sheetTheme = null },
            onPlayNext = { viewModel.nowPlayingManager.playNext(theme, anime) },
            onAddToQueue = { viewModel.nowPlayingManager.addToQueue(theme, anime) },
            onReplaceQueue = {
                val a = anime
                viewModel.nowPlayingManager.play("Now Playing", listOf(theme), 0, animeMap = a?.let { e -> theme.animeId?.let { mapOf(it to e) } } ?: emptyMap())
            },
            onSaveToPlaylist = { pickerThemeIds = listOf(theme.id) },
            onGoToArtist = { theme.artistName?.split(",")?.firstOrNull()?.trim()?.let { onOpenArtist(it) } },
            onAddToLibrary = { viewModel.saveSongToLibrary(theme.id) },
            onDownload = { viewModel.downloadSong(theme) },
            onRemoveDownload = { viewModel.removeDownload(theme.id) },
            onLike = { viewModel.toggleLike(theme.id) },
            onRemoveDislike = { viewModel.toggleDislike(theme.id) }
        )
    }

    if (showAnimeSheet) {
        val allDownloaded = themes.isNotEmpty() && themes.all { it.id in downloadedThemeIds }
        val anyDownloading = themes.any { it.id in downloadingThemeIds }
        ActionSheet(
            config = ActionSheetConfig(
                title = anime?.title ?: "Anime",
                subtitle = "${themes.size} themes",
                imageUrl = coverUrl,
                showAddToLibrary = !isInLibrary,
                showDownload = !allDownloaded && !anyDownloading && themes.isNotEmpty(),
                showDownloading = anyDownloading && !allDownloaded,
                showRemoveDownload = allDownloaded
            ),
            onDismiss = { showAnimeSheet = false },
            onPlayNext = { viewModel.nowPlayingManager.playNext(themes, anime?.let { a -> a.animeThemesId?.let { mapOf(it to a) } } ?: emptyMap()) },
            onAddToQueue = { viewModel.nowPlayingManager.addToQueue(themes, anime?.let { a -> a.animeThemesId?.let { mapOf(it to a) } } ?: emptyMap()) },
            onReplaceQueue = { viewModel.playAll(); onPlayTheme() },
            onSaveToPlaylist = { pickerThemeIds = themes.map { it.id } },
            onAddToLibrary = { viewModel.saveAllToLibrary() },
            onDownload = { viewModel.downloadAnime() },
            onRemoveDownload = { viewModel.removeAnimeDownload() }
        )
    }

    pickerThemeIds?.let { ids ->
        PlaylistPickerSheet(
            playlists = playlists,
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

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            // Hero image
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(1.4f)
                ) {
                    if (!coverUrl.isNullOrBlank()) {
                        AsyncImage(
                            model = coverUrl,
                            contentDescription = null,
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Crop
                        )
                    }
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(
                                Brush.verticalGradient(
                                    colors = listOf(
                                        Color.Transparent,
                                        Ink900.copy(alpha = 0.3f),
                                        Ink900
                                    ),
                                    startY = 0f,
                                    endY = Float.POSITIVE_INFINITY
                                )
                            )
                    )
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
                        IconButton(onClick = { showAnimeSheet = true }) {
                            Icon(
                                Icons.Rounded.MoreVert,
                                contentDescription = "More options",
                                tint = Mist100
                            )
                        }
                    }
                    Column(
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(horizontal = 20.dp, vertical = 16.dp)
                    ) {
                        Text(
                            text = anime?.title ?: "Anime",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            color = Mist100,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "${themes.size} themes",
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

            // Add to Library button (when not in library)
            if (!isInLibrary && themes.isNotEmpty()) {
                item {
                    Button(
                        onClick = { viewModel.saveAllToLibrary() },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Ink800,
                            contentColor = Mist100
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Rounded.LibraryAdd, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Add All to Library")
                    }
                }
            }

            // Section header
            item {
                Text(
                    text = "Themes",
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
                            .border(1.dp, Mist200.copy(alpha = 0.12f), RoundedCornerShape(14.dp))
                            .padding(20.dp)
                    ) {
                        Text(
                            text = fetchError ?: "No themes found for this anime.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Mist200
                        )
                    }
                }
            } else {
                itemsIndexed(themes) { index, theme ->
                    ThemeRow(
                        theme = theme,
                        coverUrl = posterUrl,
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
            }

            item {
                Spacer(modifier = Modifier.height(90.dp))
            }
        }
    }
}

@Composable
private fun ThemeRow(
    theme: ThemeEntity,
    coverUrl: String?,
    inLibrary: Boolean = true,
    isDownloaded: Boolean = false,
    isDownloading: Boolean = false,
    onPlay: () -> Unit,
    onMoreOptions: () -> Unit = {}
) {
    val typeLabel = theme.themeType ?: ""
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onPlay() }
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = typeLabel,
            style = MaterialTheme.typography.labelMedium,
            color = Mist200,
            modifier = Modifier.width(36.dp)
        )
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Ember400.copy(alpha = 0.2f))
        ) {
            if (!coverUrl.isNullOrBlank()) {
                AsyncImage(
                    model = coverUrl,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = theme.title,
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
                text = theme.artistName ?: "Unknown artist",
                style = MaterialTheme.typography.labelSmall,
                color = Mist200,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        IconButton(onClick = onMoreOptions, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Rounded.MoreVert, contentDescription = "More options", tint = Mist200, modifier = Modifier.size(20.dp))
        }
    }
}
