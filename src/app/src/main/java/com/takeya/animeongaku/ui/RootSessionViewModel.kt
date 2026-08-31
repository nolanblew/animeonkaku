package com.takeya.animeongaku.ui

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.sync.LibrarySyncIndicator
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow

@HiltViewModel
class RootSessionViewModel @Inject constructor(
    sessionStateManager: SessionStateManager,
    librarySyncIndicator: LibrarySyncIndicator
) : ViewModel() {
    val sessionState: StateFlow<SessionState> = sessionStateManager.state
    val librarySyncMessage: StateFlow<String?> = librarySyncIndicator.message
}
