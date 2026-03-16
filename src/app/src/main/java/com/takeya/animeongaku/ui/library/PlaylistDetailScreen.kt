package com.takeya.animeongaku.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.PlaylistCoverArt
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun PlaylistDetailScreen(
    onBack: () -> Unit,
    onPlayTheme: () -> Unit,
    onOpenAnime: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
    viewModel: PlaylistDetailViewModel = hiltViewModel()
) {
    val playlist by viewModel.playlist.collectAsStateWithLifecycle()
    val tracks by viewModel.tracks.collectAsStateWithLifecycle()
    val coverUrls by viewModel.coverUrls.collectAsStateWithLifecycle()
    val allThemes by viewModel.allThemes.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val searchQuery by viewModel.searchQuery.collectAsStateWithLifecycle()
    var showAddDialog by remember { mutableStateOf(false) }
    var sheetTheme by remember { mutableStateOf<ThemeEntity?>(null) }
    var showPlaylistSheet by remember { mutableStateOf(false) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
    val allPlaylists by viewModel.playlists.collectAsStateWithLifecycle()
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()
    val downloadingThemeIds by viewModel.downloadingThemeIds.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    val animeByThemesId = remember(anime) {
        anime.mapNotNull { entry -> entry.animeThemesId?.let { id -> id to entry } }.toMap()
    }

    if (showPlaylistSheet) {
        val allDownloaded = tracks.isNotEmpty() && tracks.all { it.theme.id in downloadedThemeIds }
        val anyDownloading = tracks.any { it.theme.id in downloadingThemeIds }
        ActionSheet(
            config = ActionSheetConfig(
                title = playlist?.name ?: "Playlist",
                subtitle = "${tracks.size} tracks",
                showDownload = !allDownloaded && !anyDownloading && tracks.isNotEmpty(),
                showDownloading = anyDownloading && !allDownloaded,
                showRemoveDownload = allDownloaded
            ),
            onDismiss = { showPlaylistSheet = false },
            onPlayNext = {
                val themes = tracks.map { it.theme }
                viewModel.nowPlayingManager.playNext(themes, animeByThemesId)
            },
            onAddToQueue = {
                val themes = tracks.map { it.theme }
                viewModel.nowPlayingManager.addToQueue(themes, animeByThemesId)
            },
            onReplaceQueue = { viewModel.playAll(); onPlayTheme() },
            onDownload = { viewModel.downloadPlaylist() },
            onRemoveDownload = { viewModel.removePlaylistDownload() }
        )
    }

    sheetTheme?.let { theme ->
        val sheetAnime = theme.animeId?.let { animeByThemesId[it] }
        val info = theme.displayInfo(sheetAnime)
        val isDownloaded = theme.id in downloadedThemeIds
        val isDownloading = theme.id in downloadingThemeIds
        ActionSheet(
            config = ActionSheetConfig(
                title = info.primaryText,
                subtitle = info.secondaryText,
                imageUrl = sheetAnime?.coverUrl ?: sheetAnime?.thumbnailUrl,
                showGoToArtist = !theme.artistName.isNullOrBlank(),
                showGoToAnime = sheetAnime?.kitsuId != null,
                showDownload = !isDownloaded && !isDownloading,
                showDownloading = isDownloading,
                showRemoveDownload = isDownloaded,
                artistName = theme.artistName?.split(",")?.firstOrNull()?.trim(),
                animeName = sheetAnime?.title
            ),
            onDismiss = { sheetTheme = null },
            onPlayNext = { viewModel.nowPlayingManager.playNext(theme, sheetAnime) },
            onAddToQueue = { viewModel.nowPlayingManager.addToQueue(theme, sheetAnime) },
            onReplaceQueue = { viewModel.nowPlayingManager.play("Now Playing", listOf(theme), 0, animeMap = sheetAnime?.let { a -> theme.animeId?.let { mapOf(it to a) } } ?: emptyMap()) },
            onSaveToPlaylist = { pickerThemeIds = listOf(theme.id) },
            onGoToArtist = { theme.artistName?.split(",")?.firstOrNull()?.trim()?.let { onOpenArtist(it) } },
            onGoToAnime = { sheetAnime?.kitsuId?.let { onOpenAnime(it) } },
            onDownload = { viewModel.downloadSong(theme) },
            onRemoveDownload = { viewModel.removeDownload(theme.id) }
        )
    }

    pickerThemeIds?.let { ids ->
        PlaylistPickerSheet(
            playlists = allPlaylists,
            onDismiss = { pickerThemeIds = null },
            onSelectPlaylist = { playlistId ->
                viewModel.addToOtherPlaylist(playlistId, ids)
                pickerThemeIds = null
            },
            onCreatePlaylist = { name ->
                viewModel.createAndAddToPlaylist(name, ids)
                pickerThemeIds = null
            }
        )
    }

    val background = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    val filteredThemes = allThemes.filter {
        it.title.contains(searchQuery, ignoreCase = true) ||
            (it.artistName?.contains(searchQuery, ignoreCase = true) == true)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 90.dp)
        ) {
            // Top bar
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 4.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                            contentDescription = "Back",
                            tint = Mist100
                        )
                    }
                    Row(
                        modifier = Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (playlist?.isAuto == true) {
                            Icon(
                                imageVector = Icons.Rounded.AutoAwesome,
                                contentDescription = "Auto Playlist",
                                tint = Mist200,
                                modifier = Modifier
                                    .size(18.dp)
                                    .padding(end = 6.dp)
                            )
                        }
                        Text(
                            text = playlist?.name ?: "Playlist",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = Mist100,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    if (playlist?.isAuto != true) {
                        IconButton(onClick = { showAddDialog = true }) {
                            Icon(Icons.Rounded.Add, contentDescription = "Add tracks", tint = Mist100)
                        }
                    }
                    IconButton(onClick = { showPlaylistSheet = true }) {
                        Icon(Icons.Rounded.MoreVert, contentDescription = "More options", tint = Mist100)
                    }
                }
            }

            // Cover art + track count + play/shuffle
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    PlaylistCoverArt(
                        coverUrls = coverUrls,
                        gradientSeed = playlist?.gradientSeed ?: 0,
                        size = 160.dp,
                        cornerRadius = 16.dp,
                        modifier = Modifier.padding(bottom = 16.dp)
                    )
                    Text(
                        text = "${tracks.size} tracks",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = { viewModel.playAll(); onPlayTheme() },
                            colors = ButtonDefaults.buttonColors(containerColor = Rose500),
                            shape = RoundedCornerShape(24.dp),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Play", fontWeight = FontWeight.SemiBold)
                        }
                        Button(
                            onClick = {
                                viewModel.shuffleAll(); onPlayTheme()
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Mist200.copy(alpha = 0.12f)
                            ),
                            shape = RoundedCornerShape(24.dp),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Rounded.Shuffle, contentDescription = null, tint = Mist100, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Shuffle", color = Mist100, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                }
            }

            if (tracks.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                            .background(Ink800.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
                            .border(1.dp, Mist200.copy(alpha = 0.1f), RoundedCornerShape(14.dp))
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text("No tracks yet", style = MaterialTheme.typography.bodyMedium, color = Mist100)
                        Text("Tap + to add themes from your library.", style = MaterialTheme.typography.labelSmall, color = Mist200)
                    }
                }
            } else {
                itemsIndexed(tracks) { _, track ->
                    val animeEntry = track.theme.animeId?.let { animeByThemesId[it] }
                    val imageUrl = animeEntry?.coverUrl ?: animeEntry?.thumbnailUrl
                    val info = track.theme.displayInfo(animeEntry)
                    val tdl = track.theme.id in downloadedThemeIds
                    val tding = track.theme.id in downloadingThemeIds
                    CompactTrackRow(
                        title = info.primaryText,
                        artist = info.secondaryText,
                        imageUrl = imageUrl,
                        isDownloaded = tdl,
                        isDownloading = tding,
                        isUnavailableOffline = !isOnline && !tdl,
                        onPlay = { viewModel.playTheme(track.theme.id); onPlayTheme() },
                        onRemove = if (playlist?.isAuto == true) null else {{ viewModel.removeTheme(track.theme.id) }},
                        onMoreOptions = { sheetTheme = track.theme }
                    )
                }
            }
        }

        if (showAddDialog) {
            AddTrackDialog(
                searchQuery = searchQuery,
                onSearchChange = viewModel::onSearchChange,
                themes = filteredThemes,
                animeByThemesId = animeByThemesId,
                onAdd = viewModel::addTheme,
                onDismiss = { showAddDialog = false }
            )
        }
    }
}

@Composable
private fun CompactTrackRow(
    title: String,
    artist: String,
    imageUrl: String?,
    isDownloaded: Boolean = false,
    isDownloading: Boolean = false,
    isUnavailableOffline: Boolean = false,
    onPlay: () -> Unit,
    onRemove: (() -> Unit)? = null,
    onMoreOptions: (() -> Unit)? = null
) {
    var showMenu by remember { mutableStateOf(false) }
    val rowAlpha = if (isUnavailableOffline) 0.4f else 1f

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(rowAlpha)
            .clickable { onPlay() }
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
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
                }
            }
            Text(
                text = artist,
                style = MaterialTheme.typography.bodySmall,
                color = Mist200,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Box {
            IconButton(
                onClick = { if (onMoreOptions != null) onMoreOptions() else showMenu = true },
                modifier = Modifier.size(36.dp)
            ) {
                Icon(Icons.Rounded.MoreVert, contentDescription = "More", tint = Mist200, modifier = Modifier.size(20.dp))
            }
            DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                DropdownMenuItem(
                    text = { Text("Play") },
                    onClick = { showMenu = false; onPlay() }
                )
                if (onRemove != null) {
                    DropdownMenuItem(
                        text = { Text("Remove from playlist", color = Rose500) },
                        onClick = { showMenu = false; onRemove() }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddTrackDialog(
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    themes: List<ThemeEntity>,
    animeByThemesId: Map<Long, com.takeya.animeongaku.data.local.AnimeEntity>,
    onAdd: (ThemeEntity) -> Unit,
    onDismiss: () -> Unit
) {
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val textFieldColors = TextFieldDefaults.colors(
        focusedTextColor = Mist100,
        unfocusedTextColor = Mist100,
        disabledTextColor = Mist200,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        disabledContainerColor = Color.Transparent,
        focusedIndicatorColor = Rose500,
        unfocusedIndicatorColor = Mist200.copy(alpha = 0.5f),
        disabledIndicatorColor = Mist200.copy(alpha = 0.3f),
        focusedLabelColor = Mist200,
        unfocusedLabelColor = Mist200,
        disabledLabelColor = Mist200.copy(alpha = 0.5f),
        cursorColor = Rose500
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.buttonColors(containerColor = Ink700)
            ) {
                Text("Done")
            }
        },
        title = { Text("Add tracks") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = onSearchChange,
                    label = { Text("Search themes") },
                    singleLine = true,
                    maxLines = 1,
                    textStyle = LocalTextStyle.current.copy(color = Mist100),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Text,
                        imeAction = ImeAction.Search
                    ),
                    keyboardActions = KeyboardActions(
                        onSearch = {
                            focusManager.clearFocus(force = true)
                            keyboardController?.hide()
                        }
                    ),
                    colors = textFieldColors
                )
                if (themes.isEmpty()) {
                    Text(
                        text = "No themes available yet. Sync your library first.",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200
                    )
                } else {
                    Text(
                        text = "${themes.size} results",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200
                    )
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(360.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(themes) { theme ->
                            val animeEntry = theme.animeId?.let { animeByThemesId[it] }
                            val imgUrl = animeEntry?.coverUrl ?: animeEntry?.thumbnailUrl
                            val info = theme.displayInfo(animeEntry)
                            AddThemeRow(info = info, imageUrl = imgUrl, onAdd = { onAdd(theme) })
                        }
                    }
                }
            }
        },
        dismissButton = {
            IconButton(onClick = onDismiss) {
                Icon(Icons.Rounded.Close, contentDescription = "Close", tint = Mist100)
            }
        }
    )
}

@Composable
private fun AddThemeRow(info: com.takeya.animeongaku.ui.common.ThemeDisplayInfo, imageUrl: String?, onAdd: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Ink800.copy(alpha = 0.5f))
            .clickable { onAdd() }
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Ink700)
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
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = info.primaryText,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = info.secondaryText,
                style = MaterialTheme.typography.labelSmall,
                color = Mist200,
                maxLines = 1
            )
        }
        Box(
            modifier = Modifier
                .size(28.dp)
                .background(Rose500, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Rounded.Add, contentDescription = "Add", tint = Color.White, modifier = Modifier.size(16.dp))
        }
    }
}
