package com.takeya.animeongaku.ui.library

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.ExperimentalCoroutinesApi

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class AnimeDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    animeDao: AnimeDao,
    private val themeDao: ThemeDao
) : ViewModel() {
    private val kitsuId: String = savedStateHandle["kitsuId"] ?: ""

    val anime: StateFlow<AnimeEntity?> = animeDao.observeByKitsuId(kitsuId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val themes: StateFlow<List<ThemeEntity>> = anime
        .flatMapLatest { animeEntity ->
            val atId = animeEntity?.animeThemesId
            if (atId != null) {
                themeDao.observeByAnimeId(atId)
            } else {
                flowOf(emptyList())
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
}
