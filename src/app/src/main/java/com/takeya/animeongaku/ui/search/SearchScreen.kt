package com.takeya.animeongaku.ui.search

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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.TravelExplore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ArtistTrackCount
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.common.FallbackAsyncImage
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.OnlineAnimeResult
import com.takeya.animeongaku.data.model.OnlineArtistResult
import com.takeya.animeongaku.data.repository.RelatedRelease
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.common.preferredModeForThemeAction
import com.takeya.animeongaku.ui.common.themeModePreferenceAction
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import com.takeya.animeongaku.ui.common.BrowseVideoWarningDialog
import com.takeya.animeongaku.ui.common.PlaylistCoverArt
import com.takeya.animeongaku.ui.common.PlaylistPickerSheet
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.common.themeDisplayInfo
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun SearchScreen(
    onPlayTheme: () -> Unit = {},
    onOpenAnime: (String) -> Unit = {},
    onOpenArtist: (String) -> Unit = {},
    onOpenPlaylist: (Long) -> Unit = {},
    onOpenRelatedMusic: (String, Long?) -> Unit = { _, _ -> },
    viewModel: SearchViewModel = hiltViewModel()
) {
    val queryText by viewModel.query.collectAsStateWithLifecycle()
    var textFieldValue by remember {
        mutableStateOf(TextFieldValue(queryText, TextRange(queryText.length)))
    }
    val query = textFieldValue.text
    val localSongs by viewModel.localSongs.collectAsStateWithLifecycle()
    val localAnime by viewModel.localAnime.collectAsStateWithLifecycle()
    val localArtists by viewModel.localArtists.collectAsStateWithLifecycle()
    val localPlaylists by viewModel.localPlaylists.collectAsStateWithLifecycle()
    val onlineResults by viewModel.onlineResults.collectAsStateWithLifecycle()
    val onlineAnime by viewModel.onlineAnime.collectAsStateWithLifecycle()
    val onlineArtists by viewModel.onlineArtists.collectAsStateWithLifecycle()
    val localMusic by viewModel.localMusic.collectAsStateWithLifecycle()
    val onlineMusic by viewModel.onlineMusic.collectAsStateWithLifecycle()
    val onlineState by viewModel.onlineState.collectAsStateWithLifecycle()
    val onlineError by viewModel.onlineError.collectAsStateWithLifecycle()
    val onlineEnabled by viewModel.onlineEnabled.collectAsStateWithLifecycle()
    val allAnime by viewModel.anime.collectAsStateWithLifecycle()
    val allPlaylists by viewModel.playlists.collectAsStateWithLifecycle()
    val playlistCoverUrls by viewModel.playlistCoverUrls.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()
    val themeModesById by viewModel.themeModesById.collectAsStateWithLifecycle()
    val musicReleases = remember(localMusic, onlineMusic) {
        (onlineMusic.releases + localMusic.releases).distinctBy { it.owner.kitsuId to it.release.id }
    }
    val musicTracks = remember(localMusic, onlineMusic) {
        (onlineMusic.tracks + localMusic.tracks).distinctBy { Triple(it.owner.kitsuId, it.release.id, it.song.id) }
    }

    val animeByThemesId = remember(allAnime) {
        allAnime.mapNotNull { entry -> entry.animeThemesId?.let { id -> id to entry } }.toMap()
    }

    var sheetTheme by remember { mutableStateOf<ThemeEntity?>(null) }
    var sheetOnlineEntry by remember { mutableStateOf<AnimeThemeEntry?>(null) }
    var pickerThemeIds by remember { mutableStateOf<List<Long>?>(null) }
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

    // Song ActionSheet (local)
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
            onReplaceQueue = {
                viewModel.nowPlayingManager.play(
                    "Now Playing", listOf(theme), 0,
                    animeMap = sheetAnime?.let { a -> theme.animeId?.let { mapOf(it to a) } } ?: emptyMap()
                )
            },
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

    // Online song ActionSheet
    sheetOnlineEntry?.let { entry ->
        val themeId = entry.themeId.toLongOrNull()
        val info = themeDisplayInfo(
            title = entry.title,
            artistName = entry.artist,
            themeType = entry.themeType,
            animeName = entry.animeName
        )
        val preference by remember(themeId) {
            viewModel.observePreference(themeId)
        }.collectAsStateWithLifecycle(initialValue = null)
        ActionSheet(
            config = ActionSheetConfig(
                title = info.primaryText,
                subtitle = info.secondaryText,
                showAddToLibrary = true,
                showGoToArtist = !entry.artist.isNullOrBlank(),
                showGoToAnime = entry.kitsuId != null,
                showLike = true,
                isLiked = preference?.isLiked == true,
                showRemoveDislike = preference?.isDisliked == true,
                artistName = entry.artist?.split(",")?.firstOrNull()?.trim(),
                animeName = entry.animeNameEn ?: entry.animeName,
                customActions = listOfNotNull(themeModePreferenceAction(
                    themeId?.let { themeModesById[it]?.fullSizeUrl?.isNotBlank() }, preference?.preferredMode
                ))
            ),
            onDismiss = { sheetOnlineEntry = null },
            onPlayNext = {
                viewModel.saveOnlineThemePlayNext(entry)
            },
            onAddToQueue = {
                viewModel.saveOnlineThemeAddToQueue(entry)
            },
            onReplaceQueue = {
                viewModel.saveAndPlayOnlineTheme(entry)
                onPlayTheme()
            },
            onSaveToPlaylist = {
                viewModel.addOnlineThemeToLibrary(entry)
                val themeId = entry.themeId.toLongOrNull()
                    ?: kotlin.math.abs(entry.themeId.hashCode()).toLong()
                pickerThemeIds = listOf(themeId)
            },
            onAddToLibrary = {
                viewModel.addOnlineThemeToLibrary(entry)
            },
            onGoToArtist = {
                entry.artist?.split(",")?.firstOrNull()?.trim()?.let { onOpenArtist(it) }
            },
            onGoToAnime = {
                entry.kitsuId?.let { onOpenAnime(it) }
            },
            onLike = { themeId?.let { viewModel.toggleLike(it) } },
            onRemoveDislike = { themeId?.let { viewModel.toggleDislike(it) } },
            onCustomAction = { key ->
                val mode = preferredModeForThemeAction(key)
                if (themeId != null && mode != null) viewModel.setPreferredMode(themeId, mode)
            }
        )
    }

    // Playlist picker
    pickerThemeIds?.let { ids ->
        PlaylistPickerSheet(
            playlists = allPlaylists,
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

    val background = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                Text(
                    text = "Search",
                    style = MaterialTheme.typography.titleLarge,
                    color = Mist100
                )
            }

            item {
                SearchBar(
                    value = textFieldValue,
                    onValueChange = {
                        val textChanged = it.text != textFieldValue.text
                        textFieldValue = it
                        if (textChanged) viewModel.onQueryChange(it.text)
                    }
                )
            }

            if (query.isBlank()) {
                item {
                    Text(
                        text = "Search your library for songs, anime, artists, and playlists.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Mist200,
                        modifier = Modifier.padding(vertical = 16.dp)
                    )
                }
            } else {
                // Local Songs
                if (localSongs.isNotEmpty()) {
                    item {
                        SectionHeader("Songs")
                    }
                    val displaySongs = localSongs.take(5)
                    items(displaySongs, key = { "song-${it.id}" }) { theme ->
                        val animeEntry = theme.animeId?.let { animeByThemesId[it] }
                        LocalSongRow(
                            theme = theme,
                            anime = animeEntry,
                            onPlay = {
                                viewModel.playLocalSong(theme.id)
                                onPlayTheme()
                            },
                            onMore = { sheetTheme = theme }
                        )
                    }
                    if (localSongs.size > 5) {
                        item {
                            Text(
                                text = "${localSongs.size - 5} more songs…",
                                style = MaterialTheme.typography.labelSmall,
                                color = Mist200,
                                modifier = Modifier.padding(start = 4.dp, bottom = 4.dp)
                            )
                        }
                    }
                }

                if (musicReleases.isNotEmpty()) {
                    item { SectionHeader("Releases") }
                    items(musicReleases.take(8), key = { "release-${it.owner.kitsuId}-${it.release.id}" }) { release ->
                        MusicReleaseResultRow(release) { onOpenRelatedMusic(release.owner.kitsuId, release.release.id) }
                    }
                }

                if (musicTracks.isNotEmpty()) {
                    item { SectionHeader("Tracks") }
                    items(musicTracks.take(12), key = { "track-${it.owner.kitsuId}-${it.release.id}-${it.song.id}" }) { track ->
                        MusicTrackResultRow(track) { onOpenRelatedMusic(track.owner.kitsuId, track.release.id) }
                    }
                }

                // Local Anime
                if (localAnime.isNotEmpty()) {
                    item {
                        SectionHeader("Anime")
                    }
                    item {
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            contentPadding = PaddingValues(horizontal = 0.dp)
                        ) {
                            items(localAnime.take(10), key = { "anime-${it.kitsuId}" }) { anime ->
                                AnimeCard(anime = anime, onClick = { onOpenAnime(anime.kitsuId) })
                            }
                        }
                    }
                }

                // Local Artists
                if (localArtists.isNotEmpty()) {
                    item {
                        SectionHeader("Artists")
                    }
                    item {
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            contentPadding = PaddingValues(horizontal = 0.dp)
                        ) {
                            items(localArtists.take(10), key = { "artist-${it.artistName}" }) { artist ->
                                ArtistChip(artist = artist, onClick = { onOpenArtist(artist.artistName) })
                            }
                        }
                    }
                }

                // Local Playlists
                if (localPlaylists.isNotEmpty()) {
                    item {
                        SectionHeader("Playlists")
                    }
                    items(localPlaylists.take(5), key = { "playlist-${it.playlist.id}" }) { playlist ->
                        PlaylistRow(
                            playlist = playlist,
                            coverUrls = playlistCoverUrls[playlist.playlist.id] ?: emptyList(),
                            onClick = { onOpenPlaylist(playlist.playlist.id) }
                        )
                    }
                }

                // Online search button
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    OnlineSearchButton(
                        state = onlineState,
                        enabled = onlineEnabled,
                        onClick = { viewModel.searchOnline() }
                    )
                }

                // Online error / reconnect prompt
                if (!onlineEnabled) {
                    item {
                        Text(
                            text = "Reconnect to search online.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Mist200,
                            modifier = Modifier.padding(vertical = 4.dp)
                        )
                    }
                } else {
                    onlineError?.let { error ->
                        item {
                            Text(
                                text = error,
                                style = MaterialTheme.typography.bodySmall,
                                color = Rose500,
                                modifier = Modifier.padding(vertical = 4.dp)
                            )
                        }
                    }
                }

                // Online results — Anime (featured at top)
                if (onlineAnime.isNotEmpty()) {
                    item {
                        SectionHeader("Anime")
                    }
                    item {
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            contentPadding = PaddingValues(horizontal = 0.dp)
                        ) {
                            items(onlineAnime, key = { "online-anime-${it.animeThemesId}" }) { anime ->
                                OnlineAnimeCard(
                                    anime = anime,
                                    onClick = { anime.kitsuId?.let { onOpenAnime(it) } }
                                )
                            }
                        }
                    }
                }

                // Online results — Artists (featured at top)
                if (onlineArtists.isNotEmpty()) {
                    item {
                        SectionHeader("Artists")
                    }
                    item {
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            contentPadding = PaddingValues(horizontal = 0.dp)
                        ) {
                            items(onlineArtists, key = { "online-artist-${it.id}" }) { artist ->
                                OnlineArtistChip(
                                    artist = artist,
                                    onClick = { onOpenArtist(artist.name) }
                                )
                            }
                        }
                    }
                }

                // Online results — Songs
                if (onlineResults.isNotEmpty()) {
                    item {
                        SectionHeader("Songs")
                    }
                    items(onlineResults, key = { "online-${it.themeId}" }) { entry ->
                        OnlineResultRow(
                            entry = entry,
                            onPlay = {
                                viewModel.saveAndPlayOnlineTheme(entry)
                                onPlayTheme()
                            },
                            onMore = { sheetOnlineEntry = entry }
                        )
                    }
                }
            }

            item {
                Spacer(modifier = Modifier.height(80.dp))
            }
        }
    }
}

@Composable
private fun SearchBar(value: TextFieldValue, onValueChange: (TextFieldValue) -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    TextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape),
        placeholder = { Text("Songs, anime, artists…", color = Mist200) },
        leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null, tint = Mist200) },
        trailingIcon = {
            if (value.text.isNotBlank()) {
                IconButton(onClick = { onValueChange(TextFieldValue("")) }) {
                    Icon(Icons.Rounded.Close, contentDescription = "Clear", tint = Mist200)
                }
            }
        },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions.Default,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.Transparent,
            unfocusedContainerColor = Color.Transparent,
            focusedTextColor = Mist100,
            unfocusedTextColor = Mist100,
            cursorColor = Rose500,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent
        )
    )
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = Mist100,
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
    )
}

@Composable
private fun MusicReleaseResultRow(release: RelatedRelease, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        FallbackAsyncImage(listOfNotNull(release.release.artworkUrl, release.owner.artworkUrl), release.release.title, Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)))
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(release.release.title, color = Mist100, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(release.release.artistCredit.takeIf(String::isNotBlank), release.owner.title).joinToString(" · "), color = Mist200, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun MusicTrackResultRow(track: RelatedTrack, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        FallbackAsyncImage(listOfNotNull(track.release.artworkUrl, track.owner.artworkUrl), track.song.title, Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)))
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(track.song.title, color = Mist100, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(track.owner.title, track.release.title).joinToString(" · "), color = Mist200, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun LocalSongRow(
    theme: ThemeEntity,
    anime: AnimeEntity?,
    onPlay: () -> Unit,
    onMore: () -> Unit
) {
    val info = theme.displayInfo(anime)
    val imageUrls = anime?.primaryArtworkUrls() ?: emptyList()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable { onPlay() }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Ember400.copy(alpha = 0.2f))
        ) {
            if (imageUrls.isNotEmpty()) {
                FallbackAsyncImage(
                    urls = imageUrls,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = info.primaryText,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = info.secondaryText,
                style = MaterialTheme.typography.labelSmall,
                color = Mist200,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        IconButton(onClick = onMore, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Rounded.MoreVert, contentDescription = "More", tint = Mist200, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun AnimeCard(anime: AnimeEntity, onClick: () -> Unit) {
    val coverUrls = anime.primaryArtworkUrls()
    Column(
        modifier = Modifier
            .width(100.dp)
            .clickable { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(100.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Ink800)
        ) {
            if (coverUrls.isNotEmpty()) {
                FallbackAsyncImage(
                    urls = coverUrls,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize()
                )
            }
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = anime.title ?: "Unknown",
            style = MaterialTheme.typography.labelSmall,
            color = Mist100,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun ArtistChip(artist: ArtistTrackCount, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .width(80.dp)
            .clickable { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(CircleShape)
                .background(
                    Brush.linearGradient(listOf(Rose500.copy(alpha = 0.3f), Ink800)),
                    CircleShape
                )
                .border(1.dp, Mist200.copy(alpha = 0.15f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = artist.artistName.take(2).uppercase(),
                style = MaterialTheme.typography.titleSmall,
                color = Mist100.copy(alpha = 0.7f)
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = artist.artistName,
            style = MaterialTheme.typography.labelSmall,
            color = Mist100,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun PlaylistRow(playlist: PlaylistWithCount, coverUrls: List<List<String>>, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable { onClick() }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        PlaylistCoverArt(
            coverUrlGroups = coverUrls,
            gradientSeed = playlist.playlist.gradientSeed,
            size = 44.dp,
            cornerRadius = 8.dp
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = playlist.playlist.name,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "${playlist.trackCount} tracks",
                style = MaterialTheme.typography.labelSmall,
                color = Mist200
            )
        }
    }
}

@Composable
private fun OnlineSearchButton(state: OnlineSearchState, enabled: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(24.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Ink800.copy(alpha = 0.6f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape)
            .clickable(enabled = enabled && state != OnlineSearchState.Loading) { onClick() }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center
    ) {
        when {
            !enabled -> {
                Icon(Icons.Rounded.TravelExplore, contentDescription = null, tint = Mist200.copy(alpha = 0.5f), modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.width(10.dp))
                Text("Reconnect to search online", style = MaterialTheme.typography.bodyMedium, color = Mist200.copy(alpha = 0.5f))
            }
            state == OnlineSearchState.Loading -> {
                CircularProgressIndicator(
                    color = Rose500,
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text("Searching online…", style = MaterialTheme.typography.bodyMedium, color = Mist200)
            }
            state == OnlineSearchState.Done -> {
                Icon(Icons.Rounded.TravelExplore, contentDescription = null, tint = Mist200, modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.width(10.dp))
                Text("Search online again", style = MaterialTheme.typography.bodyMedium, color = Mist200)
            }
            else -> {
                Icon(Icons.Rounded.TravelExplore, contentDescription = null, tint = Rose500, modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.width(10.dp))
                Text("Search online", style = MaterialTheme.typography.bodyMedium, color = Mist100)
            }
        }
    }
}

@Composable
private fun OnlineResultRow(entry: AnimeThemeEntry, onPlay: () -> Unit, onMore: () -> Unit) {
    val displayName = entry.animeNameEn ?: entry.animeName
    val info = themeDisplayInfo(
        title = entry.title,
        artistName = entry.artist,
        themeType = entry.themeType,
        animeName = displayName
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable { onPlay() }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Rose500.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center
        ) {
            if (!entry.coverUrl.isNullOrBlank()) {
                AsyncImage(
                    model = entry.coverUrl,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop
                )
            } else {
                Icon(Icons.Rounded.TravelExplore, contentDescription = null, tint = Rose500, modifier = Modifier.size(20.dp))
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = info.primaryText,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = info.secondaryText,
                style = MaterialTheme.typography.labelSmall,
                color = Mist200,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        IconButton(onClick = onMore, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Rounded.MoreVert, contentDescription = "More", tint = Mist200, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun OnlineAnimeCard(anime: OnlineAnimeResult, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .width(100.dp)
            .clickable { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(100.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Ink800)
        ) {
            if (!anime.coverUrl.isNullOrBlank()) {
                AsyncImage(
                    model = anime.coverUrl,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = anime.nameEn ?: anime.name,
            style = MaterialTheme.typography.labelSmall,
            color = Mist100,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
        Text(
            text = "${anime.themeCount} themes",
            style = MaterialTheme.typography.labelSmall,
            color = Mist200,
            maxLines = 1,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun OnlineArtistChip(artist: OnlineArtistResult, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .width(80.dp)
            .clickable { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(CircleShape)
                .background(
                    Brush.linearGradient(listOf(Rose500.copy(alpha = 0.3f), Ink800)),
                    CircleShape
                )
                .border(1.dp, Mist200.copy(alpha = 0.15f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (!artist.imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = artist.imageUrl,
                    contentDescription = artist.name,
                    modifier = Modifier.matchParentSize().clip(CircleShape),
                    contentScale = ContentScale.Crop
                )
            } else {
                Text(
                    text = artist.name.take(2).uppercase(),
                    style = MaterialTheme.typography.titleSmall,
                    color = Mist100.copy(alpha = 0.7f)
                )
            }
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = artist.name,
            style = MaterialTheme.typography.labelSmall,
            color = Mist100,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
    }
}
