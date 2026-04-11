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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
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
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.FeaturedPlaylistCard
import com.takeya.animeongaku.ui.common.PlaylistCoverArt
import com.takeya.animeongaku.ui.player.MiniPlayerHeight
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import com.takeya.animeongaku.ui.theme.Sky500

private enum class LibraryTab(val label: String) {
    Playlists("Playlists"),
    Songs("Songs"),
    Albums("Animes"),
    Artists("Artists")
}

@Composable
fun LibraryScreen(
    onOpenSettings: () -> Unit = {},
    hasSettingsUpdateDot: Boolean = false,
    onOpenPlaylist: (Long) -> Unit,
    onPlayTheme: () -> Unit,
    onOpenAnime: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
    initialTab: String? = null,
    viewModel: LibraryViewModel = hiltViewModel()
) {
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    val playlistCoverUrls by viewModel.playlistCoverUrls.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val themes by viewModel.themes.collectAsStateWithLifecycle()
    val animeItems by viewModel.animeItems.collectAsStateWithLifecycle()
    val artists by viewModel.artists.collectAsStateWithLifecycle()
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()
    val downloadingThemeIds by viewModel.downloadingThemeIds.collectAsStateWithLifecycle()
    val likedThemeIds by viewModel.likedThemeIds.collectAsStateWithLifecycle()
    val dislikedThemeIds by viewModel.dislikedThemeIds.collectAsStateWithLifecycle()
    val showDownloadedOnly by viewModel.showDownloadedOnly.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    var selectedTab by rememberSaveable {
        mutableStateOf(
            when (initialTab) {
                "songs" -> LibraryTab.Songs.name
                "animes" -> LibraryTab.Albums.name
                "artists" -> LibraryTab.Artists.name
                else -> LibraryTab.Playlists.name
            }
        )
    }
    val currentTab = LibraryTab.valueOf(selectedTab)
    var showDialog by remember { mutableStateOf(false) }
    var playlistToRename by remember { mutableStateOf<PlaylistWithCount?>(null) }
    var playlistToDelete by remember { mutableStateOf<PlaylistWithCount?>(null) }
    val animeByThemesId = remember(anime) {
        anime.mapNotNull { entry -> entry.animeThemesId?.let { id -> id to entry } }.toMap()
    }

    var sheetTheme by remember { mutableStateOf<ThemeEntity?>(null) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }

    sheetTheme?.let { theme ->
        val sheetAnime = theme.animeId?.let { animeByThemesId[it] }
        val info = theme.displayInfo(sheetAnime)
        val isDownloaded = theme.id in downloadedThemeIds
        val isDownloading = theme.id in downloadingThemeIds
        ActionSheet(
            config = ActionSheetConfig(
                title = info.primaryText,
                subtitle = info.secondaryText,
                imageUrl = sheetAnime?.primaryArtworkUrl(),
                showGoToArtist = !theme.artistName.isNullOrBlank(),
                showGoToAnime = sheetAnime?.kitsuId != null,
                showDownload = !isDownloaded && !isDownloading,
                showDownloading = isDownloading,
                showRemoveDownload = isDownloaded,
                showLike = true,
                isLiked = theme.id in likedThemeIds,
                showRemoveDislike = theme.id in dislikedThemeIds,
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
            onRemoveDownload = { viewModel.removeDownload(theme.id) },
            onLike = { viewModel.toggleLike(theme.id) },
            onRemoveDislike = { viewModel.toggleDislike(theme.id) }
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

    val backgroundGradient = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundGradient)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = 16.dp)
        ) {
            LibraryHeader(
                modifier = Modifier.padding(horizontal = 20.dp),
                onOpenSettings = onOpenSettings,
                hasUpdateAvailable = hasSettingsUpdateDot,
                showDownloadedOnly = showDownloadedOnly,
                onToggleDownloaded = { viewModel.toggleDownloadedOnly() },
                hasDownloads = downloadedThemeIds.isNotEmpty()
            )
            Spacer(modifier = Modifier.height(12.dp))
            LibraryFilters(
                selectedTab = currentTab,
                onTabSelected = { selectedTab = it.name },
                modifier = Modifier.padding(horizontal = 20.dp)
            )
            Spacer(modifier = Modifier.height(16.dp))

            when (currentTab) {
                LibraryTab.Playlists -> {
                    Box(modifier = Modifier.fillMaxSize()) {
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(2),
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            if (playlists.isEmpty()) {
                                item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                                    EmptyState(
                                        title = "No playlists yet",
                                        subtitle = "Tap + to create your first playlist."
                                    )
                                }
                            } else {
                                items(playlists, key = { it.playlist.id }) { item ->
                                    val isAuto = item.playlist.isAuto
                                    val coverUrls = playlistCoverUrls[item.playlist.id] ?: emptyList()
                                    var showMenu by remember { mutableStateOf(false) }
                                    Box {
                                        FeaturedPlaylistCard(
                                            title = item.playlist.name,
                                            subtitle = "${item.trackCount} tracks",
                                            coverUrls = coverUrls,
                                            gradientSeed = item.playlist.gradientSeed,
                                            isAutoPlaylist = isAuto,
                                            onClick = { onOpenPlaylist(item.playlist.id) },
                                            onLongClick = if (isAuto) null else { { showMenu = true } }
                                        )
                                        if (!isAuto) {
                                            androidx.compose.material3.DropdownMenu(
                                                expanded = showMenu,
                                                onDismissRequest = { showMenu = false }
                                            ) {
                                                androidx.compose.material3.DropdownMenuItem(
                                                    text = { Text("Rename") },
                                                    onClick = { showMenu = false; playlistToRename = item }
                                                )
                                                androidx.compose.material3.DropdownMenuItem(
                                                    text = { Text("Delete") },
                                                    onClick = { showMenu = false; playlistToDelete = item }
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                                Spacer(modifier = Modifier.height(MiniPlayerHeight + 26.dp))
                            }
                        }
                        NewPlaylistPill(
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(end = 20.dp, bottom = MiniPlayerHeight + 20.dp),
                            onClick = { showDialog = true }
                        )
                    }
                }

                LibraryTab.Songs -> {
                    val filteredThemes = filterLibrarySongs(
                        allSongs = themes,
                        downloadedThemeIds = downloadedThemeIds,
                        showDownloadedOnly = showDownloadedOnly
                    )
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        if (filteredThemes.isNotEmpty()) {
                            item {
                                SongsCollectionHeader(
                                    title = if (showDownloadedOnly) "Downloaded songs" else "All songs",
                                    trackCount = filteredThemes.size,
                                    onPlayAll = {
                                        viewModel.playAllSongs(filteredThemes, showDownloadedOnly)
                                        onPlayTheme()
                                    },
                                    onShuffleAll = {
                                        viewModel.shuffleAllSongs(filteredThemes, showDownloadedOnly)
                                        onPlayTheme()
                                    }
                                )
                            }
                        }
                        if (filteredThemes.isEmpty()) {
                            item {
                                EmptyState(
                                    title = if (showDownloadedOnly) "No downloads yet" else if (anime.isEmpty()) "No songs yet" else "No themes mapped yet",
                                    subtitle = if (showDownloadedOnly) "Download songs to listen offline." else if (anime.isEmpty()) "Sync your anime list to start." else "Try syncing again later."
                                )
                            }
                        } else {
                            items(filteredThemes, key = { "song-${it.id}" }) { theme ->
                                val animeEntry = animeByThemesId[theme.animeId]
                                val imageUrls = remember(animeEntry) { animeEntry?.primaryArtworkUrls() ?: emptyList() }
                                val isDownloaded = theme.id in downloadedThemeIds
                                val isDownloading = theme.id in downloadingThemeIds
                                ListRow(
                                    title = theme.title,
                                    subtitle = theme.artistName ?: "Unknown artist",
                                    accent = Rose500,
                                    imageUrls = imageUrls,
                                    isDownloaded = isDownloaded,
                                    isDownloading = isDownloading,
                                    isUnavailableOffline = !isOnline && !isDownloaded,
                                    onClick = {
                                        viewModel.playFromSongs(theme.id, filteredThemes, showDownloadedOnly)
                                        onPlayTheme()
                                    },
                                    onMoreOptions = { sheetTheme = theme }
                                )
                            }
                        }
                        item { Spacer(modifier = Modifier.height(90.dp)) }
                    }
                }

                LibraryTab.Albums -> {
                    val downloadedAnimeIds = if (showDownloadedOnly) {
                        themes.filter { it.id in downloadedThemeIds }.mapNotNull { it.animeId }.toSet()
                    } else null
                    val filteredAnimeItems = if (downloadedAnimeIds != null) {
                        animeItems.filter { it.animeThemesId in downloadedAnimeIds }
                    } else animeItems
                    if (filteredAnimeItems.isEmpty()) {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 20.dp)
                        ) {
                            item {
                                EmptyState(
                                    title = if (showDownloadedOnly) "No downloaded anime" else "No animes yet",
                                    subtitle = if (showDownloadedOnly) "Download anime to see them here." else "Sync your anime list to see your library."
                                )
                            }
                        }
                    } else {
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(2),
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(filteredAnimeItems) { animeItem ->
                                GridCard(
                                    title = animeItem.title,
                                    subtitle = "${animeItem.trackCount} themes",
                                    imageUrl = animeItem.coverUrl,
                                    onClick = { onOpenAnime(animeItem.kitsuId) }
                                )
                            }
                        }
                    }
                }

                LibraryTab.Artists -> {
                    val downloadedArtistNames = if (showDownloadedOnly) {
                        themes.filter { it.id in downloadedThemeIds }
                            .mapNotNull { it.artistName }
                            .flatMap { it.split(",").map { s -> s.trim().substringBefore(" (as ") } }
                            .toSet()
                    } else null
                    val filteredArtists = if (downloadedArtistNames != null) {
                        artists.filter { it.name in downloadedArtistNames }
                    } else artists
                    if (filteredArtists.isEmpty()) {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 20.dp)
                        ) {
                            item {
                                EmptyState(
                                    title = if (showDownloadedOnly) "No downloaded artists" else if (anime.isEmpty()) "No artists yet" else "No artists found",
                                    subtitle = if (showDownloadedOnly) "Download songs to see artists here." else "Artists will appear once themes are mapped."
                                )
                            }
                        }
                    } else {
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(3),
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(filteredArtists) { artist ->
                                ArtistGridCard(
                                    name = artist.name,
                                    subtitle = "${artist.trackCount} songs",
                                    imageUrl = artist.imageUrl,
                                    onClick = { onOpenArtist(artist.name) }
                                )
                            }
                        }
                    }
                }
            }
        }

        if (showDialog) {
            NewPlaylistDialog(
                onDismiss = { showDialog = false },
                onCreate = {
                    viewModel.createPlaylist(it)
                    showDialog = false
                }
            )
        }

        playlistToRename?.let { playlist ->
            RenamePlaylistDialog(
                currentName = playlist.playlist.name,
                onDismiss = { playlistToRename = null },
                onRename = { newName ->
                    viewModel.renamePlaylist(playlist.playlist.id, newName)
                    playlistToRename = null
                }
            )
        }

        playlistToDelete?.let { playlist ->
            DeleteConfirmDialog(
                playlistName = playlist.playlist.name,
                onDismiss = { playlistToDelete = null },
                onConfirm = {
                    viewModel.deletePlaylist(playlist.playlist.id)
                    playlistToDelete = null
                }
            )
        }
    }
}

@Composable
private fun SongsCollectionHeader(
    title: String,
    trackCount: Int,
    onPlayAll: () -> Unit,
    onShuffleAll: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
            .border(1.dp, Mist200.copy(alpha = 0.12f), RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = Mist100
            )
            Text(
                text = "$trackCount tracks ready to queue",
                style = MaterialTheme.typography.labelMedium,
                color = Mist200
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = onPlayAll,
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
                onClick = onShuffleAll,
                colors = ButtonDefaults.buttonColors(containerColor = Mist200.copy(alpha = 0.12f)),
                shape = RoundedCornerShape(24.dp),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    Icons.Rounded.Shuffle,
                    contentDescription = null,
                    tint = Mist100,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("Shuffle", color = Mist100, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun LibraryHeader(
    modifier: Modifier = Modifier,
    onOpenSettings: () -> Unit = {},
    hasUpdateAvailable: Boolean = false,
    showDownloadedOnly: Boolean = false,
    onToggleDownloaded: () -> Unit = {},
    hasDownloads: Boolean = false
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = "Library",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = Mist100
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            if (hasDownloads) {
                val chipBg = if (showDownloadedOnly) Rose500 else Ink700.copy(alpha = 0.6f)
                val chipText = if (showDownloadedOnly) Mist100 else Mist200
                Text(
                    text = "Downloaded",
                    style = MaterialTheme.typography.labelSmall,
                    color = chipText,
                    modifier = Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(chipBg)
                        .clickable { onToggleDownloaded() }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                )
            }
            Box {
                IconButton(onClick = onOpenSettings) {
                    Icon(
                        Icons.Rounded.Settings,
                        contentDescription = "Settings",
                        tint = Mist200,
                        modifier = Modifier.size(24.dp)
                    )
                }
                if (hasUpdateAvailable) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(top = 10.dp, end = 10.dp)
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(Sky500)
                            .border(1.dp, Ink900, CircleShape)
                    )
                }
            }
        }
    }
}

@Composable
private fun LibraryFilters(
    selectedTab: LibraryTab,
    onTabSelected: (LibraryTab) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        LibraryTab.values().forEach { tab ->
            val isSelected = tab == selectedTab
            val bg = if (isSelected) Rose500.copy(alpha = 0.15f) else Ink800.copy(alpha = 0.5f)
            val borderColor = if (isSelected) Rose500.copy(alpha = 0.5f) else Mist200.copy(alpha = 0.15f)
            Text(
                text = tab.label,
                modifier = Modifier
                    .background(bg, RoundedCornerShape(20.dp))
                    .border(1.dp, borderColor, RoundedCornerShape(20.dp))
                    .clickable { onTabSelected(tab) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                style = MaterialTheme.typography.labelMedium,
                color = if (isSelected) Mist100 else Mist200
            )
        }
    }
}


@Composable
private fun GridCard(
    title: String,
    subtitle: String,
    imageUrl: String?,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Ink800.copy(alpha = 0.6f))
            .border(1.dp, Mist200.copy(alpha = 0.1f), shape)
            .clickable { onClick() }
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                .background(Ember400.copy(alpha = 0.1f))
        ) {
            if (!imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Column(modifier = Modifier.padding(10.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                color = Mist100,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = Mist200,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun ArtistGridCard(
    name: String,
    subtitle: String,
    imageUrl: String?,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Ink800.copy(alpha = 0.6f))
            .border(1.dp, Mist200.copy(alpha = 0.1f), shape)
            .clickable { onClick() }
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(
                    Brush.linearGradient(listOf(Rose500.copy(alpha = 0.3f), Ink800)),
                    CircleShape
                ),
            contentAlignment = Alignment.Center
        ) {
            if (!imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize().clip(CircleShape),
                    contentScale = ContentScale.Crop
                )
            } else {
                Text(
                    text = name.take(2).uppercase(),
                    style = MaterialTheme.typography.titleMedium,
                    color = Mist100.copy(alpha = 0.6f)
                )
            }
        }
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = name,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            color = Mist100,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.labelSmall,
            color = Mist200,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun ListRow(
    title: String,
    subtitle: String,
    accent: Color,
    imageUrl: String? = null,
    imageUrls: List<String> = emptyList(),
    isAutoPlaylist: Boolean = false,
    isDownloaded: Boolean = false,
    isDownloading: Boolean = false,
    isUnavailableOffline: Boolean = false,
    onClick: () -> Unit = {},
    onRename: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null,
    onMoreOptions: (() -> Unit)? = null,
    coverContent: (@Composable () -> Unit)? = null
) {
    val shape = RoundedCornerShape(12.dp)
    var showMenu by remember { mutableStateOf(false) }
    val rowAlpha = if (isUnavailableOffline) 0.4f else 1f
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(rowAlpha)
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.1f), shape)
            .clickable { onClick() }
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (coverContent != null) {
            coverContent()
        } else {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(accent.copy(alpha = 0.15f))
            ) {
                if (imageUrls.isNotEmpty()) {
                    FallbackAsyncImage(
                        urls = imageUrls,
                        contentDescription = null,
                        modifier = Modifier.matchParentSize()
                    )
                } else if (!imageUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = imageUrl,
                        contentDescription = null,
                        modifier = Modifier.matchParentSize(),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isAutoPlaylist) {
                    Icon(
                        imageVector = Icons.Rounded.AutoAwesome,
                        contentDescription = "Auto Playlist",
                        tint = Mist200,
                        modifier = Modifier
                            .size(16.dp)
                            .padding(end = 4.dp)
                    )
                }
                Text(
                    text = title,
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
                }
            }
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = Mist200
            )
        }
        if (onMoreOptions != null) {
            IconButton(onClick = onMoreOptions, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Rounded.MoreVert, contentDescription = "More options", tint = Mist200, modifier = Modifier.size(20.dp))
            }
        } else if (onRename != null || onDelete != null) {
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Rounded.MoreVert, contentDescription = "More", tint = Mist200)
                }
                androidx.compose.material3.DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    if (onRename != null) {
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("Rename") },
                            onClick = { showMenu = false; onRename() },
                            leadingIcon = { Icon(Icons.Rounded.Edit, contentDescription = null) }
                        )
                    }
                    if (onDelete != null) {
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text("Delete", color = Rose500) },
                            onClick = { showMenu = false; onDelete() },
                            leadingIcon = { Icon(Icons.Rounded.Delete, contentDescription = null, tint = Rose500) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NewPlaylistPill(
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Row(
        modifier = modifier
            .background(Color.White, RoundedCornerShape(24.dp))
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(imageVector = Icons.Rounded.Add, contentDescription = null, tint = Color.Black)
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = "New playlist", color = Color.Black, fontWeight = FontWeight.SemiBold)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewPlaylistDialog(
    onDismiss: () -> Unit,
    onCreate: (String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { Button(onClick = { onCreate(name) }) { Text("Create") } },
        dismissButton = {
            Button(onClick = onDismiss, colors = ButtonDefaults.buttonColors(containerColor = Ink700)) { Text("Cancel") }
        },
        title = { Text("New playlist") },
        text = { OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Playlist name") }) }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RenamePlaylistDialog(
    currentName: String,
    onDismiss: () -> Unit,
    onRename: (String) -> Unit
) {
    var name by remember { mutableStateOf(currentName) }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { Button(onClick = { onRename(name) }) { Text("Rename") } },
        dismissButton = {
            Button(onClick = onDismiss, colors = ButtonDefaults.buttonColors(containerColor = Ink700)) { Text("Cancel") }
        },
        title = { Text("Rename playlist") },
        text = { OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Playlist name") }) }
    )
}

@Composable
private fun DeleteConfirmDialog(
    playlistName: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Button(onClick = onConfirm, colors = ButtonDefaults.buttonColors(containerColor = Rose500)) { Text("Delete") }
        },
        dismissButton = {
            Button(onClick = onDismiss, colors = ButtonDefaults.buttonColors(containerColor = Ink700)) { Text("Cancel") }
        },
        title = { Text("Delete playlist?") },
        text = { Text("\"$playlistName\" and all its entries will be permanently removed.") }
    )
}

@Composable
private fun EmptyState(title: String, subtitle: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
            .border(1.dp, Mist200.copy(alpha = 0.15f), RoundedCornerShape(16.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text(text = title, style = MaterialTheme.typography.bodyLarge, color = Mist100)
        Text(text = subtitle, style = MaterialTheme.typography.labelMedium, color = Mist200)
    }
}
