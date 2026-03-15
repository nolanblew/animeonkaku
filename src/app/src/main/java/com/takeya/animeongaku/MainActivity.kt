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
import dagger.hilt.android.AndroidEntryPoint

import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var autoPlaylistManager: AutoPlaylistManager

    val pendingNavigateTo = mutableStateOf<String?>(null)

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
        setContent {
            AnimeOngakuTheme {
                AnimeOngakuApp(pendingNavigateTo = pendingNavigateTo)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pendingNavigateTo.value = intent.getStringExtra("navigate_to")
    }
}

@Preview(showBackground = true)
@Composable
fun AppPreview() {
    AnimeOngakuTheme {
        AnimeOngakuApp()
    }
}
