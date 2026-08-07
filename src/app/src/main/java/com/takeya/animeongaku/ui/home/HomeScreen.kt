package com.takeya.animeongaku.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.rounded.MoreVert
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.draw.clip
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.preferredModeForThemeAction
import com.takeya.animeongaku.ui.common.themeModePreferenceAction
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import com.takeya.animeongaku.ui.common.BrowseVideoWarningDialog
import com.takeya.animeongaku.ui.common.FeaturedPlaylistCard
import com.takeya.animeongaku.ui.common.FeaturedPlaylistRow
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun HomeScreen(
    onPlayTheme: () -> Unit,
    onOpenPlaylist: (Long) -> Unit = {},
    onOpenAnime: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
    onNavigateToLibrary: (String) -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel()
) {
    val themes by viewModel.themes.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val quickPicks by viewModel.quickPicks.collectAsStateWithLifecycle()
    val topSongs by viewModel.topSongs.collectAsStateWithLifecycle()
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    val playlistCoverUrls by viewModel.playlistCoverUrls.collectAsStateWithLifecycle()
    val selectedChip by viewModel.selectedChip.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    val themeModesById by viewModel.themeModesById.collectAsStateWithLifecycle()
    val background = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    val animeByThemesId = remember(anime) {
        anime.mapNotNull { entry -> entry.animeThemesId?.let { id -> id to entry } }.toMap()
    }

    var sheetTheme by remember { mutableStateOf<ThemeEntity?>(null) }
    var sheetQuickPick by remember { mutableStateOf<HomeQuickPick?>(null) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
    var pickerSongId by remember { mutableStateOf<Long?>(null) }
    var pendingVideoRequest by remember { mutableStateOf<BrowseVideoStartRequest?>(null) }
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()
    val downloadingThemeIds by viewModel.downloadingThemeIds.collectAsStateWithLifecycle()

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

    sheetTheme?.let { theme ->
        val sheetAnime = theme.animeId?.let { animeByThemesId[it] }
        val sheetAnimeImageUrls = sheetAnime?.primaryArtworkUrls() ?: emptyList()
        val info = theme.displayInfo(sheetAnime)
        val isDownloaded = theme.id in downloadedThemeIds
        val isDownloading = theme.id in downloadingThemeIds
        val preference by remember(theme.id) {
            viewModel.observePreference(theme.id)
        }.collectAsStateWithLifecycle(initialValue = null)
        ActionSheet(
            config = ActionSheetConfig(
                title = info.primaryText,
                subtitle = info.secondaryText,
                imageUrl = sheetAnimeImageUrls.firstOrNull(),
                imageUrls = sheetAnimeImageUrls,
                showGoToArtist = !theme.artistName.isNullOrBlank(),
                showGoToAnime = sheetAnime?.kitsuId != null,
                showDownload = !isDownloaded && !isDownloading,
                showDownloading = isDownloading,
                showRemoveDownload = isDownloaded,
                showLike = true,
                isLiked = preference?.isLiked == true,
                showRemoveDislike = preference?.isDisliked == true,
                showPlayVideo = BrowseVideoActionPolicy.singleTheme(
                    isOnline,
                    themeModesById[theme.id]
                ),
                artistName = theme.artistName?.split(",")?.firstOrNull()?.trim(),
                animeName = sheetAnime?.title,
                customActions = listOfNotNull(themeModePreferenceAction(
                    themeModesById[theme.id]?.fullSizeUrl?.isNotBlank(), preference?.preferredMode
                ))
            ),
            onDismiss = { sheetTheme = null },
            onPlayNext = { viewModel.nowPlayingManager.playNext(theme, sheetAnime) },
            onAddToQueue = { viewModel.nowPlayingManager.addToQueue(theme, sheetAnime) },
            onReplaceQueue = { viewModel.nowPlayingManager.play("Now Playing", listOf(theme), 0, animeMap = sheetAnime?.let { a -> theme.animeId?.let { mapOf(it to a) } } ?: emptyMap()) },
            onPlayVideo = { handleVideoRequest(viewModel.requestPlayVideo(theme.id)) },
            onSaveToPlaylist = { pickerThemeIds = listOf(theme.id) },
            onGoToArtist = { theme.artistName?.split(",")?.firstOrNull()?.trim()?.let { onOpenArtist(it) } },
            onGoToAnime = { sheetAnime?.kitsuId?.let { onOpenAnime(it) } },
            onDownload = { viewModel.downloadSong(theme) },
            onRemoveDownload = { viewModel.removeDownload(theme.id) },
            onLike = { viewModel.toggleLike(theme.id) },
            onRemoveDislike = { viewModel.toggleDislike(theme.id) },
            onCustomAction = { key ->
                preferredModeForThemeAction(key)?.let { viewModel.setPreferredMode(theme.id, it) }
            }
        )
    }

    sheetQuickPick?.relatedTrack?.let { track ->
        val item = sheetQuickPick!!.item
        val preference by remember(track.song.id) {
            viewModel.observeSongPreference(track.song.id)
        }.collectAsStateWithLifecycle(initialValue = null)
        ActionSheet(
            config = ActionSheetConfig(
                title = track.song.title,
                subtitle = listOf(track.song.artistCredit, track.release.title)
                    .filter(String::isNotBlank)
                    .joinToString(" · "),
                imageUrl = track.release.artworkUrl ?: track.owner.artworkUrl,
                showGoToArtist = track.song.artistCredit.isNotBlank(),
                showGoToAnime = track.owner.kitsuId.isNotBlank(),
                showDownload = true,
                showLike = true,
                isLiked = preference?.isLiked == true,
                showDislike = true,
                isDisliked = preference?.isDisliked == true,
                artistName = track.song.artistCredit.split(",").firstOrNull()?.trim(),
                animeName = track.owner.title
            ),
            onDismiss = { sheetQuickPick = null },
            onPlayNext = { viewModel.playNext(item) },
            onAddToQueue = { viewModel.addToQueue(item) },
            onReplaceQueue = { viewModel.replaceQueue(item); onPlayTheme() },
            onSaveToPlaylist = { pickerSongId = track.song.id },
            onGoToArtist = { track.song.artistCredit.split(",").firstOrNull()?.trim()?.let(onOpenArtist) },
            onGoToAnime = { onOpenAnime(track.owner.kitsuId) },
            onDownload = { viewModel.downloadRelated(track) },
            onLike = { viewModel.toggleSongLike(track.song.id) },
            onDislike = { viewModel.toggleSongDislike(track.song.id) }
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
            },
            showThemeModeChoice = true,
            onSelectPlaylistWithMode = { playlistId, modeOverride ->
                viewModel.addToPlaylist(playlistId, ids, modeOverride)
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
            playlists = playlists,
            coverUrls = playlistCoverUrls,
            onDismiss = { pickerSongId = null },
            onSelectPlaylist = { playlistId ->
                viewModel.addSongToPlaylist(playlistId, songId)
                pickerSongId = null
            },
            onCreatePlaylist = { name ->
                viewModel.createAndAddSongToPlaylist(name, songId)
                pickerSongId = null
            }
        )
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                HomeTopBar()
            }

            item {
                ChipRow(
                    items = listOf("OPs", "EDs"),
                    selectedChip = selectedChip,
                    onChipSelected = { viewModel.selectChip(it) }
                )
            }

            item {
                SectionHeader(
                    title = "Quick picks", 
                    action = "Play all",
                    onActionClick = {
                        if (quickPicks.isNotEmpty()) {
                            viewModel.playAllQuickPicks()
                            onPlayTheme()
                        }
                    }
                )
            }

            if (quickPicks.isEmpty()) {
                item {
                    EmptyDataCard(
                        if (anime.isEmpty()) {
                            "Sync your library to see quick picks."
                        } else {
                            "No music is ready yet. Try syncing again later."
                        }
                    )
                }
            } else {
                items(quickPicks, key = { "qp-${it.stableKey}" }) { pick ->
                    val item = pick.item
                    val animeEntry = item.anime
                    val imageUrls = remember(item, animeEntry) {
                        listOfNotNull(item.display.artworkUrl) + animeEntry?.primaryArtworkUrls().orEmpty()
                    }
                    QuickPickRow(
                        item = item,
                        imageUrls = imageUrls.distinct(),
                        onPlay = {
                            viewModel.playFromQuickPicks(pick.stableKey)
                            onPlayTheme()
                        },
                        onMoreOptions = {
                            when (item) {
                                is PlayableItem.Theme -> sheetTheme = item.theme
                                is PlayableItem.RelatedSong -> sheetQuickPick = pick
                            }
                        }
                    )
                }
            }

            item {
                SectionHeader(
                    title = "Your playlists", 
                    action = "See all",
                    onActionClick = { onNavigateToLibrary("playlists") }
                )
            }

            if (playlists.isEmpty()) {
                item {
                    EmptyDataCard("Create a playlist in your Library to see it here.")
                }
            } else {
                item {
                    FeaturedPlaylistRow(
                        playlists = playlists.take(4),
                        coverUrlsMap = playlistCoverUrls,
                        onOpenPlaylist = onOpenPlaylist
                    )
                }
            }

            item {
                SectionHeader(
                    title = "Top songs", 
                    action = "See all",
                    onActionClick = { onNavigateToLibrary("songs") }
                )
            }

            if (topSongs.isEmpty()) {
                item {
                    EmptyDataCard(
                        if (anime.isEmpty()) {
                            "Sync your library to see top songs."
                        } else {
                            "No themes mapped yet. Try syncing again later."
                        }
                    )
                }
            } else {
                items(topSongs, key = { "ts-${it.id}" }) { theme ->
                    val animeEntry = animeByThemesId[theme.animeId]
                    val imageUrls = remember(animeEntry) { animeEntry?.primaryArtworkUrls() ?: emptyList() }
                    QuickPickRow(
                        item = PlayableItem.Theme(theme, animeEntry, themeModesById[theme.id]),
                        imageUrls = imageUrls,
                        onPlay = {
                            viewModel.playFromTopSongs(theme.id)
                            onPlayTheme()
                        },
                        onMoreOptions = { sheetTheme = theme }
                    )
                }
            }

            item {
                Spacer(modifier = Modifier.height(60.dp))
            }
        }
    }
}

@Composable
private fun HomeTopBar() {
    Text(
        text = "Anime Ongaku",
        style = MaterialTheme.typography.titleLarge,
        color = Mist100,
        modifier = Modifier.fillMaxWidth()
    )
}

@Composable
private fun ChipRow(
    items: List<String>,
    selectedChip: String?,
    onChipSelected: (String) -> Unit
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { label ->
            val isSelected = label == selectedChip
            val bg = if (isSelected) Ink800 else Ink700
            val borderColor = if (isSelected) Rose500 else Mist200.copy(alpha = 0.3f)
            Text(
                text = label,
                modifier = Modifier
                    .background(bg, RoundedCornerShape(18.dp))
                    .border(1.dp, borderColor, RoundedCornerShape(18.dp))
                    .clickable { onChipSelected(label) }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                style = MaterialTheme.typography.labelMedium,
                color = if (isSelected) Mist100 else Mist200
            )
        }
    }
}

@Composable
private fun SectionHeader(title: String, action: String, onActionClick: () -> Unit = {}) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom
    ) {
        Text(text = title, style = MaterialTheme.typography.titleLarge, color = Mist100)
        Text(
            text = action, 
            style = MaterialTheme.typography.labelMedium, 
            color = Mist200,
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .clickable { onActionClick() }
                .padding(4.dp)
        )
    }
}


@Composable
private fun QuickPickRow(item: PlayableItem, imageUrls: List<String> = emptyList(), onPlay: () -> Unit, onMoreOptions: () -> Unit = {}) {
    val (primaryText, secondaryText) = when (item) {
        is PlayableItem.Theme -> item.theme.displayInfo(item.anime).let { info ->
            info.primaryText to info.secondaryText
        }
        is PlayableItem.RelatedSong -> {
            item.song.title to listOfNotNull(
                item.song.artistCredit.takeIf(String::isNotBlank),
                item.release?.title?.takeIf(String::isNotBlank) ?: item.anime?.title
            ).joinToString(" · ")
        }
    }
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape)
            .clickable { onPlay() }
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFF322A3C))
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
                text = primaryText,
                color = Mist100,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = secondaryText,
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
private fun EmptyDataCard(message: String) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.6f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.2f), shape)
            .padding(14.dp)
    ) {
        Text(text = message, style = MaterialTheme.typography.labelMedium, color = Mist200)
    }
}
