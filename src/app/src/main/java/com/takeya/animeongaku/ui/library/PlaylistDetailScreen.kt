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
import androidx.compose.material.icons.rounded.AutoFixHigh
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.FilterList
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.preferredModeForThemeAction
import com.takeya.animeongaku.ui.common.themeModePreferenceAction
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import com.takeya.animeongaku.ui.common.BrowseVideoWarningDialog
import com.takeya.animeongaku.ui.common.PendingSyncBanner
import com.takeya.animeongaku.ui.common.PlaylistCoverArt
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.common.PlaylistPlaybackSettingsSheet
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
    onEditFilters: (Long) -> Unit = {},
    viewModel: PlaylistDetailViewModel = hiltViewModel()
) {
    val playlist by viewModel.playlist.collectAsStateWithLifecycle()
    val tracks by viewModel.tracks.collectAsStateWithLifecycle()
    val playlistItems by viewModel.items.collectAsStateWithLifecycle()
    val coverUrls by viewModel.coverUrls.collectAsStateWithLifecycle()
    val allThemes by viewModel.allThemes.collectAsStateWithLifecycle()
    val anime by viewModel.animeList.collectAsStateWithLifecycle()
    val searchQuery by viewModel.searchQuery.collectAsStateWithLifecycle()
    var showAddDialog by remember { mutableStateOf(false) }
    var sheetRow by remember { mutableStateOf<PlaylistItemRow?>(null) }
    var showPlaylistSheet by remember { mutableStateOf(false) }
    var showPlaybackSettings by remember { mutableStateOf(false) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
    var pickerSongId by remember { mutableStateOf<Long?>(null) }
    val allPlaylists by viewModel.playlists.collectAsStateWithLifecycle()
    val playlistCoverUrls by viewModel.playlistCoverUrls.collectAsStateWithLifecycle()
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()
    val downloadingThemeIds by viewModel.downloadingThemeIds.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    val themeModesById by viewModel.themeModesById.collectAsStateWithLifecycle()
    val dynamicSpec by viewModel.dynamicSpec.collectAsStateWithLifecycle()
    val isDynamic by viewModel.isDynamic.collectAsStateWithLifecycle()
    val pendingPlaylistWriteStatus by viewModel.pendingPlaylistWriteStatus.collectAsStateWithLifecycle()
    val playlistActionMessage by viewModel.playlistActionMessage.collectAsStateWithLifecycle()
    val playlistSyncMessage = playlistActionMessage ?: pendingPlaylistWriteStatus.message
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var pendingVideoRequest by remember { mutableStateOf<BrowseVideoStartRequest?>(null) }
    val animeByThemesId = remember(anime) {
        anime.mapNotNull { entry -> entry.animeThemesId?.let { id -> id to entry } }.toMap()
    }

    fun handleVideoRequest(request: BrowseVideoStartRequest?) {
        if (request == null) return
        if (request.warning != null) pendingVideoRequest = request
        else if (viewModel.startPlayVideo(request)) onPlayTheme()
    }

    pendingVideoRequest?.let { request ->
        BrowseVideoWarningDialog(request, { pendingVideoRequest = null }) {
            pendingVideoRequest = null
            if (viewModel.startPlayVideo(request)) onPlayTheme()
        }
    }

    if (showPlaylistSheet) {
        val allDownloaded = tracks.isNotEmpty() && tracks.all { it.theme.id in downloadedThemeIds }
        val anyDownloading = tracks.any { it.theme.id in downloadingThemeIds }
        ActionSheet(
            config = ActionSheetConfig(
                title = playlist?.name ?: "Playlist",
                subtitle = "${playlistItems.size} tracks",
                showPlayNext = playlistItems.isNotEmpty(),
                showAddToQueue = playlistItems.isNotEmpty(),
                showSaveToPlaylist = false,
                showDownload = !allDownloaded && !anyDownloading && tracks.isNotEmpty(),
                showDownloading = anyDownloading && !allDownloaded,
                showRemoveDownload = allDownloaded,
                showEditFilters = isDynamic,
                showSettings = true,
                settingsLabel = "Playlist settings",
                showRefresh = isDynamic && dynamicSpec?.mode == "SNAPSHOT",
                showDelete = isDynamic || playlist?.isAuto != true,
                deleteLabel = "Delete playlist",
                showPlayVideo = BrowseVideoActionPolicy.context(
                    isOnline,
                    tracks.mapNotNull { themeModesById[it.theme.id] }
                )
            ),
            onDismiss = { showPlaylistSheet = false },
            onPlayNext = viewModel::playNextAll,
            onAddToQueue = viewModel::addAllToQueue,
            onReplaceQueue = { viewModel.playAll(); onPlayTheme() },
            onPlayVideo = { handleVideoRequest(viewModel.requestPlayVideoAll()) },
            onDownload = { viewModel.downloadPlaylist() },
            onRemoveDownload = { viewModel.removePlaylistDownload() },
            onEditFilters = { playlist?.id?.let { onEditFilters(it) } },
            onSettings = { showPlaybackSettings = true },
            onRefresh = { viewModel.refreshDynamic() },
            onDelete = { showDeleteConfirm = true }
        )
    }

    if (showPlaybackSettings) {
        PlaylistPlaybackSettingsSheet(
            selectedMode = playlist?.defaultMode ?: "TV_SIZE",
            overrideUserPreference = playlist?.overrideUserPreference == true,
            onModeSelected = viewModel::updateDefaultMode,
            onOverrideChanged = viewModel::updateOverrideUserPreference,
            onDismiss = { showPlaybackSettings = false }
        )
    }

    sheetRow?.let { row ->
        val theme = row.theme
        val sheetAnime = theme?.animeId?.let { animeByThemesId[it] }
        val sheetAnimeImageUrls = sheetAnime?.primaryArtworkUrls() ?: emptyList()
        val info = theme?.displayInfo(sheetAnime)
        val isDownloaded = theme?.id in downloadedThemeIds
        val isDownloading = theme?.id in downloadingThemeIds
        val preference by remember(theme?.id) {
            viewModel.observePreference(theme?.id)
        }.collectAsStateWithLifecycle(initialValue = null)
        ActionSheet(
            config = ActionSheetConfig(
                title = info?.primaryText ?: row.title,
                subtitle = info?.secondaryText ?: row.artist,
                imageUrl = sheetAnimeImageUrls.firstOrNull(),
                imageUrls = sheetAnimeImageUrls,
                showGoToArtist = !theme?.artistName.isNullOrBlank(),
                showGoToAnime = sheetAnime?.kitsuId != null,
                showDownload = theme != null && !isDownloaded && !isDownloading,
                showDownloading = theme != null && isDownloading,
                showRemoveDownload = theme != null && isDownloaded,
                showLike = theme != null,
                isLiked = preference?.isLiked == true,
                showRemoveDislike = preference?.isDisliked == true,
                artistName = theme?.artistName?.split(",")?.firstOrNull()?.trim(),
                animeName = sheetAnime?.title,
                showPlayVideo = theme != null && BrowseVideoActionPolicy.singleTheme(isOnline, themeModesById[theme.id]),
                showDelete = playlist?.isAuto != true,
                deleteLabel = "Remove from playlist",
                customActions = listOfNotNull(themeModePreferenceAction(
                    theme?.let { themeModesById[it.id]?.fullSizeUrl?.isNotBlank() }, preference?.preferredMode
                ))
            ),
            onDismiss = { sheetRow = null },
            onPlayNext = { viewModel.playNextEntry(row.entry.entryId) },
            onAddToQueue = { viewModel.addEntryToQueue(row.entry.entryId) },
            onReplaceQueue = { viewModel.playEntry(row.entry.entryId); onPlayTheme() },
            onPlayVideo = { theme?.id?.let { handleVideoRequest(viewModel.requestPlayVideoTheme(it)) } },
            onSaveToPlaylist = {
                if (theme != null) pickerThemeIds = listOf(theme.id) else pickerSongId = row.song?.id
            },
            onGoToArtist = { theme?.artistName?.split(",")?.firstOrNull()?.trim()?.let { onOpenArtist(it) } },
            onGoToAnime = { sheetAnime?.kitsuId?.let { onOpenAnime(it) } },
            onDownload = { theme?.let(viewModel::downloadSong) },
            onRemoveDownload = { theme?.id?.let(viewModel::removeDownload) },
            onLike = { theme?.id?.let(viewModel::toggleLike) },
            onRemoveDislike = { theme?.id?.let(viewModel::toggleDislike) },
            onDelete = { viewModel.removeEntry(row.entry.entryId) },
            onCustomAction = { key ->
                val mode = preferredModeForThemeAction(key)
                if (theme != null && mode != null) viewModel.setPreferredMode(theme.id, mode)
            }
        )
    }

    pickerThemeIds?.let { ids ->
        PlaylistPickerSheet(
            playlists = allPlaylists,
            coverUrls = playlistCoverUrls,
            onDismiss = { pickerThemeIds = null },
            onSelectPlaylist = { playlistId ->
                viewModel.addToOtherPlaylist(playlistId, ids)
                pickerThemeIds = null
            },
            onCreatePlaylist = { name ->
                viewModel.createAndAddToPlaylist(name, ids)
                pickerThemeIds = null
            },
            showThemeModeChoice = true,
            onSelectPlaylistWithMode = { playlistId, modeOverride ->
                viewModel.addToOtherPlaylist(playlistId, ids, modeOverride)
                pickerThemeIds = null
            },
            onCreatePlaylistWithMode = { name, modeOverride ->
                viewModel.createAndAddToPlaylist(name, ids, modeOverride)
                pickerThemeIds = null
            }
        )
    }

    pickerSongId?.let { songId ->
        PlaylistPickerSheet(
            playlists = allPlaylists,
            coverUrls = playlistCoverUrls,
            onDismiss = { pickerSongId = null },
            onSelectPlaylist = { playlistId ->
                viewModel.addSongToOtherPlaylist(playlistId, songId)
                pickerSongId = null
            },
            onCreatePlaylist = { name ->
                viewModel.createAndAddSongToPlaylist(name, songId)
                pickerSongId = null
            }
        )
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete playlist?") },
            text = { Text("\"${playlist?.name ?: "This playlist"}\" will be permanently deleted.") },
            confirmButton = {
                Button(
                    onClick = {
                        showDeleteConfirm = false
                        viewModel.deletePlaylist()
                        onBack()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Rose500)
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                Button(
                    onClick = { showDeleteConfirm = false },
                    colors = ButtonDefaults.buttonColors(containerColor = Ink700)
                ) {
                    Text("Cancel")
                }
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
                                imageVector = if (isDynamic) Icons.Rounded.AutoFixHigh else Icons.Rounded.AutoAwesome,
                                contentDescription = if (isDynamic) "Smart Playlist" else "Auto Playlist",
                                tint = if (isDynamic) Rose500 else Mist200,
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

            playlistSyncMessage?.let { message ->
                item {
                    PendingSyncBanner(
                        message = message,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                    )
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
                        coverUrlGroups = coverUrls,
                        gradientSeed = playlist?.gradientSeed ?: 0,
                        size = 160.dp,
                        cornerRadius = 16.dp,
                        modifier = Modifier.padding(bottom = 16.dp)
                    )
                    Text(
                        text = "${playlistItems.size} tracks",
                        style = MaterialTheme.typography.labelMedium,
                        color = Mist200
                    )
                    dynamicSpec?.let { spec ->
                        val subtitle = if (spec.mode == "AUTO") {
                            "Smart · auto-updating"
                        } else {
                            val relativeTime = if (spec.lastEvaluatedAt == 0L) {
                                "never"
                            } else {
                                val diff = System.currentTimeMillis() - spec.lastEvaluatedAt
                                when {
                                    diff < 60_000L -> "just now"
                                    diff < 3_600_000L -> "${diff / 60_000L}m ago"
                                    diff < 86_400_000L -> "${diff / 3_600_000L}h ago"
                                    else -> "${diff / 86_400_000L}d ago"
                                }
                            }
                            "Smart · snapshot · updated $relativeTime"
                        }
                        Text(
                            text = subtitle,
                            style = MaterialTheme.typography.labelSmall,
                            color = Rose500
                        )
                    }
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

            if (playlistItems.isEmpty()) {
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
                        Text("Tap + to add music from your library.", style = MaterialTheme.typography.labelSmall, color = Mist200)
                    }
                }
            } else {
                itemsIndexed(playlistItems, key = { _, row -> row.entry.entryId }) { index, row ->
                    val theme = row.theme
                    val animeEntry = theme?.animeId?.let { animeByThemesId[it] }
                    val imageUrls = animeEntry?.primaryArtworkUrls() ?: emptyList()
                    val info = theme?.displayInfo(animeEntry)
                    val tdl = theme?.id in downloadedThemeIds
                    val tding = theme?.id in downloadingThemeIds
                    val wantsFull = row.entry.modeOverride == "FULL_SIZE" ||
                        (row.entry.modeOverride == null && playlist?.defaultMode == "FULL_SIZE")
                    val fullUnavailable = theme != null && wantsFull && themeModesById[theme.id]?.fullSizeUrl.isNullOrBlank()
                    CompactTrackRow(
                        title = info?.primaryText ?: row.title,
                        artist = if (fullUnavailable) "${info?.secondaryText ?: row.artist} · Full Size unavailable; TV Size will play" else info?.secondaryText ?: row.artist,
                        imageUrls = imageUrls,
                        isDownloaded = tdl,
                        isDownloading = tding,
                        isUnavailableOffline = !isOnline && !tdl,
                        onPlay = { viewModel.playEntry(row.entry.entryId); onPlayTheme() },
                        onRemove = if (playlist?.isAuto == true) null else {{ viewModel.removeEntry(row.entry.entryId) }},
                        modeOverride = row.entry.modeOverride,
                        canEditMode = playlist?.isAuto != true && theme != null,
                        onModeChange = { viewModel.updateEntryMode(row.entry.entryId, it) },
                        onMoreOptions = { sheetRow = row },
                        canMoveUp = playlist?.isAuto != true && index > 0,
                        canMoveDown = playlist?.isAuto != true && index < playlistItems.lastIndex,
                        onMoveUp = { viewModel.moveEntry(row.entry.entryId, -1) },
                        onMoveDown = { viewModel.moveEntry(row.entry.entryId, 1) }
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
    imageUrls: List<String> = emptyList(),
    isDownloaded: Boolean = false,
    isDownloading: Boolean = false,
    isUnavailableOffline: Boolean = false,
    onPlay: () -> Unit,
    onRemove: (() -> Unit)? = null,
    onMoreOptions: (() -> Unit)? = null,
    modeOverride: String? = null,
    canEditMode: Boolean = false,
    onModeChange: (String?) -> Unit = {},
    canMoveUp: Boolean = false,
    canMoveDown: Boolean = false,
    onMoveUp: () -> Unit = {},
    onMoveDown: () -> Unit = {}
) {
    var showEntryMenu by remember { mutableStateOf(false) }
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
            if (modeOverride != null) {
                Text(
                    text = if (modeOverride == "FULL_SIZE") "Full Size override" else "TV Size override",
                    style = MaterialTheme.typography.labelSmall,
                    color = Rose500
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (canEditMode || onRemove != null || canMoveUp || canMoveDown) {
                Box {
                    IconButton(onClick = { showEntryMenu = true }, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Rounded.Edit, contentDescription = "Edit playlist entry", tint = Mist200, modifier = Modifier.size(18.dp))
                    }
                    DropdownMenu(expanded = showEntryMenu, onDismissRequest = { showEntryMenu = false }) {
                        if (canEditMode) {
                            DropdownMenuItem(text = { Text("Use playlist default") }, onClick = { showEntryMenu = false; onModeChange(null) })
                            DropdownMenuItem(text = { Text("TV Size") }, onClick = { showEntryMenu = false; onModeChange("TV_SIZE") })
                            DropdownMenuItem(text = { Text("Full Size") }, onClick = { showEntryMenu = false; onModeChange("FULL_SIZE") })
                        }
                        if (canMoveUp) {
                            DropdownMenuItem(text = { Text("Move up") }, onClick = { showEntryMenu = false; onMoveUp() })
                        }
                        if (canMoveDown) {
                            DropdownMenuItem(text = { Text("Move down") }, onClick = { showEntryMenu = false; onMoveDown() })
                        }
                        if (onRemove != null) {
                            DropdownMenuItem(
                                text = { Text("Remove from playlist", color = Rose500) },
                                onClick = { showEntryMenu = false; onRemove() }
                            )
                        }
                    }
                }
            }
            if (onMoreOptions != null) {
                IconButton(onClick = onMoreOptions, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Rounded.MoreVert, contentDescription = "More", tint = Mist200, modifier = Modifier.size(20.dp))
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
    onAdd: (ThemeEntity, String?) -> Unit,
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
    var addMode by remember { mutableStateOf<String?>(null) }
    var showModeMenu by remember { mutableStateOf(false) }

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
                Box {
                    Text(
                        text = "Playback version: " + when (addMode) {
                            "TV_SIZE" -> "TV Size"
                            "FULL_SIZE" -> "Full Size"
                            else -> "Use playlist default"
                        },
                        color = Mist100,
                        modifier = Modifier.clickable { showModeMenu = true }.padding(vertical = 8.dp)
                    )
                    DropdownMenu(expanded = showModeMenu, onDismissRequest = { showModeMenu = false }) {
                        DropdownMenuItem(text = { Text("Use playlist default") }, onClick = { addMode = null; showModeMenu = false })
                        DropdownMenuItem(text = { Text("TV Size") }, onClick = { addMode = "TV_SIZE"; showModeMenu = false })
                        DropdownMenuItem(text = { Text("Full Size") }, onClick = { addMode = "FULL_SIZE"; showModeMenu = false })
                    }
                }
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
                            val imgUrls = animeEntry?.primaryArtworkUrls() ?: emptyList()
                            val info = theme.displayInfo(animeEntry)
                            AddThemeRow(info = info, imageUrls = imgUrls, onAdd = { onAdd(theme, addMode) })
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
private fun AddThemeRow(info: com.takeya.animeongaku.ui.common.ThemeDisplayInfo, imageUrls: List<String> = emptyList(), onAdd: () -> Unit) {
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
            if (imageUrls.isNotEmpty()) {
                FallbackAsyncImage(
                    urls = imageUrls,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize()
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
