package com.takeya.animeongaku.ui.library

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

@HiltViewModel
class ArtistDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    themeDao: ThemeDao,
    animeDao: AnimeDao,
    artistImageDao: ArtistImageDao
) : ViewModel() {
    val artistName: String = savedStateHandle["artistName"] ?: ""

    val themes: StateFlow<List<ThemeEntity>> = themeDao.observeByArtistName(artistName)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val anime: StateFlow<List<AnimeEntity>> = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val artistImageUrl: StateFlow<String?> = artistImageDao.observeByNames(listOf(artistName))
        .map { images -> images.firstOrNull()?.imageUrl }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}
