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
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    val pendingNavigateTo = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingNavigateTo.value = intent?.getStringExtra("navigate_to")
        enableEdgeToEdge()
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
