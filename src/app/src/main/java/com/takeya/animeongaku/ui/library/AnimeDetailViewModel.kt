package com.takeya.animeongaku.ui.library

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import kotlinx.coroutines.launch
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
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

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class AnimeDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    animeDao: AnimeDao,
    private val themeDao: ThemeDao,
    private val playlistDao: PlaylistDao,
    val nowPlayingManager: NowPlayingManager
) : ViewModel() {
    private val kitsuId: String = savedStateHandle["kitsuId"] ?: ""

    val anime: StateFlow<AnimeEntity?> = animeDao.observeByKitsuId(kitsuId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val themes: StateFlow<List<ThemeEntity>> = anime
        .flatMapLatest { animeEntity ->
            val atId = animeEntity?.animeThemesId
            if (atId != null) {
                themeDao.observeByAnimeId(atId).map { list -> sortThemes(list) }
            } else {
                flowOf(emptyList())
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

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
