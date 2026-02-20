package com.takeya.animeongaku.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeWithThemeCount
import com.takeya.animeongaku.data.local.ArtistDao
import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.repository.ArtistRepository
import com.takeya.animeongaku.media.NowPlayingManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val playlistDao: PlaylistDao,
    private val animeDao: AnimeDao,
    private val themeDao: ThemeDao,
    private val artistDao: ArtistDao,
    private val artistImageDao: ArtistImageDao,
    private val artistRepository: ArtistRepository,
    val nowPlayingManager: NowPlayingManager
) : ViewModel() {
    val playlists = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val anime = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val themes = themeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val artistNames = artistDao.observeAllArtistNames()
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val artistImages = artistNames
        .flatMapLatest { names ->
            if (names.isEmpty()) {
                flowOf(emptyList())
            } else {
                artistImageDao.observeByNames(names)
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        viewModelScope.launch {
            artistNames.collect { names ->
                artistRepository.refreshArtistImages(names)
            }
        }
    }

    val animeItems: StateFlow<List<AnimeItem>> = animeDao.observeAllWithThemeCount()
        .map { list ->
            list.mapNotNull { row ->
                val title = row.anime.title?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                AnimeItem(
                    kitsuId = row.anime.kitsuId,
                    animeThemesId = row.anime.animeThemesId,
                    title = title,
                    trackCount = row.themeCount,
                    coverUrl = row.anime.coverUrl ?: row.anime.thumbnailUrl
                )
            }.sortedBy { it.title.lowercase() }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val artistTrackCounts = artistDao.observeArtistTrackCounts()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val artists: StateFlow<List<ArtistItem>> = combine(artistTrackCounts, artistImages) { counts, imageList ->
        val imageMap = imageList.associateBy { it.name }
        counts.map { row ->
            ArtistItem(
                name = row.artistName,
                trackCount = row.trackCount,
                imageUrl = imageMap[row.artistName]?.imageUrl
            )
        }.sortedBy { it.name.lowercase() }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun createPlaylist(name: String) {
        val trimmed = name.trim()
        if (trimmed.isBlank()) return
        viewModelScope.launch {
            playlistDao.insertPlaylist(
                PlaylistEntity(
                    name = trimmed,
                    createdAt = System.currentTimeMillis()
                )
            )
        }
    }

    fun deletePlaylist(playlistId: Long) {
        viewModelScope.launch {
            playlistDao.deletePlaylistEntries(playlistId)
            playlistDao.deletePlaylist(playlistId)
        }
    }

    fun renamePlaylist(playlistId: Long, newName: String) {
        val trimmed = newName.trim()
        if (trimmed.isBlank()) return
        viewModelScope.launch {
            playlistDao.renamePlaylist(playlistId, trimmed)
        }
    }

    private fun buildAnimeMap(): Map<Long, AnimeEntity> {
        return anime.value.mapNotNull { entry ->
            entry.animeThemesId?.let { id -> id to entry }
        }.toMap()
    }

    fun playFromSongs(themeId: Long) {
        val allSongs = themes.value
        val idx = allSongs.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play("All Songs", allSongs, idx, animeMap = buildAnimeMap())
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

data class AnimeItem(
    val kitsuId: String,
    val animeThemesId: Long?,
    val title: String,
    val trackCount: Int,
    val coverUrl: String?
)

data class ArtistItem(
    val name: String,
    val trackCount: Int,
    val imageUrl: String?
)
