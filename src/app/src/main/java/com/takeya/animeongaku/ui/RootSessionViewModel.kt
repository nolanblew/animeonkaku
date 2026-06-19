package com.takeya.animeongaku.ui

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow

@HiltViewModel
class RootSessionViewModel @Inject constructor(
    sessionStateManager: SessionStateManager
) : ViewModel() {
    val sessionState: StateFlow<SessionState> = sessionStateManager.state
}
