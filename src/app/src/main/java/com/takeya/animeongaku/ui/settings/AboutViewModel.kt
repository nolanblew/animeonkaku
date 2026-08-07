package com.takeya.animeongaku.ui.settings

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.data.server.ServerSettingsStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class AboutViewModel @Inject constructor(
    serverSettingsStore: ServerSettingsStore
) : ViewModel() {

    /** Server compiled into this build. Read-only; not configurable in-app. */
    val serverBaseUrl: String = serverSettingsStore.compiledServerBaseUrl ?: "Not configured"
}
