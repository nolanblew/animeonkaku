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
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.AlertDialog
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
import com.takeya.animeongaku.ui.common.SongOptionsSheet
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

private enum class LibraryTab(val label: String) {
    Playlists("Playlists"),
    Songs("Songs"),
    Albums("Animes"),
    Artists("Artists")
}

@Composable
fun LibraryScreen(
    onOpenImport: () -> Unit,
    onOpenPlaylist: (Long) -> Unit,
    onPlayTheme: () -> Unit,
    onOpenAnime: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
    initialTab: String? = null,
    viewModel: LibraryViewModel = hiltViewModel()
) {
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val themes by viewModel.themes.collectAsStateWithLifecycle()
    val animeItems by viewModel.animeItems.collectAsStateWithLifecycle()
    val artists by viewModel.artists.collectAsStateWithLifecycle()
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
    sheetTheme?.let { theme ->
        val sheetAnime = theme.animeId?.let { animeByThemesId[it] }
        SongOptionsSheet(
            theme = theme,
            anime = sheetAnime,
            onDismiss = { sheetTheme = null },
            onPlayNext = { viewModel.nowPlayingManager.playNext(theme, sheetAnime) },
            onAddToQueue = { viewModel.nowPlayingManager.addToQueue(theme, sheetAnime) },
            onSaveToPlaylist = { /* TODO: open playlist picker */ }
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
            LibraryHeader(modifier = Modifier.padding(horizontal = 20.dp))
            Spacer(modifier = Modifier.height(12.dp))
            LibraryFilters(
                selectedTab = currentTab,
                onTabSelected = { selectedTab = it.name },
                modifier = Modifier.padding(horizontal = 20.dp)
            )
            Spacer(modifier = Modifier.height(12.dp))
            LibraryActions(onOpenImport, modifier = Modifier.padding(horizontal = 20.dp))
            Spacer(modifier = Modifier.height(16.dp))

            when (currentTab) {
                LibraryTab.Playlists -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        if (playlists.isEmpty()) {
                            item {
                                EmptyState(
                                    title = "No playlists yet",
                                    subtitle = "Tap + to create your first playlist."
                                )
                            }
                        } else {
                            items(playlists) { playlist ->
                                ListRow(
                                    title = playlist.playlist.name,
                                    subtitle = "${playlist.trackCount} tracks",
                                    accent = Rose500,
                                    onClick = { onOpenPlaylist(playlist.playlist.id) },
                                    onRename = { playlistToRename = playlist },
                                    onDelete = { playlistToDelete = playlist }
                                )
                            }
                        }
                        item { Spacer(modifier = Modifier.height(90.dp)) }
                    }
                }

                LibraryTab.Songs -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        if (themes.isEmpty()) {
                            item {
                                EmptyState(
                                    title = if (anime.isEmpty()) "No songs yet" else "No themes mapped yet",
                                    subtitle = if (anime.isEmpty()) "Sync your anime list to start." else "Try syncing again later."
                                )
                            }
                        } else {
                            items(themes) { theme ->
                                val imageUrl = animeByThemesId[theme.animeId]?.coverUrl
                                    ?: animeByThemesId[theme.animeId]?.thumbnailUrl
                                ListRow(
                                    title = theme.title,
                                    subtitle = theme.artistName ?: "Unknown artist",
                                    accent = Rose500,
                                    imageUrl = imageUrl,
                                    onClick = {
                                        viewModel.playFromSongs(theme.id)
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
                    if (animeItems.isEmpty()) {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 20.dp)
                        ) {
                            item {
                                EmptyState(
                                    title = "No animes yet",
                                    subtitle = "Sync your anime list to see your library."
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
                            items(animeItems) { animeItem ->
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
                    if (artists.isEmpty()) {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 20.dp)
                        ) {
                            item {
                                EmptyState(
                                    title = if (anime.isEmpty()) "No artists yet" else "No artists found",
                                    subtitle = "Artists will appear once themes are mapped."
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
                            items(artists) { artist ->
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

        NewPlaylistPill(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(20.dp),
            onClick = { showDialog = true }
        )

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
private fun LibraryHeader(modifier: Modifier = Modifier) {
    Text(
        text = "Library",
        style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.Bold,
        color = Mist100,
        modifier = modifier.fillMaxWidth()
    )
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
private fun LibraryActions(onOpenImport: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.65f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "Sync with Kitsu",
                style = MaterialTheme.typography.bodyLarge,
                color = Mist100
            )
            Text(
                text = "Import your watchlist and update your library.",
                style = MaterialTheme.typography.labelSmall,
                color = Mist200
            )
        }
        Button(
            onClick = onOpenImport,
            colors = ButtonDefaults.buttonColors(containerColor = Ink700),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Rounded.CloudSync, contentDescription = null, tint = Mist100, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(6.dp))
            Text(text = "Sync", style = MaterialTheme.typography.labelMedium)
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
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(80.dp)
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
    onClick: () -> Unit = {},
    onRename: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null,
    onMoreOptions: (() -> Unit)? = null
) {
    val shape = RoundedCornerShape(12.dp)
    var showMenu by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.1f), shape)
            .clickable { onClick() }
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(accent.copy(alpha = 0.15f))
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
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
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
