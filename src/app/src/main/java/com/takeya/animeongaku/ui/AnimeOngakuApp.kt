package com.takeya.animeongaku.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.activity.compose.BackHandler
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.takeya.animeongaku.ui.home.HomeScreen
import com.takeya.animeongaku.ui.library.AnimeDetailScreen
import com.takeya.animeongaku.ui.library.ArtistDetailScreen
import com.takeya.animeongaku.ui.library.LibraryScreen
import com.takeya.animeongaku.ui.library.PlaylistDetailScreen
import com.takeya.animeongaku.ui.player.PlayerContainer
import com.takeya.animeongaku.ui.player.MiniPlayerHeight
import com.takeya.animeongaku.ui.search.SearchScreen
import com.takeya.animeongaku.ui.settings.DownloadManagerScreen
import com.takeya.animeongaku.ui.settings.SettingsScreen
import com.takeya.animeongaku.ui.sync.ImportScreen
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import com.takeya.animeongaku.updater.AppUpdateEvent
import com.takeya.animeongaku.updater.AppUpdateViewModel
import kotlinx.coroutines.flow.collect

private object Routes {
    const val Home = "home"
    const val Search = "search"
    const val Library = "library"
    const val Playlist = "playlist"
    const val AnimeDetail = "animeDetail"
    const val ArtistDetail = "artistDetail"
    const val Import = "import"
    const val Player = "player"
    const val Settings = "settings"
    const val DownloadManager = "downloadManager"
}

private data class BottomNavItem(
    val route: String,
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

@Composable
fun AnimeOngakuApp(
    pendingNavigateTo: androidx.compose.runtime.MutableState<String?>? = null,
    appUpdateViewModel: AppUpdateViewModel
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination
    val context = LocalContext.current
    val updateState by appUpdateViewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    var isPlayerExpanded by rememberSaveable { mutableStateOf(false) }
    var dismissedUpdateTag by rememberSaveable { mutableStateOf<String?>(null) }

    BackHandler(enabled = isPlayerExpanded) {
        isPlayerExpanded = false
    }

    // Handle deep link from notification
    val navigateTo = pendingNavigateTo?.value
    androidx.compose.runtime.LaunchedEffect(navigateTo) {
        if (navigateTo != null) {
            pendingNavigateTo?.value = null
            if (navigateTo == Routes.Player || navigateTo == "player") {
                isPlayerExpanded = true
            } else {
                navController.navigate(navigateTo) {
                    launchSingleTop = true
                }
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

    var scaffoldPadding by remember { mutableStateOf(androidx.compose.foundation.layout.PaddingValues(0.dp)) }

    androidx.compose.runtime.LaunchedEffect(Unit) {
        appUpdateViewModel.events.collect { event ->
            when (event) {
                is AppUpdateEvent.OpenUrl -> {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(event.url)).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                        )
                    }.onFailure {
                        snackbarHostState.showSnackbar("Couldn't open the update link.")
                    }
                }

                is AppUpdateEvent.ShowMessage -> {
                    snackbarHostState.showSnackbar(event.message)
                }
            }
        }
    }

    androidx.compose.runtime.LaunchedEffect(updateState.availableUpdate?.versionTag) {
        val update = updateState.availableUpdate
        if (update == null) {
            dismissedUpdateTag = null
            return@LaunchedEffect
        }
        if (dismissedUpdateTag == update.versionTag) return@LaunchedEffect

        when (
            snackbarHostState.showSnackbar(
                message = "Update ${update.versionName} is available.",
                actionLabel = "Download",
                withDismissAction = true,
                duration = SnackbarDuration.Indefinite
            )
        ) {
            SnackbarResult.ActionPerformed -> appUpdateViewModel.openAvailableUpdate()
            SnackbarResult.Dismissed -> dismissedUpdateTag = update.versionTag
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Scaffold(
            bottomBar = {
                Column {
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
            scaffoldPadding = padding
            Box(modifier = Modifier.fillMaxSize()) {
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
                        onPlayTheme = { isPlayerExpanded = true },
                        onOpenPlaylist = { playlistId ->
                            navController.navigate("${Routes.Playlist}/$playlistId")
                        },
                        onOpenAnime = { kitsuId ->
                            navController.navigate("${Routes.AnimeDetail}/$kitsuId")
                        },
                        onOpenArtist = { artistName ->
                            navController.navigate("${Routes.ArtistDetail}/${android.net.Uri.encode(artistName)}")
                        },
                        onNavigateToLibrary = { tab ->
                            navController.navigate("${Routes.Library}?tab=$tab") {
                                popUpTo(Routes.Home) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    )
                }
                composable(Routes.Search) {
                    SearchScreen(
                        onPlayTheme = { isPlayerExpanded = true },
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
                        onOpenSettings = { navController.navigate(Routes.Settings) },
                        hasSettingsUpdateDot = updateState.availableUpdate != null,
                        onOpenPlaylist = { playlistId ->
                            navController.navigate("${Routes.Playlist}/$playlistId")
                        },
                        onPlayTheme = { isPlayerExpanded = true },
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
                        onPlayTheme = { isPlayerExpanded = true },
                        onOpenAnime = { kitsuId ->
                            navController.navigate("${Routes.AnimeDetail}/$kitsuId")
                        },
                        onOpenArtist = { artistName ->
                            navController.navigate("${Routes.ArtistDetail}/${android.net.Uri.encode(artistName)}")
                        }
                    )
                }
                composable(
                    route = "${Routes.AnimeDetail}/{kitsuId}",
                    arguments = listOf(navArgument("kitsuId") { type = NavType.StringType })
                ) {
                    AnimeDetailScreen(
                        onBack = { navController.popBackStack() },
                        onPlayTheme = { isPlayerExpanded = true },
                        onOpenArtist = { artistName -> navController.navigate("${Routes.ArtistDetail}/${android.net.Uri.encode(artistName)}") }
                    )
                }
                composable(
                    route = "${Routes.ArtistDetail}/{artistName}",
                    arguments = listOf(navArgument("artistName") { type = NavType.StringType })
                ) {
                    ArtistDetailScreen(
                        onBack = { navController.popBackStack() },
                        onPlayTheme = { isPlayerExpanded = true },
                        onOpenAnime = { kitsuId -> navController.navigate("${Routes.AnimeDetail}/$kitsuId") }
                    )
                }
                composable(Routes.Import) {
                    ImportScreen(
                        onBack = { navController.popBackStack() }
                    )
                }
                composable(Routes.Settings) {
                    SettingsScreen(
                        onBack = { navController.popBackStack() },
                        onOpenImport = { navController.navigate(Routes.Import) },
                        onOpenDownloadManager = { navController.navigate(Routes.DownloadManager) },
                        updaterEnabled = updateState.enabled,
                        isCheckingForUpdates = updateState.isChecking,
                        availableUpdate = updateState.availableUpdate,
                        onCheckForUpdates = { appUpdateViewModel.checkForUpdates(openWhenAvailable = true) },
                        onDownloadUpdate = { appUpdateViewModel.openAvailableUpdate() },
                        onOpenReleasePage = { appUpdateViewModel.openReleasePage() }
                    )
                }
                composable(Routes.DownloadManager) {
                    DownloadManagerScreen(
                        onBack = { navController.popBackStack() }
                    )
                }
            }
            }
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(
                    start = 16.dp,
                    end = 16.dp,
                    bottom = scaffoldPadding.calculateBottomPadding() + MiniPlayerHeight + 24.dp
                )
        )

        PlayerContainer(
            isExpanded = isPlayerExpanded,
            onExpand = { isPlayerExpanded = true },
            onCollapse = { isPlayerExpanded = false },
            showMiniPlayer = true,
            modifier = Modifier.align(Alignment.BottomCenter),
            bottomPadding = scaffoldPadding.calculateBottomPadding(),
            onOpenAnime = { kitsuId ->
                isPlayerExpanded = false
                navController.navigate("${Routes.AnimeDetail}/$kitsuId")
            },
            onOpenArtist = { artistName ->
                isPlayerExpanded = false
                navController.navigate("${Routes.ArtistDetail}/${android.net.Uri.encode(artistName)}")
            }
        )
    }
}
