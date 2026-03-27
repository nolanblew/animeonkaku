package com.takeya.animeongaku.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ArtistDao
import com.takeya.animeongaku.data.local.ArtistTrackCount
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.OnlineAnimeResult
import com.takeya.animeongaku.data.model.OnlineArtistResult
import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.UserRepository
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.media.NowPlayingManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.math.abs
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class OnlineSearchState { Idle, Loading, Done, Error }

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val themeDao: ThemeDao,
    private val animeDao: AnimeDao,
    private val artistDao: ArtistDao,
    private val playlistDao: PlaylistDao,
    private val animeRepository: AnimeRepository,
    private val userRepository: UserRepository,
    val nowPlayingManager: NowPlayingManager,
    val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao,
    private val userPreferencesRepository: UserPreferencesRepository
) : ViewModel() {

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    val localSongs: StateFlow<List<ThemeEntity>> = _query
        .flatMapLatest { q ->
            if (q.isBlank()) flowOf(emptyList()) else themeDao.searchThemes(q)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val localAnime: StateFlow<List<AnimeEntity>> = _query
        .flatMapLatest { q ->
            if (q.isBlank()) flowOf(emptyList()) else animeDao.searchAnime(q)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val localArtists: StateFlow<List<ArtistTrackCount>> = _query
        .flatMapLatest { q ->
            if (q.isBlank()) flowOf(emptyList()) else artistDao.searchArtists(q)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val localPlaylists: StateFlow<List<PlaylistWithCount>> = _query
        .flatMapLatest { q ->
            if (q.isBlank()) flowOf(emptyList()) else playlistDao.searchPlaylists(q)
        }
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

    private val _onlineResults = MutableStateFlow<List<AnimeThemeEntry>>(emptyList())
    val onlineResults: StateFlow<List<AnimeThemeEntry>> = _onlineResults.asStateFlow()

    private val _onlineAnime = MutableStateFlow<List<OnlineAnimeResult>>(emptyList())
    val onlineAnime: StateFlow<List<OnlineAnimeResult>> = _onlineAnime.asStateFlow()

    private val _onlineArtists = MutableStateFlow<List<OnlineArtistResult>>(emptyList())
    val onlineArtists: StateFlow<List<OnlineArtistResult>> = _onlineArtists.asStateFlow()

    private val _onlineState = MutableStateFlow(OnlineSearchState.Idle)
    val onlineState: StateFlow<OnlineSearchState> = _onlineState.asStateFlow()

    private val _onlineError = MutableStateFlow<String?>(null)
    val onlineError: StateFlow<String?> = _onlineError.asStateFlow()

    private var onlineJob: Job? = null

    fun onQueryChange(value: String) {
        _query.value = value
        // Reset online search state for new query
        _onlineState.value = OnlineSearchState.Idle
        _onlineResults.value = emptyList()
        _onlineAnime.value = emptyList<com.takeya.animeongaku.data.model.OnlineAnimeResult>()
        _onlineArtists.value = emptyList<com.takeya.animeongaku.data.model.OnlineArtistResult>()
        _onlineError.value = null
        onlineJob?.cancel()
    }

    fun searchOnline() {
        val q = _query.value
        if (q.isBlank()) return
        if (_onlineState.value == OnlineSearchState.Loading) return

        onlineJob?.cancel()
        onlineJob = viewModelScope.launch {
            _onlineState.value = OnlineSearchState.Loading
            _onlineError.value = null
            try {
                val searchResult = animeRepository.searchAnimeThemes(q)
                _onlineResults.value = searchResult.themes
                _onlineAnime.value = searchResult.anime
                _onlineArtists.value = searchResult.artists
                _onlineState.value = OnlineSearchState.Done
            } catch (e: Exception) {
                _onlineError.value = "Search failed: ${e.message}"
                _onlineState.value = OnlineSearchState.Error
            }
        }
    }

    fun buildAnimeMap(): Map<Long, AnimeEntity> {
        return anime.value.mapNotNull { entry ->
            entry.animeThemesId?.let { id -> id to entry }
        }.toMap()
    }

    private fun buildOnlineAnimeMap(entries: List<AnimeThemeEntry>): Map<Long, AnimeEntity> {
        return entries.mapNotNull { entry ->
            val animeThemesId = entry.animeId.toLongOrNull() ?: return@mapNotNull null
            val displayTitle = entry.animeNameEn ?: entry.animeName ?: return@mapNotNull null
            val syntheticKitsuId = entry.kitsuId ?: "online-${entry.animeId}"
            animeThemesId to AnimeEntity(
                kitsuId = syntheticKitsuId,
                animeThemesId = animeThemesId,
                title = displayTitle,
                titleEn = entry.animeNameEn,
                thumbnailUrl = entry.coverUrl,
                coverUrl = entry.coverUrl,
                syncedAt = 0L
            )
        }.toMap()
    }

    fun playLocalSong(themeId: Long) {
        val songs = localSongs.value
        val idx = songs.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play("Search: ${_query.value}", songs, idx, animeMap = buildAnimeMap())
    }

    private fun entryToThemeEntity(entry: AnimeThemeEntry): ThemeEntity {
        val themeId = entry.themeId.toLongOrNull() ?: abs(entry.themeId.hashCode()).toLong()
        return ThemeEntity(
            id = themeId,
            animeId = entry.animeId.toLongOrNull(),
            title = entry.title,
            artistName = entry.artist,
            audioUrl = entry.audioUrl,
            videoUrl = entry.videoUrl,
            isDownloaded = false,
            localFilePath = null,
            themeType = entry.themeType,
            source = ThemeEntity.SOURCE_USER
        )
    }

    private suspend fun saveThemeToDb(entry: AnimeThemeEntry): ThemeEntity {
        val entity = entryToThemeEntity(entry)
        themeDao.upsertAll(listOf(entity))
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
        return entity
    }

    fun saveAndPlayOnlineTheme(entry: AnimeThemeEntry) {
        viewModelScope.launch {
            val allEntities = _onlineResults.value.map { entryToThemeEntity(it) }
            val themeId = entryToThemeEntity(entry).id
            val idx = allEntities.indexOfFirst { it.id == themeId }.coerceAtLeast(0)

            // Build anime map from online entries directly (cover art available immediately)
            val onlineAnimeMap = buildOnlineAnimeMap(_onlineResults.value)
            // Merge with any already-persisted anime from DB
            val animeMap = buildAnimeMap() + onlineAnimeMap
            // All results after the tapped song are "suggested" — they auto-play but
            // get cleared if the user explicitly adds something to the queue.
            nowPlayingManager.play(
                contextLabel = "Search: ${_query.value}",
                themes = allEntities,
                startIndex = idx,
                animeMap = animeMap,
                suggestedFrom = idx + 1
            )
        }
    }

    fun saveOnlineThemePlayNext(entry: AnimeThemeEntry) {
        viewModelScope.launch {
            val entity = saveThemeToDb(entry)
            nowPlayingManager.playNext(entity)
        }
    }

    fun saveOnlineThemeAddToQueue(entry: AnimeThemeEntry) {
        viewModelScope.launch {
            val entity = saveThemeToDb(entry)
            nowPlayingManager.addToQueue(entity)
        }
    }

    fun addOnlineThemeToLibrary(entry: AnimeThemeEntry) {
        viewModelScope.launch {
            saveThemeToDb(entry)
            // Also try to create/update the AnimeEntity via Kitsu cross-reference
            enrichAnimeFromKitsu(entry)
        }
    }

    private suspend fun enrichAnimeFromKitsu(entry: AnimeThemeEntry) {
        val animeThemesId = entry.animeId.toLongOrNull() ?: return
        // Check if we already have this anime
        val existing = animeDao.getByAnimeThemesId(animeThemesId)
        if (existing != null) return

        try {
            val match = if (entry.kitsuId != null) {
                // We have a direct Kitsu ID from AnimeThemes resources — fetch details
                val details = userRepository.getAnimeDetails(listOf(entry.kitsuId))
                details.firstOrNull()
            } else {
                // Fall back to searching Kitsu by anime name
                val animeName = entry.animeName ?: return
                val kitsuResults = userRepository.searchKitsuAnime(animeName)
                kitsuResults.firstOrNull()
            } ?: return

            val animeEntity = AnimeEntity(
                kitsuId = match.id,
                animeThemesId = animeThemesId,
                title = match.title ?: entry.animeName ?: "Unknown",
                titleEn = match.titleEn,
                titleRomaji = match.titleRomaji,
                titleJa = match.titleJa,
                thumbnailUrl = match.posterUrl,
                coverUrl = match.coverUrl,
                syncedAt = System.currentTimeMillis()
            )
            animeDao.upsertAll(listOf(animeEntity))
        } catch (_: Exception) {
            // Best-effort: if Kitsu lookup fails, we still have the theme saved
        }
    }

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
            val newId = playlistDao.insertPlaylist(
                PlaylistEntity(name = name, createdAt = System.currentTimeMillis())
            )
            val entries = themeIds.mapIndexed { i, id ->
                PlaylistEntryEntity(playlistId = newId, themeId = id, orderIndex = i)
            }
            playlistDao.insertEntries(entries)
        }
    }
}
