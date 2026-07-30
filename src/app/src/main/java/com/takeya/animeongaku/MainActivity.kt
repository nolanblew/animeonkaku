package com.takeya.animeongaku

import android.content.Intent
import android.os.Bundle
import androidx.activity.viewModels
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.tooling.preview.Preview
import com.takeya.animeongaku.ui.theme.AnimeOngakuTheme
import com.takeya.animeongaku.ui.AnimeOngakuApp
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.AutoPlaylistManager
import com.takeya.animeongaku.sync.LibraryPullManager
import dagger.hilt.android.AndroidEntryPoint

import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import javax.inject.Inject
import com.takeya.animeongaku.updater.AppUpdateViewModel

internal fun activeRefreshIntervalMs(): Long = 10 * 60 * 1_000L

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var autoPlaylistManager: AutoPlaylistManager
    @Inject lateinit var libraryPullManager: LibraryPullManager
    @Inject lateinit var serverSettingsStore: ServerSettingsStore
    @Inject lateinit var sessionStateManager: SessionStateManager

    val pendingNavigateTo = mutableStateOf<String?>(null)
    private val appUpdateViewModel: AppUpdateViewModel by viewModels()
    
    private var periodicSyncJob: Job? = null
    private var handledInitialServerStart = false
    private var isForeground = false

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        pendingNavigateTo.value = intent?.getStringExtra("navigate_to")
        enableEdgeToEdge()

        if (serverSettingsStore.isConfigured && sessionStateManager.isOnlineEnabled()) {
            requestServerPullIfStale(COLD_START_PULL_INTERVAL_MS)
        } else {
            autoPlaylistManager.refreshAutoPlaylists()
        }

        lifecycleScope.launch {
            sessionStateManager.state.collect { state ->
                updateForegroundServerWork(state)
            }
        }

        setContent {
            AnimeOngakuTheme {
                AnimeOngakuApp(
                    pendingNavigateTo = pendingNavigateTo,
                    appUpdateViewModel = appUpdateViewModel
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        isForeground = true
        updateForegroundServerWork(sessionStateManager.state.value)
    }

    override fun onStop() {
        super.onStop()
        isForeground = false
        stopActiveRefreshLoop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val navigateTo = intent.getStringExtra("navigate_to")
        if (navigateTo != null) {
            pendingNavigateTo.value = navigateTo
        }
    }

    private fun requestServerPullIfStale(minIntervalMs: Long) {
        lifecycleScope.launch {
            runCatching {
                libraryPullManager.pullIfStale(minIntervalMs)
            }
        }
    }

    private fun updateForegroundServerWork(state: SessionState) {
        if (!isForeground) return
        if (serverSettingsStore.isConfigured && state is SessionState.Active) {
            if (handledInitialServerStart) {
                requestServerPullIfStale(WARM_RESUME_PULL_INTERVAL_MS)
            } else {
                handledInitialServerStart = true
            }
            startActiveRefreshLoop()
            return
        }

        stopActiveRefreshLoop()
        autoPlaylistManager.refreshAutoPlaylists()
    }

    private fun startActiveRefreshLoop() {
        if (periodicSyncJob != null) return
        // Active-refresh loop: while the app is foregrounded, pull server
        // changes every ten minutes so anything the server adds in the background
        // (new mappings, confirmed themes) shows up in the UI via Room flows
        // without a manual refresh. Each pull is a cheap cursor-based delta,
        // and hitting the API also arms the server's own device-activity
        // delta sync when the user has been away for a few hours.
        periodicSyncJob = lifecycleScope.launch {
            val intervalMs = activeRefreshIntervalMs()
            while (true) {
                kotlinx.coroutines.delay(intervalMs)
                runCatching {
                    libraryPullManager.pullIfStale(intervalMs)
                }
            }
        }
    }

    private fun stopActiveRefreshLoop() {
        periodicSyncJob?.cancel()
        periodicSyncJob = null
    }

    private companion object {
        const val COLD_START_PULL_INTERVAL_MS = 5 * 60 * 1000L
        const val WARM_RESUME_PULL_INTERVAL_MS = 60 * 60 * 1000L
    }
}

@Preview(showBackground = true)
@Composable
fun AppPreview() {
    AnimeOngakuTheme {
        AnimeOngakuApp()
    }
}
