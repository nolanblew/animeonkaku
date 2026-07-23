package com.takeya.animeongaku.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ArtistDao
import com.takeya.animeongaku.data.local.ArtistTrackCount
import com.takeya.animeongaku.data.local.mergeArtistTrackCounts
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.OnlineAnimeResult
import com.takeya.animeongaku.data.model.OnlineArtistResult
import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.MusicCatalogRepository
import com.takeya.animeongaku.data.repository.MusicSearchResults
import com.takeya.animeongaku.data.repository.ServerPlaylistWriter
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import com.takeya.animeongaku.sync.LibraryPullManager
import com.takeya.animeongaku.sync.SyncEngine
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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class OnlineSearchState { Idle, Loading, Done, Error }

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val themeDao: ThemeDao,
    private val themeModeDao: ThemeModeDao,
    private val animeDao: AnimeDao,
    private val artistDao: ArtistDao,
    private val playlistDao: PlaylistDao,
    private val animeRepository: AnimeRepository,
    private val musicCatalogRepository: MusicCatalogRepository,
    private val libraryPullManager: LibraryPullManager,
    private val syncEngine: SyncEngine,
    val nowPlayingManager: NowPlayingManager,
    val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao,
    private val serverPlaylistWriter: ServerPlaylistWriter,
    private val userPreferencesRepository: UserPreferencesRepository,
    private val sessionStateManager: SessionStateManager,
    connectivityMonitor: ConnectivityMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = connectivityMonitor.isOnline

    val onlineEnabled: StateFlow<Boolean> = sessionStateManager.state
        .map { it is SessionState.Active }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), sessionStateManager.isOnlineEnabled())

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    val localSongs: StateFlow<List<ThemeEntity>> = _query
        .flatMapLatest { q ->
            if (q.isBlank()) flowOf(emptyList()) else themeDao.searchThemes(q)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val themeModesById: StateFlow<Map<Long, ThemeModeEntity>> = localSongs
        .flatMapLatest { list ->
            val ids = list.map { it.id }
            if (ids.isEmpty()) flowOf(emptyList()) else themeModeDao.observeByThemeIds(ids)
        }
        .map { modes -> modes.associateBy { it.themeId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    val localAnime: StateFlow<List<AnimeEntity>> = _query
        .flatMapLatest { q ->
            if (q.isBlank()) flowOf(emptyList()) else animeDao.searchAnime(q)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val localArtists: StateFlow<List<ArtistTrackCount>> = _query
        .flatMapLatest { q ->
            if (q.isBlank()) flowOf(emptyList()) else combine(artistDao.searchArtists(q), musicCatalogRepository.observeArtistTrackCounts()) { themeArtists, catalogArtists ->
                mergeArtistTrackCounts(themeArtists + catalogArtists.filter { it.artistName.contains(q, ignoreCase = true) })
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val localPlaylists: StateFlow<List<PlaylistWithCount>> = _query
        .flatMapLatest { q ->
            if (q.isBlank()) flowOf(emptyList()) else playlistDao.searchPlaylists(q)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val localMusic: StateFlow<MusicSearchResults> = _query.flatMapLatest { q ->
        if (q.isBlank()) flowOf(MusicSearchResults()) else musicCatalogRepository.searchCached(q)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), MusicSearchResults())

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
    private val _onlineMusic = MutableStateFlow(MusicSearchResults())
    val onlineMusic: StateFlow<MusicSearchResults> = _onlineMusic.asStateFlow()

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
        _onlineMusic.value = MusicSearchResults()
        _onlineError.value = null
        onlineJob?.cancel()
    }

    fun searchOnline() {
        if (!sessionStateManager.isOnlineEnabled()) {
            _onlineError.value = "Reconnect to search online."
            _onlineState.value = OnlineSearchState.Error
            return
        }
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
                _onlineMusic.value = musicCatalogRepository.searchRemote(q)
                _onlineState.value = OnlineSearchState.Done
            } catch (e: Exception) {
                _onlineError.value = searchFailureMessage(hasCachedSearchResults())
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

    private fun hasCachedSearchResults(): Boolean =
        localSongs.value.isNotEmpty() || localAnime.value.isNotEmpty() || localArtists.value.isNotEmpty() ||
            localPlaylists.value.isNotEmpty() || localMusic.value.releases.isNotEmpty() || localMusic.value.tracks.isNotEmpty()

    private fun localContextLabel(): String = "Search: ${_query.value}"

    fun requestPlayVideo(themeId: Long): BrowseVideoStartRequest? {
        val theme = localSongs.value.firstOrNull { it.id == themeId } ?: return null
        return BrowseVideoActionPolicy.request(
            isOnline.value,
            localContextLabel(),
            listOf(theme),
            themeModesById.value,
            singleAnimeMap(theme)
        )
    }

    fun startPlayVideo(request: BrowseVideoStartRequest): Boolean {
        val themeId = request.themes.singleOrNull()?.id ?: return false
        val currentTheme = localSongs.value.firstOrNull { it.id == themeId } ?: return false
        return request.startIfStillValid(
            nowPlayingManager,
            isOnline.value,
            listOf(currentTheme),
            themeModesById.value,
            localContextLabel(),
            singleAnimeMap(currentTheme)
        )
    }

    private fun singleAnimeMap(theme: ThemeEntity): Map<Long, AnimeEntity> =
        theme.animeId?.let { id -> buildAnimeMap()[id]?.let { mapOf(id to it) } } ?: emptyMap()

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
            saveSyntheticAnimeIfMissing(entry)
            requestServerLibraryAdd(entry)
        }
    }

    private suspend fun saveSyntheticAnimeIfMissing(entry: AnimeThemeEntry) {
        val animeThemesId = entry.animeId.toLongOrNull() ?: return
        val existing = animeDao.getByAnimeThemesId(animeThemesId)
        if (existing != null) return

        val animeEntity = AnimeEntity(
            kitsuId = entry.kitsuId ?: "online-${entry.animeId}",
            animeThemesId = animeThemesId,
            title = entry.animeNameEn ?: entry.animeName ?: "Unknown",
            titleEn = entry.animeNameEn,
            thumbnailUrl = entry.coverUrl,
            coverUrl = entry.coverUrl,
            syncedAt = System.currentTimeMillis(),
            isManuallyAdded = true
        )
        animeDao.upsertAll(listOf(animeEntity))
    }

    private suspend fun requestServerLibraryAdd(entry: AnimeThemeEntry) {
        val animeThemesId = entry.animeId.toLongOrNull()
        syncEngine.enqueueLibraryAdd(
            kitsuId = entry.kitsuId,
            animeThemesId = if (entry.kitsuId == null) animeThemesId else null
        )
        val result = syncEngine.pushPendingWrites()
        if (!result.failed) {
            libraryPullManager.pullNow(forceFull = true)
        }
    }

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
}
