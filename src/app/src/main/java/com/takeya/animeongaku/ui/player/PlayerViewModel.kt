package com.takeya.animeongaku.ui.player

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.NowPlayingState
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow

@HiltViewModel
class PlayerViewModel @Inject constructor(
    val nowPlayingManager: NowPlayingManager
) : ViewModel() {
    val nowPlayingState: StateFlow<NowPlayingState> = nowPlayingManager.state
}
