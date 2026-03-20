package com.takeya.animeongaku

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.tooling.preview.Preview
import com.takeya.animeongaku.ui.theme.AnimeOngakuTheme
import com.takeya.animeongaku.ui.AnimeOngakuApp
import com.takeya.animeongaku.sync.AutoPlaylistManager
import com.takeya.animeongaku.sync.LibraryStatusSyncManager
import dagger.hilt.android.AndroidEntryPoint

import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var autoPlaylistManager: AutoPlaylistManager
    @Inject lateinit var libraryStatusSyncManager: LibraryStatusSyncManager

    val pendingNavigateTo = mutableStateOf<String?>(null)
    
    private var periodicSyncJob: Job? = null

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
        autoPlaylistManager.refreshAutoPlaylists()
        
        // Cold start sync: min interval 5 minutes
        libraryStatusSyncManager.syncIfNeeded(
            minIntervalMs = 5 * 60 * 1000L,
            onStart = { com.takeya.animeongaku.sync.StatusSyncService.start(this) }
        )

        setContent {
            AnimeOngakuTheme {
                AnimeOngakuApp(pendingNavigateTo = pendingNavigateTo)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Warm resume sync: min interval 60 minutes
        libraryStatusSyncManager.syncIfNeeded(
            minIntervalMs = 60 * 60 * 1000L,
            onStart = { com.takeya.animeongaku.sync.StatusSyncService.start(this) }
        )
        
        // Continuous foreground periodic sync: min interval 2 hours
        periodicSyncJob = lifecycleScope.launch {
            while (true) {
                delay(2 * 60 * 60 * 1000L) // 2 hours
                libraryStatusSyncManager.syncIfNeeded(
                    minIntervalMs = 2 * 60 * 60 * 1000L,
                    onStart = { com.takeya.animeongaku.sync.StatusSyncService.start(this@MainActivity) }
                )
            }
        }
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
}

@Preview(showBackground = true)
@Composable
fun AppPreview() {
    AnimeOngakuTheme {
        AnimeOngakuApp()
    }
}
