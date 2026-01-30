package com.takeya.animeongaku.ui

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.takeya.animeongaku.ui.sync.ImportScreen
import com.takeya.animeongaku.ui.player.PlayerScreen

private object Routes {
    const val Import = "import"
    const val Player = "player"
}

@Composable
fun AnimeOngakuApp() {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = Routes.Import
    ) {
        composable(Routes.Import) {
            ImportScreen(
                onOpenPlayer = { navController.navigate(Routes.Player) }
            )
        }
        composable(Routes.Player) {
            PlayerScreen()
        }
    }
}
