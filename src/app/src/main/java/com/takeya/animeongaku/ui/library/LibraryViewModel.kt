package com.takeya.animeongaku.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeWithThemeCount
import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.repository.ArtistRepository
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
    private val artistImageDao: ArtistImageDao,
    private val artistRepository: ArtistRepository
) : ViewModel() {
    val playlists = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val anime = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val themes = themeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val artistNames = themes
        .map { themeList ->
            themeList.mapNotNull { it.artistName?.trim() }
                .filter { it.isNotBlank() }
                .distinct()
        }
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
            }.sortedByDescending { it.trackCount }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val artists: StateFlow<List<ArtistItem>> = combine(anime, themes, artistImages) { animeList, themeList, imageList ->
        val animeById = animeList.mapNotNull { entry ->
            entry.animeThemesId?.let { id -> id to entry }
        }.toMap()
        val imageMap = imageList.associateBy { it.name }
        themeList
            .mapNotNull { theme ->
                val artist = theme.artistName?.takeIf(String::isNotBlank) ?: return@mapNotNull null
                val cover = theme.animeId?.let { animeById[it]?.coverUrl ?: animeById[it]?.thumbnailUrl }
                val image = imageMap[artist]?.imageUrl ?: cover
                artist to image
            }
            .groupBy({ it.first }, { it.second })
            .map { (name, covers) ->
                ArtistItem(
                    name = name,
                    trackCount = themeList.count { it.artistName == name },
                    imageUrl = covers.firstOrNull { !it.isNullOrBlank() }
                )
            }
            .sortedByDescending { it.trackCount }
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
