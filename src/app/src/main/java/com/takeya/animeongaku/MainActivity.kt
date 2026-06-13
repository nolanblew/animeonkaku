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
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.AutoPlaylistManager
import com.takeya.animeongaku.sync.LibraryPullManager
import dagger.hilt.android.AndroidEntryPoint

import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import javax.inject.Inject
import com.takeya.animeongaku.updater.AppUpdateViewModel

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var autoPlaylistManager: AutoPlaylistManager
    @Inject lateinit var libraryPullManager: LibraryPullManager
    @Inject lateinit var serverSettingsStore: ServerSettingsStore

    val pendingNavigateTo = mutableStateOf<String?>(null)
    private val appUpdateViewModel: AppUpdateViewModel by viewModels()
    
    private var periodicSyncJob: Job? = null
    private var handledInitialServerStart = false

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        var keepSplashScreen = true
        lifecycleScope.launch {
            kotlinx.coroutines.delay(1000L)
            keepSplashScreen = false
        }
        splashScreen.setKeepOnScreenCondition { keepSplashScreen }
        super.onCreate(savedInstanceState)
        pendingNavigateTo.value = intent?.getStringExtra("navigate_to")
        enableEdgeToEdge()

        if (serverSettingsStore.isConfigured) {
            requestServerPullIfStale(COLD_START_PULL_INTERVAL_MS)
        } else {
            autoPlaylistManager.refreshAutoPlaylists()
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
        if (serverSettingsStore.isConfigured) {
            if (handledInitialServerStart) {
                requestServerPullIfStale(WARM_RESUME_PULL_INTERVAL_MS)
            } else {
                handledInitialServerStart = true
            }

            periodicSyncJob = lifecycleScope.launch {
                while (true) {
                    delay(FOREGROUND_PULL_INTERVAL_MS)
                    runCatching {
                        libraryPullManager.pullIfStale(FOREGROUND_PULL_INTERVAL_MS)
                    }
                }
            }
            return
        }

        autoPlaylistManager.refreshAutoPlaylists()
    }

    override fun onStop() {
        super.onStop()
        periodicSyncJob?.cancel()
        periodicSyncJob = null
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

    private companion object {
        const val COLD_START_PULL_INTERVAL_MS = 5 * 60 * 1000L
        const val WARM_RESUME_PULL_INTERVAL_MS = 60 * 60 * 1000L
        const val FOREGROUND_PULL_INTERVAL_MS = 2 * 60 * 60 * 1000L
    }
}

@Preview(showBackground = true)
@Composable
fun AppPreview() {
    AnimeOngakuTheme {
        AnimeOngakuApp()
    }
}
