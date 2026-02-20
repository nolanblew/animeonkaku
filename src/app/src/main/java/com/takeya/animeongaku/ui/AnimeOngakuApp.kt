package com.takeya.animeongaku.ui

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.runtime.Composable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.graphics.Color
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.takeya.animeongaku.ui.home.HomeScreen
import com.takeya.animeongaku.ui.search.SearchScreen
import com.takeya.animeongaku.ui.library.AnimeDetailScreen
import com.takeya.animeongaku.ui.library.ArtistDetailScreen
import com.takeya.animeongaku.ui.library.LibraryScreen
import com.takeya.animeongaku.ui.library.PlaylistDetailScreen
import com.takeya.animeongaku.ui.sync.ImportScreen
import com.takeya.animeongaku.ui.player.MiniPlayer
import com.takeya.animeongaku.ui.player.PlayerScreen
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

private object Routes {
    const val Home = "home"
    const val Search = "search"
    const val Library = "library"
    const val Playlist = "playlist"
    const val AnimeDetail = "animeDetail"
    const val ArtistDetail = "artistDetail"
    const val Import = "import"
    const val Player = "player"
}

private data class BottomNavItem(
    val route: String,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

@Composable
fun AnimeOngakuApp(
    pendingNavigateTo: androidx.compose.runtime.MutableState<String?>? = null
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination

    // Handle deep link from notification
    val navigateTo = pendingNavigateTo?.value
    androidx.compose.runtime.LaunchedEffect(navigateTo) {
        if (navigateTo != null) {
            pendingNavigateTo?.value = null
            navController.navigate(navigateTo) {
                launchSingleTop = true
            }
        }
    }
    val bottomItems = listOf(
        BottomNavItem(Routes.Home, "Home", Icons.Rounded.Home),
        BottomNavItem(Routes.Search, "Search", Icons.Rounded.Search),
        BottomNavItem(Routes.Library, "Library", Icons.Rounded.LibraryMusic)
    )
    val showBottomBar = currentDestination?.route?.let { route ->
        bottomItems.any { route == it.route || route.startsWith("${it.route}?") }
    } == true
    val isPlayerRoute = currentDestination?.route?.startsWith(Routes.Player) == true
    val showMiniPlayer = !isPlayerRoute

    Scaffold(
        bottomBar = {
            Column {
                if (showMiniPlayer) {
                    MiniPlayer(
                        onExpand = {
                            navController.navigate(Routes.Player)
                        }
                    )
                }
                if (showBottomBar) {
                    NavigationBar(containerColor = Color(0xFF0E0D12)) {
                        bottomItems.forEach { item ->
                            val selected = currentDestination?.hierarchy?.any { it.route == item.route } == true
                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    navController.navigate(item.route) {
                                        popUpTo(Routes.Home) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { androidx.compose.material3.Icon(item.icon, contentDescription = item.label) },
                                label = { Text(item.label) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Rose500,
                                    selectedTextColor = Mist100,
                                    unselectedIconColor = Mist200,
                                    unselectedTextColor = Mist200,
                                    indicatorColor = Ink700
                                )
                            )
                        }
                    }
                }
            }
        }
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Routes.Home,
            modifier = Modifier.padding(padding),
            enterTransition = { fadeIn(animationSpec = tween(300)) },
            exitTransition = { fadeOut(animationSpec = tween(300)) },
            popEnterTransition = { fadeIn(animationSpec = tween(300)) },
            popExitTransition = { fadeOut(animationSpec = tween(300)) }
        ) {
            composable(Routes.Home) {
                HomeScreen(
                    onPlayTheme = {
                        navController.navigate(Routes.Player)
                    },
                    onOpenPlaylist = { playlistId ->
                        navController.navigate("${Routes.Playlist}/$playlistId")
                    }
                )
            }
            composable(Routes.Search) {
                SearchScreen(
                    onPlayTheme = {
                        navController.navigate(Routes.Player)
                    },
                    onOpenAnime = { kitsuId ->
                        navController.navigate("${Routes.AnimeDetail}/$kitsuId")
                    },
                    onOpenArtist = { artistName ->
                        navController.navigate("${Routes.ArtistDetail}/${android.net.Uri.encode(artistName)}")
                    },
                    onOpenPlaylist = { playlistId ->
                        navController.navigate("${Routes.Playlist}/$playlistId")
                    }
                )
            }
            composable(
                route = "${Routes.Library}?tab={tab}",
                arguments = listOf(navArgument("tab") { type = NavType.StringType; defaultValue = "" })
            ) { entry ->
                val tab = entry.arguments?.getString("tab")
                LibraryScreen(
                    onOpenImport = { navController.navigate(Routes.Import) },
                    onOpenPlaylist = { playlistId ->
                        navController.navigate("${Routes.Playlist}/$playlistId")
                    },
                    onPlayTheme = {
                        navController.navigate(Routes.Player)
                    },
                    onOpenAnime = { kitsuId ->
                        navController.navigate("${Routes.AnimeDetail}/$kitsuId")
                    },
                    onOpenArtist = { artistName ->
                        navController.navigate("${Routes.ArtistDetail}/${android.net.Uri.encode(artistName)}")
                    },
                    initialTab = tab
                )
            }
            composable(
                route = "${Routes.Playlist}/{playlistId}",
                arguments = listOf(navArgument("playlistId") { type = NavType.LongType })
            ) {
                val playlistId = it.arguments?.getLong("playlistId") ?: return@composable
                PlaylistDetailScreen(
                    onBack = { navController.popBackStack() },
                    onPlayTheme = {
                        navController.navigate(Routes.Player)
                    }
                )
            }
            composable(
                route = "${Routes.AnimeDetail}/{kitsuId}",
                arguments = listOf(navArgument("kitsuId") { type = NavType.StringType })
            ) {
                AnimeDetailScreen(
                    onBack = { navController.popBackStack() },
                    onPlayTheme = {
                        navController.navigate(Routes.Player)
                    }
                )
            }
            composable(
                route = "${Routes.ArtistDetail}/{artistName}",
                arguments = listOf(navArgument("artistName") { type = NavType.StringType })
            ) {
                ArtistDetailScreen(
                    onBack = { navController.popBackStack() },
                    onPlayTheme = {
                        navController.navigate(Routes.Player)
                    },
                    onOpenAnime = { kitsuId ->
                        navController.navigate("${Routes.AnimeDetail}/$kitsuId")
                    }
                )
            }
            composable(Routes.Import) {
                ImportScreen(
                    onBack = { navController.popBackStack() }
                )
            }
            composable(
                route = Routes.Player,
                enterTransition = { slideInVertically(initialOffsetY = { it }, animationSpec = tween(350)) },
                exitTransition = { fadeOut(animationSpec = tween(200)) },
                popEnterTransition = { fadeIn(animationSpec = tween(200)) },
                popExitTransition = { slideOutVertically(targetOffsetY = { it }, animationSpec = tween(350)) }
            ) { PlayerScreen(onCollapse = { navController.popBackStack() }) }
        }
    }
}
