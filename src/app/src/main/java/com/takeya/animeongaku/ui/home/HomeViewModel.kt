package com.takeya.animeongaku.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.data.repository.MusicCatalogRepository
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.data.repository.ServerPlaylistWriter
import com.takeya.animeongaku.data.repository.PlaylistWriteItem
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackPreferences
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import com.takeya.animeongaku.data.local.DownloadDao
import kotlinx.coroutines.ExperimentalCoroutinesApi

data class HomeQuickPick(
    val item: PlayableItem,
    val relatedTrack: RelatedTrack? = null
) {
    val stableKey: String = "${item.key.kind}:${item.key.id}"
}

internal fun eligibleHomeRelatedTracks(
    tracks: List<RelatedTrack>,
    preferences: List<SongPreferenceEntity>,
    showOstsOnHome: Boolean,
    fullSizeSongIds: Set<Long>
): List<RelatedTrack> {
    val activePreferences = preferences.filter { it.deletedAt == null }.associateBy { it.songId }
    return tracks.asSequence()
        .filter { it.song.audioUrl.isNotBlank() }
        .filterNot { it.song.id in fullSizeSongIds }
        .filter { track ->
            val preference = activePreferences[track.song.id]
            !preference?.isDisliked.orFalse() && if (track.relationshipType == "SOUNDTRACK") {
                showOstsOnHome
            } else {
                preference?.isLiked == true
            }
        }
        .distinctBy { it.song.id }
        .toList()
}

private fun Boolean?.orFalse(): Boolean = this == true

internal fun assembleHomeQuickPicks(
    themes: List<PlayableItem.Theme>,
    relatedTracks: List<RelatedTrack>,
    likedThemeIds: Set<Long>,
    selectedChip: String? = null,
    limit: Int = 6
): List<HomeQuickPick> {
    val themePicks = themes.sortedByDescending { it.theme.id in likedThemeIds }.map { HomeQuickPick(it) }
    val relatedPicks = relatedTracks.takeIf { selectedChip == null }.orEmpty().map { track ->
        HomeQuickPick(
            PlayableItem.RelatedSong(
                song = track.song,
                release = track.release,
                anime = track.asAnimeEntity(),
                relationshipType = track.relationshipType
            ),
            track
        )
    }
    val mixed = ArrayList<HomeQuickPick>(limit)
    var themeIndex = 0
    var relatedIndex = 0
    while (mixed.size < limit && (themeIndex < themePicks.size || relatedIndex < relatedPicks.size)) {
        if (themeIndex < themePicks.size) mixed += themePicks[themeIndex++]
        if (mixed.size < limit && relatedIndex < relatedPicks.size) mixed += relatedPicks[relatedIndex++]
    }
    return mixed
}

internal fun filterHomeThemes(themes: List<ThemeEntity>, selectedChip: String?): List<ThemeEntity> =
    when (selectedChip) {
        "OPs" -> themes.filter { it.themeType?.trim()?.startsWith("OP", ignoreCase = true) == true }
        "EDs" -> themes.filter { it.themeType?.trim()?.startsWith("ED", ignoreCase = true) == true }
        else -> themes
    }

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class HomeViewModel @Inject constructor(
    animeDao: AnimeDao,
    themeDao: ThemeDao,
    private val themeModeDao: ThemeModeDao,
    private val playlistDao: PlaylistDao,
    val nowPlayingManager: NowPlayingManager,
    val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao,
    private val serverPlaylistWriter: ServerPlaylistWriter,
    private val userPreferencesRepository: UserPreferencesRepository,
    musicCatalogRepository: MusicCatalogRepository,
    playbackPreferences: PlaybackPreferences,
    connectivityMonitor: ConnectivityMonitor
) : ViewModel() {
    val isOnline: StateFlow<Boolean> = connectivityMonitor.isOnline
    private val allThemes: StateFlow<List<ThemeEntity>> = themeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val anime: StateFlow<List<AnimeEntity>> = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val playlists: StateFlow<List<PlaylistWithCount>> = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val playlistCoverUrls: StateFlow<Map<Long, List<List<String>>>> = playlistDao.observeAllPlaylistCoverUrls()
        .map { rows ->
            rows.groupBy { it.playlistId }.mapValues { (_, list) ->
                list.take(4).map { row ->
                    listOfNotNull(
                        row.coverUrl?.takeIf { it.isNotBlank() },
                        row.thumbnailUrl?.takeIf { it.isNotBlank() }
                    )
                }
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    private val _selectedChip = MutableStateFlow<String?>(null)
    val selectedChip: StateFlow<String?> = _selectedChip.asStateFlow()

    val themes: StateFlow<List<ThemeEntity>> = combine(allThemes, _selectedChip) { themes, chip ->
        filterHomeThemes(themes, chip)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val themeModesById: StateFlow<Map<Long, ThemeModeEntity>> = allThemes
        .flatMapLatest { list ->
            val ids = list.map { it.id }
            if (ids.isEmpty()) flowOf(emptyList()) else themeModeDao.observeByThemeIds(ids)
        }
        .map { modes -> modes.associateBy { it.themeId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    // Shuffle once per themes emission so the order is stable across liked/download state changes
    private val shuffledThemes: StateFlow<List<ThemeEntity>> = themes
        .map { it.shuffled() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val eligibleRelatedTracks = combine(
        musicCatalogRepository.observeHomeTracks(),
        userPreferencesRepository.observeSongPreferences(),
        playbackPreferences.showOstsOnHomeFlow,
        themeModesById
    ) { tracks, preferences, showOsts, modes ->
        eligibleHomeRelatedTracks(
            tracks,
            preferences,
            showOsts,
            modes.values.mapNotNull { it.fullSizeSongId }.toSet()
        )
    }

    private val chipAwareRelatedTracks = combine(eligibleRelatedTracks, _selectedChip) { related, chip ->
        related to chip
    }

    val quickPicks: StateFlow<List<HomeQuickPick>> = combine(
        shuffledThemes,
        userPreferencesRepository.observeLikedThemeIds(),
        anime,
        themeModesById,
        chipAwareRelatedTracks
    ) { themeList, likedIds, animeList, modes, relatedAndChip ->
        val (related, chip) = relatedAndChip
        val animeById = animeList.mapNotNull { owner -> owner.animeThemesId?.let { it to owner } }.toMap()
        val themeItems = themeList.map { theme ->
            PlayableItem.Theme(theme, theme.animeId?.let(animeById::get), modes[theme.id])
        }
        assembleHomeQuickPicks(themeItems, related, likedIds.toSet(), selectedChip = chip)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val topSongs: StateFlow<List<ThemeEntity>> = combine(shuffledThemes, userPreferencesRepository.observeLikedThemeIds()) { list, likedIds ->
        list.sortedByDescending { if (it.id in likedIds) 1 else 0 }
            .take(10)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun selectChip(chip: String?) {
        _selectedChip.value = if (_selectedChip.value == chip) null else chip
    }

    private fun buildAnimeMap(): Map<Long, AnimeEntity> {
        return anime.value.mapNotNull { entry ->
            entry.animeThemesId?.let { id -> id to entry }
        }.toMap()
    }

    fun playFromQuickPicks(stableKey: String) {
        val picks = quickPicks.value
        val idx = picks.indexOfFirst { it.stableKey == stableKey }.coerceAtLeast(0)
        nowPlayingManager.playItems("Quick Picks", picks.map { it.item }, idx)
    }

    fun playAllQuickPicks() {
        val picks = quickPicks.value
        if (picks.isNotEmpty()) nowPlayingManager.playItems("Quick Picks", picks.map { it.item })
    }

    fun playNext(item: PlayableItem) = nowPlayingManager.playNextItems(listOf(item))

    fun addToQueue(item: PlayableItem) = nowPlayingManager.addPlayableItems(listOf(item))

    fun replaceQueue(item: PlayableItem) = nowPlayingManager.playItems("Now Playing", listOf(item))

    fun playFromTopSongs(themeId: Long) {
        val songs = topSongs.value
        val idx = songs.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play("Top Songs", songs, idx, animeMap = buildAnimeMap())
    }

    fun requestPlayVideo(themeId: Long): BrowseVideoStartRequest? {
        val theme = allThemes.value.firstOrNull { it.id == themeId } ?: return null
        return BrowseVideoActionPolicy.request(
            isOnline.value,
            "Now Playing",
            listOf(theme),
            themeModesById.value,
            singleAnimeMap(theme)
        )
    }

    fun startPlayVideo(request: BrowseVideoStartRequest): Boolean {
        val themeId = request.themes.singleOrNull()?.id ?: return false
        val currentTheme = allThemes.value.firstOrNull { it.id == themeId } ?: return false
        return request.startIfStillValid(
            nowPlayingManager,
            isOnline.value,
            listOf(currentTheme),
            themeModesById.value,
            "Now Playing",
            singleAnimeMap(currentTheme)
        )
    }

    private fun singleAnimeMap(theme: ThemeEntity): Map<Long, AnimeEntity> =
        theme.animeId?.let { id -> buildAnimeMap()[id]?.let { mapOf(id to it) } } ?: emptyMap()

    fun addToPlaylist(playlistId: Long, themeIds: List<Long>, modeOverride: String? = null) {
        viewModelScope.launch {
            serverPlaylistWriter.addThemeEntries(playlistId, themeIds, modeOverride)
        }
    }

    val downloadedThemeIds: StateFlow<Set<Long>> = themeDao.observeDownloadedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val downloadingThemeIds: StateFlow<Set<Long>> = downloadDao.observeDownloadingThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val likedThemeIds: StateFlow<Set<Long>> = userPreferencesRepository.observeLikedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val dislikedThemeIds: StateFlow<Set<Long>> = userPreferencesRepository.observeDislikedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    fun observePreference(themeId: Long?) =
        themeId?.let { userPreferencesRepository.observePreference(it) } ?: flowOf(null)

    fun toggleLike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleLike(themeId) }
    }

    fun toggleDislike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleDislike(themeId) }
    }

    fun addSongToPlaylist(playlistId: Long, songId: Long) {
        viewModelScope.launch {
            serverPlaylistWriter.addItems(playlistId, listOf(PlaylistWriteItem(
                itemType = PlaylistEntryEntity.ITEM_TYPE_SONG,
                itemId = songId
            )))
        }
    }

    fun observeSongPreference(songId: Long) = userPreferencesRepository.observeSongPreference(songId)

    fun toggleSongLike(songId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleSongLike(songId) }
    }

    fun toggleSongDislike(songId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleSongDislike(songId) }
    }

    fun downloadRelated(track: RelatedTrack) = downloadManager.downloadRelatedSong(track.song, track.release)

    fun downloadSong(theme: ThemeEntity) {
        val animeEntry = theme.animeId?.let { id -> buildAnimeMap()[id] }
        downloadManager.downloadSong(theme, animeEntry)
    }

    fun removeDownload(themeId: Long) {
        downloadManager.removeDownload(themeId)
    }

    fun createAndAddToPlaylist(name: String, themeIds: List<Long>, modeOverride: String? = null) {
        viewModelScope.launch {
            serverPlaylistWriter.createPlaylistWithThemes(name, themeIds, modeOverride)
        }
    }


    fun createAndAddSongToPlaylist(name: String, songId: Long) {
        viewModelScope.launch {
            serverPlaylistWriter.createPlaylistWithItems(name, listOf(PlaylistWriteItem(
                itemType = PlaylistEntryEntity.ITEM_TYPE_SONG,
                itemId = songId
            )))
        }
    }
}
