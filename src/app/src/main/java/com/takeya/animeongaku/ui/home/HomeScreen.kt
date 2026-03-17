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
import androidx.compose.material.icons.rounded.AutoAwesome
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
import coil.compose.AsyncImage
import androidx.compose.ui.draw.clip
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
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
fun HomeScreen(
    onPlayTheme: () -> Unit,
    onOpenPlaylist: (Long) -> Unit = {},
    onOpenAnime: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel()
) {
    val themes by viewModel.themes.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val quickPicks by viewModel.quickPicks.collectAsStateWithLifecycle()
    val topSongs by viewModel.topSongs.collectAsStateWithLifecycle()
    val playlists by viewModel.playlists.collectAsStateWithLifecycle()
    val playlistCoverUrls by viewModel.playlistCoverUrls.collectAsStateWithLifecycle()
    val selectedChip by viewModel.selectedChip.collectAsStateWithLifecycle()
    val background = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    val animeByThemesId = remember(anime) {
        anime.mapNotNull { entry -> entry.animeThemesId?.let { id -> id to entry } }.toMap()
    }

    var sheetTheme by remember { mutableStateOf<ThemeEntity?>(null) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
    val downloadedThemeIds by viewModel.downloadedThemeIds.collectAsStateWithLifecycle()
    val downloadingThemeIds by viewModel.downloadingThemeIds.collectAsStateWithLifecycle()
    val likedThemeIds by viewModel.likedThemeIds.collectAsStateWithLifecycle()
    val dislikedThemeIds by viewModel.dislikedThemeIds.collectAsStateWithLifecycle()

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
                SectionHeader(title = "Quick picks", action = "Play all")
            }

            if (quickPicks.isEmpty()) {
                item {
                    EmptyDataCard(
                        if (anime.isEmpty()) {
                            "Sync your library to see quick picks."
                        } else {
                            "No themes mapped yet. Try syncing again later."
                        }
                    )
                }
            } else {
                items(quickPicks) { theme ->
                    val animeEntry = animeByThemesId[theme.animeId]
                    val imageUrl = animeEntry?.coverUrl ?: animeEntry?.thumbnailUrl
                    QuickPickRow(
                        theme = theme, anime = animeEntry, imageUrl = imageUrl,
                        onPlay = {
                            viewModel.playFromQuickPicks(theme.id)
                            onPlayTheme()
                        },
                        onMoreOptions = { sheetTheme = theme }
                    )
                }
            }

            item {
                SectionHeader(title = "Your playlists", action = "See all")
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
                SectionHeader(title = "Top songs", action = "See all")
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
                items(topSongs) { theme ->
                    val animeEntry = animeByThemesId[theme.animeId]
                    val imageUrl = animeEntry?.coverUrl ?: animeEntry?.thumbnailUrl
                    QuickPickRow(
                        theme = theme, anime = animeEntry, imageUrl = imageUrl,
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
private fun SectionHeader(title: String, action: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom
    ) {
        Text(text = title, style = MaterialTheme.typography.titleLarge, color = Mist100)
        Text(text = action, style = MaterialTheme.typography.labelMedium, color = Mist200)
    }
}

@Composable
private fun FeaturedPlaylistRow(
    playlists: List<PlaylistWithCount>,
    coverUrlsMap: Map<Long, List<String>>,
    onOpenPlaylist: (Long) -> Unit
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        playlists.forEach { item ->
            FeaturedPlaylistCard(
                title = item.playlist.name,
                subtitle = "${item.trackCount} tracks",
                coverUrls = coverUrlsMap[item.playlist.id] ?: emptyList(),
                gradientSeed = item.playlist.gradientSeed,
                isAutoPlaylist = item.playlist.isAuto,
                onClick = { onOpenPlaylist(item.playlist.id) }
            )
        }
    }
}

@Composable
private fun FeaturedPlaylistCard(
    title: String,
    subtitle: String,
    coverUrls: List<String>,
    gradientSeed: Int,
    isAutoPlaylist: Boolean = false,
    onClick: () -> Unit = {}
) {
    Column(
        modifier = Modifier
            .width(160.dp)
            .background(Ink800.copy(alpha = 0.6f), RoundedCornerShape(18.dp))
            .border(1.dp, Mist200.copy(alpha = 0.2f), RoundedCornerShape(18.dp))
            .clickable { onClick() }
            .padding(12.dp)
    ) {
        PlaylistCoverArt(
            coverUrls = coverUrls,
            gradientSeed = gradientSeed,
            size = 136.dp,
            cornerRadius = 14.dp
        )
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = title,
            color = Mist100,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth()
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = subtitle, style = MaterialTheme.typography.labelMedium, color = Mist200)
            if (isAutoPlaylist) {
                Icon(
                    imageVector = Icons.Rounded.AutoAwesome,
                    contentDescription = "Auto Playlist",
                    tint = Mist200,
                    modifier = Modifier.size(14.dp)
                )
            }
        }
    }
}

@Composable
private fun QuickPickRow(theme: ThemeEntity, anime: AnimeEntity?, imageUrl: String?, onPlay: () -> Unit, onMoreOptions: () -> Unit = {}) {
    val info = theme.displayInfo(anime)
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
                color = Mist100,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
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
