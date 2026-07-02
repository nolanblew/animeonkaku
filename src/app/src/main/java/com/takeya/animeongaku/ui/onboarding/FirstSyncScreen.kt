package com.takeya.animeongaku.ui.onboarding

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.DownloadForOffline
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import kotlinx.coroutines.delay

private data class FirstSyncPage(
    val icon: ImageVector,
    val kicker: String,
    val title: String,
    val body: String
)

private val firstSyncPages = listOf(
    FirstSyncPage(
        icon = Icons.Rounded.CloudSync,
        kicker = "Setting up",
        title = "Building your library",
        body = "We're syncing your Kitsu anime list and matching every show to its opening and ending themes. Big libraries can take a few minutes — feel free to keep reading."
    ),
    FirstSyncPage(
        icon = Icons.Rounded.PlayCircle,
        kicker = "Helpful hint",
        title = "Stream instantly",
        body = "Tap any theme to play it right away. Your server fetches songs on demand and caches them, so the second play is always instant."
    ),
    FirstSyncPage(
        icon = Icons.Rounded.DownloadForOffline,
        kicker = "Helpful hint",
        title = "Take it offline",
        body = "Download your favorite themes to this device from any track's menu and keep listening on the train, on a plane, or anywhere without signal."
    ),
    FirstSyncPage(
        icon = Icons.Rounded.QueueMusic,
        kicker = "Helpful hint",
        title = "Playlists that build themselves",
        body = "\"Currently Watching\" and other auto playlists follow your Kitsu list — start a new show and its themes appear on their own."
    ),
    FirstSyncPage(
        icon = Icons.Rounded.MusicNote,
        kicker = "Did you know?",
        title = "The 89-second rule",
        body = "Most TV-size anime openings are cut to roughly 89 seconds — just long enough for one verse and a chorus before the cold open kicks in."
    )
)

private const val AUTO_ADVANCE_DELAY_MS = 7_000L

@Composable
fun FirstSyncScreen(state: FirstSyncUiState) {
    if (state.isDelta) {
        DeltaSyncScreen(state)
        return
    }
    FullSyncCarouselScreen(state)
}

/**
 * Returning user with a recent server library: no carousel, just a single
 * "topping up" screen while the server delta-fetches to the last sync point.
 */
@Composable
private fun DeltaSyncScreen(state: FirstSyncUiState) {
    val backgroundGradient = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundGradient)
            .padding(horizontal = 28.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(120.dp)
                .background(
                    Brush.radialGradient(
                        listOf(Rose500.copy(alpha = 0.3f), Rose500.copy(alpha = 0.06f))
                    ),
                    CircleShape
                )
                .border(1.dp, Rose500.copy(alpha = 0.35f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Rounded.CloudSync,
                contentDescription = null,
                tint = Rose500,
                modifier = Modifier.size(64.dp)
            )
        }
        Spacer(Modifier.height(28.dp))
        Text(
            text = "Getting your library up-to-date",
            style = MaterialTheme.typography.titleLarge,
            color = Mist100,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = "Welcome back! Your library is already on the server — we're just catching up on anything new.",
            style = MaterialTheme.typography.bodyMedium,
            color = Mist200,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(28.dp))
        LinearProgressIndicator(
            modifier = Modifier.fillMaxWidth(),
            color = Rose500,
            trackColor = Mist200.copy(alpha = 0.15f)
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = state.message,
            style = MaterialTheme.typography.bodySmall,
            color = Mist200,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun FullSyncCarouselScreen(state: FirstSyncUiState) {
    val backgroundGradient = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    val pagerState = rememberPagerState(pageCount = { firstSyncPages.size })

    // Auto-advance the carousel; a manual swipe changes settledPage and restarts the timer.
    LaunchedEffect(pagerState.settledPage) {
        delay(AUTO_ADVANCE_DELAY_MS)
        pagerState.animateScrollToPage((pagerState.settledPage + 1) % firstSyncPages.size)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundGradient)
            .padding(horizontal = 28.dp, vertical = 48.dp)
    ) {
        Text(
            text = "Getting everything ready",
            style = MaterialTheme.typography.headlineSmall,
            color = Mist100,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = "Your library is syncing — here's what Anime Ongaku can do.",
            style = MaterialTheme.typography.bodyMedium,
            color = Mist200
        )

        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) { pageIndex ->
            FirstSyncCarouselPage(firstSyncPages[pageIndex])
        }

        PageDots(
            pageCount = firstSyncPages.size,
            currentPage = pagerState.currentPage,
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .padding(bottom = 20.dp)
        )

        SyncStatusFooter(state)
    }
}

@Composable
private fun FirstSyncCarouselPage(page: FirstSyncPage) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(120.dp)
                .background(
                    Brush.radialGradient(
                        listOf(Rose500.copy(alpha = 0.3f), Rose500.copy(alpha = 0.06f))
                    ),
                    CircleShape
                )
                .border(1.dp, Rose500.copy(alpha = 0.35f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = page.icon,
                contentDescription = null,
                tint = Rose500,
                modifier = Modifier.size(64.dp)
            )
        }
        Spacer(Modifier.height(24.dp))
        Text(
            text = page.kicker.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = Ember400,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = page.title,
            style = MaterialTheme.typography.titleLarge,
            color = Mist100,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = page.body,
            style = MaterialTheme.typography.bodyMedium,
            color = Mist200,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun PageDots(pageCount: Int, currentPage: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(pageCount) { index ->
            val selected = index == currentPage
            val dotWidth by animateDpAsState(if (selected) 20.dp else 8.dp, label = "dotWidth")
            val dotColor by animateColorAsState(
                if (selected) Rose500 else Mist200.copy(alpha = 0.35f),
                label = "dotColor"
            )
            Box(
                modifier = Modifier
                    .height(8.dp)
                    .width(dotWidth)
                    .background(dotColor, RoundedCornerShape(50))
            )
        }
    }
}

@Composable
private fun SyncStatusFooter(state: FirstSyncUiState) {
    val stepProgress by animateFloatAsState(
        targetValue = state.stepNumber / state.totalSteps.toFloat(),
        label = "stepProgress"
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
            .border(1.dp, Mist200.copy(alpha = 0.12f), RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "Step ${state.stepNumber} of ${state.totalSteps}",
                style = MaterialTheme.typography.labelLarge,
                color = Rose500,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = state.stepTitle,
                style = MaterialTheme.typography.labelLarge,
                color = Mist100
            )
        }
        LinearProgressIndicator(
            progress = { stepProgress },
            modifier = Modifier.fillMaxWidth(),
            color = Rose500,
            trackColor = Mist200.copy(alpha = 0.15f)
        )
        Text(
            text = state.message,
            style = MaterialTheme.typography.bodySmall,
            color = Mist200
        )
    }
}
