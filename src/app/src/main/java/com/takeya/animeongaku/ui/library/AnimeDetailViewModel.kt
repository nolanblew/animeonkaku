package com.takeya.animeongaku.ui.library

import android.util.Log
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ArtistDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.UserRepository
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.media.NowPlayingManager
import kotlinx.coroutines.launch
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.math.abs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.ExperimentalCoroutinesApi

internal fun sortThemesByType(themes: List<ThemeEntity>): List<ThemeEntity> {
    val regex = Regex("^(OP|ED)(\\d+)$", RegexOption.IGNORE_CASE)
    return themes.sortedWith(compareBy<ThemeEntity> { theme ->
        when {
            theme.themeType?.startsWith("OP", ignoreCase = true) == true -> 0
            theme.themeType?.startsWith("ED", ignoreCase = true) == true -> 1
            else -> 2
        }
    }.thenBy { theme ->
        val match = theme.themeType?.let { regex.find(it) }
        match?.groupValues?.get(2)?.toIntOrNull() ?: Int.MAX_VALUE
    }.thenBy { it.title })
}

internal fun entryToThemeEntity(entry: AnimeThemeEntry): ThemeEntity {
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

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class AnimeDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val animeDao: AnimeDao,
    private val artistDao: ArtistDao,
    private val themeDao: ThemeDao,
    private val playlistDao: PlaylistDao,
    private val animeRepository: AnimeRepository,
    private val userRepository: UserRepository,
    val nowPlayingManager: NowPlayingManager,
    val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao
) : ViewModel() {
    private val kitsuId: String = savedStateHandle["kitsuId"] ?: ""

    // In-memory online data (NOT saved to DB until explicit "Add to Library")
    private val _onlineThemes = MutableStateFlow<List<ThemeEntity>>(emptyList())
    private val _onlineAnime = MutableStateFlow<AnimeEntity?>(null)
    private val _onlineEntries = MutableStateFlow<List<AnimeThemeEntry>>(emptyList())

    // Local DB data (reactive)
    private val localAnime: StateFlow<AnimeEntity?> = animeDao.observeByKitsuId(kitsuId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val localThemes: StateFlow<List<ThemeEntity>> = localAnime
        .flatMapLatest { animeEntity ->
            val atId = animeEntity?.animeThemesId
            if (atId != null) {
                themeDao.observeByAnimeId(atId).map { list -> sortThemes(list) }
            } else {
                flowOf(emptyList())
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    // Whether the anime entity itself is in the local DB
    val isInLibrary: StateFlow<Boolean> = localAnime
        .map { it != null }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    // Set of theme IDs that are in the local library (for per-song indicators)
    val libraryThemeIds: StateFlow<Set<Long>> = localThemes
        .map { list -> list.map { it.id }.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    // Expose anime: prefer local, fallback to online
    val anime: StateFlow<AnimeEntity?> = combine(localAnime, _onlineAnime) { local, online ->
        local ?: online
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    // Expose themes: always show the full online catalog when available,
    // fall back to local-only if online fetch hasn't happened or failed
    val themes: StateFlow<List<ThemeEntity>> = combine(_onlineThemes, localThemes) { online, local ->
        if (online.isNotEmpty()) online else local
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
                val syncResult = animeRepository.fetchAnimeByExternalIds("Kitsu", listOf(kitsuId))
                if (syncResult.themes.isNotEmpty()) {
                    _onlineEntries.value = syncResult.themes
                    _onlineThemes.value = sortThemes(syncResult.themes.map { entryToThemeEntity(it) })
                    // Build a temporary AnimeEntity for display
                    val firstEntry = syncResult.themes.first()
                    val atId = firstEntry.animeId.toLongOrNull()
                    if (atId != null && localAnime.value == null) {
                        _onlineAnime.value = buildOnlineAnimeEntity(firstEntry, atId)
                    }
                } else if (localThemes.value.isEmpty()) {
                    _fetchError.value = "No themes found online"
                }
            } catch (e: Exception) {
                Log.e("AnimeDetailVM", "fetchFromApi failed", e)
                if (localThemes.value.isEmpty()) {
                    _fetchError.value = "Failed to load: ${e.message}"
                }
            } finally {
                _isLoading.value = false
            }
        }
    }

    private suspend fun buildOnlineAnimeEntity(entry: AnimeThemeEntry, animeThemesId: Long): AnimeEntity {
        return try {
            val details = userRepository.getAnimeDetails(listOf(kitsuId))
            val match = details.firstOrNull()
            AnimeEntity(
                kitsuId = kitsuId,
                animeThemesId = animeThemesId,
                title = match?.title ?: entry.animeName ?: "Unknown",
                titleEn = match?.titleEn ?: entry.animeNameEn,
                titleRomaji = match?.titleRomaji,
                titleJa = match?.titleJa,
                thumbnailUrl = match?.posterUrl ?: entry.coverUrl,
                coverUrl = match?.coverUrl ?: entry.coverUrl,
                syncedAt = System.currentTimeMillis()
            )
        } catch (_: Exception) {
            AnimeEntity(
                kitsuId = kitsuId,
                animeThemesId = animeThemesId,
                title = entry.animeName ?: "Unknown",
                titleEn = entry.animeNameEn,
                thumbnailUrl = entry.coverUrl,
                coverUrl = entry.coverUrl,
                syncedAt = System.currentTimeMillis()
            )
        }
    }

    fun saveAllToLibrary() {
        viewModelScope.launch {
            val animeEntity = _onlineAnime.value ?: return@launch
            val entries = _onlineEntries.value
            if (entries.isEmpty()) return@launch

            // Save anime (marked as manually added so re-sync won't remove it)
            animeDao.upsertAll(listOf(animeEntity.copy(isManuallyAdded = true)))
            // Save themes
            val entities = entries.map { entryToThemeEntity(it) }
            themeDao.upsertAll(entities)
            // Save artist cross-refs
            saveArtistCrossRefs(entries)
        }
    }

    fun saveSongToLibrary(themeId: Long) {
        viewModelScope.launch {
            val entry = _onlineEntries.value.firstOrNull {
                entryToThemeEntity(it).id == themeId
            } ?: return@launch
            val entity = entryToThemeEntity(entry)
            themeDao.upsertAll(listOf(entity))
            // Also save the anime entity so the theme has a parent (marked as manually added)
            val animeEntity = _onlineAnime.value
            if (animeEntity != null) {
                animeDao.upsertAll(listOf(animeEntity.copy(isManuallyAdded = true)))
            }
            // Save artist cross-refs for this entry
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

    private suspend fun saveArtistCrossRefs(entries: List<AnimeThemeEntry>) {
        entries.forEach { entry ->
            if (entry.artists.isNotEmpty()) {
                val entity = entryToThemeEntity(entry)
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

    private fun sortThemes(themes: List<ThemeEntity>): List<ThemeEntity> =
        sortThemesByType(themes)

    private fun buildAnimeMap(): Map<Long, AnimeEntity> {
        val a = anime.value ?: return emptyMap()
        val atId = a.animeThemesId ?: return emptyMap()
        return mapOf(atId to a)
    }

    private fun contextLabel(): String = anime.value?.title ?: "Anime"

    fun playTheme(themeId: Long) {
        val list = themes.value
        val idx = list.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play(contextLabel(), list, idx, animeMap = buildAnimeMap())
    }

    fun playAll() {
        val list = themes.value
        if (list.isNotEmpty()) nowPlayingManager.play(contextLabel(), list, 0, animeMap = buildAnimeMap())
    }

    fun shuffleAll() {
        val list = themes.value
        if (list.isNotEmpty()) nowPlayingManager.play(contextLabel(), list, 0, shuffle = true, animeMap = buildAnimeMap())
    }

    val playlists: StateFlow<List<PlaylistWithCount>> = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

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

    fun downloadSong(theme: ThemeEntity) {
        downloadManager.downloadSong(theme, anime.value)
    }

    fun removeDownload(themeId: Long) {
        downloadManager.removeDownload(themeId)
    }

    fun downloadAnime() {
        downloadManager.downloadAnime(kitsuId)
    }

    fun removeAnimeDownload() {
        downloadManager.removeAnimeDownload(kitsuId)
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
