package com.takeya.animeongaku.ui.library

import android.util.Log
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ArtistDao
import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.media.NowPlayingManager
import kotlinx.coroutines.launch
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

@HiltViewModel
class ArtistDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val themeDao: ThemeDao,
    private val animeDao: AnimeDao,
    private val artistDao: ArtistDao,
    artistImageDao: ArtistImageDao,
    playCountDao: PlayCountDao,
    private val playlistDao: PlaylistDao,
    private val animeRepository: AnimeRepository,
    val nowPlayingManager: NowPlayingManager,
    val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao,
    private val userPreferencesRepository: UserPreferencesRepository
) : ViewModel() {
    val artistName: String = savedStateHandle["artistName"] ?: ""

    // In-memory online data (NOT saved to DB until explicit "Add to Library")
    private val _onlineThemes = MutableStateFlow<List<ThemeEntity>>(emptyList())
    private val _onlineEntries = MutableStateFlow<List<AnimeThemeEntry>>(emptyList())
    private val _onlineAnimeMap = MutableStateFlow<Map<Long, AnimeEntity>>(emptyMap())

    private val localThemes: StateFlow<List<ThemeEntity>> = artistDao.observeThemesByArtist(artistName)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    // Always show the full online catalog when available, fall back to local
    val themes: StateFlow<List<ThemeEntity>> = combine(_onlineThemes, localThemes) { online, local ->
        if (online.isNotEmpty()) online else local
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    // Whether any songs are in the local library for this artist
    val isInLibrary: StateFlow<Boolean> = localThemes
        .map { it.isNotEmpty() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    // Set of theme IDs that are in the local library (for per-song indicators)
    val libraryThemeIds: StateFlow<Set<Long>> = localThemes
        .map { list -> list.map { it.id }.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val anime: StateFlow<List<AnimeEntity>> = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val artistImageUrl: StateFlow<String?> = artistImageDao.observeByNames(listOf(artistName))
        .map { images -> images.firstOrNull()?.imageUrl }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val topSongs: StateFlow<List<ThemeEntity>> = playCountDao.observeTopByArtist(artistName, 10)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val allSongsSorted: StateFlow<List<ThemeEntity>> = combine(topSongs, themes) { top, all ->
        if (top.isEmpty()) {
            all
        } else {
            val topIds = top.map { it.id }.toSet()
            top + all.filter { it.id !in topIds }.sortedBy { it.title?.lowercase() }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _fetchError = MutableStateFlow<String?>(null)
    val fetchError: StateFlow<String?> = _fetchError.asStateFlow()

    private var hasFetched = false

    init {
        // Always fetch the full online catalog
        fetchFromApi()
    }

    private fun fetchFromApi() {
        if (hasFetched) return
        hasFetched = true
        viewModelScope.launch {
            _isLoading.value = true
            _fetchError.value = null
            try {
                val slug = animeRepository.fetchArtistSlug(artistName)
                if (slug == null) {
                    if (localThemes.value.isEmpty()) {
                        _fetchError.value = "Artist not found online"
                    }
                    return@launch
                }
                val entries = animeRepository.fetchArtistSongs(slug)
                if (entries.isNotEmpty()) {
                    _onlineEntries.value = entries
                    _onlineThemes.value = entries.map { entryToThemeEntity(it) }
                    // Build temporary AnimeEntity map for display
                    val tempAnimeMap = entries.groupBy { it.animeId }.mapNotNull { (animeId, group) ->
                        val atId = animeId.toLongOrNull() ?: return@mapNotNull null
                        val first = group.first()
                        val kitsuId = first.kitsuId ?: "online-$animeId"
                        atId to AnimeEntity(
                            kitsuId = kitsuId,
                            animeThemesId = atId,
                            title = first.animeNameEn ?: first.animeName ?: "Unknown",
                            titleEn = first.animeNameEn,
                            thumbnailUrl = first.coverUrl,
                            coverUrl = first.coverUrl,
                            syncedAt = System.currentTimeMillis()
                        )
                    }.toMap()
                    _onlineAnimeMap.value = tempAnimeMap
                } else if (localThemes.value.isEmpty()) {
                    _fetchError.value = "No songs found online"
                }
            } catch (e: Exception) {
                Log.e("ArtistDetailVM", "fetchFromApi failed", e)
                if (localThemes.value.isEmpty()) {
                    _fetchError.value = "Failed to load: ${e.message}"
                }
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun saveSongToLibrary(themeId: Long) {
        viewModelScope.launch {
            val entry = _onlineEntries.value.firstOrNull {
                entryToThemeEntity(it).id == themeId
            } ?: return@launch
            val entity = entryToThemeEntity(entry)
            themeDao.upsertAll(listOf(entity))
            // Save the anime entity so the theme has a parent (marked as manually added)
            val atId = entry.animeId.toLongOrNull()
            if (atId != null) {
                val animeEntity = _onlineAnimeMap.value[atId]
                if (animeEntity != null) {
                    animeDao.upsertAll(listOf(animeEntity.copy(isManuallyAdded = true)))
                }
            }
            // Save artist cross-refs
            if (entry.artists.isNotEmpty()) {
                val crossRefs = entry.artists.map { credit ->
                    ThemeArtistCrossRef(
                        themeId = entity.id,
                        artistName = credit.name,
                        asCharacter = credit.asCharacter,
                        alias = credit.alias
                    )
                }
                artistDao.upsertCrossRefs(crossRefs)
            }
        }
    }

    private fun buildAnimeMap(): Map<Long, AnimeEntity> {
        val localMap = anime.value.mapNotNull { entry ->
            entry.animeThemesId?.let { id -> id to entry }
        }.toMap()
        // Merge with online anime map for display
        return _onlineAnimeMap.value + localMap
    }

    fun playTheme(themeId: Long) {
        val list = allSongsSorted.value.ifEmpty { themes.value }
        val idx = list.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play(artistName, list, idx, animeMap = buildAnimeMap())
    }

    fun playAll() {
        val list = allSongsSorted.value.ifEmpty { themes.value }
        if (list.isNotEmpty()) nowPlayingManager.play(artistName, list, 0, animeMap = buildAnimeMap())
    }

    fun shuffleAll() {
        val list = allSongsSorted.value.ifEmpty { themes.value }
        if (list.isNotEmpty()) nowPlayingManager.play(artistName, list, 0, shuffle = true, animeMap = buildAnimeMap())
    }

    val playlists: StateFlow<List<PlaylistWithCount>> = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val playlistCoverUrls: StateFlow<Map<Long, List<String>>> = playlistDao.observeAllPlaylistCoverUrls()
        .map { rows -> rows.groupBy { it.playlistId }.mapValues { (_, list) -> list.map { it.coverUrl }.take(4) } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    fun addToPlaylist(playlistId: Long, themeIds: List<Long>) {
        viewModelScope.launch {
            val count = playlistDao.countEntries(playlistId)
            val entries = themeIds.mapIndexed { i, id ->
                PlaylistEntryEntity(playlistId = playlistId, themeId = id, orderIndex = count + i)
            }
            playlistDao.insertEntries(entries)
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

    fun toggleLike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleLike(themeId) }
    }

    fun toggleDislike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleDislike(themeId) }
    }

    fun downloadSong(theme: ThemeEntity) {
        val animeEntry = theme.animeId?.let { id -> buildAnimeMap()[id] }
        downloadManager.downloadSong(theme, animeEntry)
    }

    fun removeDownload(themeId: Long) {
        downloadManager.removeDownload(themeId)
    }

    fun createAndAddToPlaylist(name: String, themeIds: List<Long>) {
        viewModelScope.launch {
            val playlistId = playlistDao.insertPlaylist(
                PlaylistEntity(name = name, createdAt = System.currentTimeMillis())
            )
            val entries = themeIds.mapIndexed { i, id ->
                PlaylistEntryEntity(playlistId = playlistId, themeId = id, orderIndex = i)
            }
            playlistDao.insertEntries(entries)
        }
    }
}
