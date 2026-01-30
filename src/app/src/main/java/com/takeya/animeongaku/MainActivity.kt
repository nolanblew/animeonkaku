package com.takeya.animeongaku

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.takeya.animeongaku.ui.theme.AnimeOngakuTheme
import com.takeya.animeongaku.ui.AnimeOngakuApp
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AnimeOngakuTheme {
                AnimeOngakuApp()
            }
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
