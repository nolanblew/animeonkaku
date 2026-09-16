package com.takeya.animeongaku.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.data.local.primaryArtworkUrls

@Composable
fun TopPicksScreen(
    filter: String?,
    onBack: () -> Unit,
    onPlayTheme: () -> Unit,
    viewModel: TopPicksViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val includeExtras by viewModel.showOstsOnHome.collectAsStateWithLifecycle()
    LaunchedEffect(filter, includeExtras) { viewModel.load(filter, includeExtras) }
    val background = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    Box(Modifier.fillMaxSize().background(background)) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "Back",
                        style = MaterialTheme.typography.labelLarge,
                        color = Mist200,
                        modifier = Modifier.clickable(onClick = onBack)
                    )
                    Text("Top picks", style = MaterialTheme.typography.titleLarge, color = Mist100)
                    val canPlay = state.snapshot?.let { snapshot ->
                        snapshot.items.isNotEmpty() && snapshot.items.size >= minOf(snapshot.response.total, 60)
                    } == true && !state.isLoading
                    Button(
                        onClick = { if (viewModel.play()) onPlayTheme() },
                        enabled = canPlay
                    ) {
                        Text("Play")
                    }
                }
            }
            state.error?.let { message ->
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            message,
                            color = Mist200,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f)
                        )
                        Button(onClick = { viewModel.retry() }) {
                            Text("Retry")
                        }
                    }
                }
            }
            if (state.isLoading && state.snapshot == null) {
                item {
                    CircularProgressIndicator(color = Mist100)
                }
            }
            itemsIndexed(
                items = state.snapshot?.items.orEmpty(),
                key = { _, pick -> pick.key }
            ) { index, pick ->
                val item = pick.item
                QuickPickRow(
                    item = item,
                    imageUrls = listOfNotNull(item.display.artworkUrl) + item.anime?.primaryArtworkUrls().orEmpty(),
                    onPlay = {
                        if (viewModel.playItem(index)) onPlayTheme()
                    }
                )
            }
            if (!state.isLoading && state.error == null && state.snapshot?.items?.isEmpty() == true) {
                item {
                    Text(
                        "No top picks are available yet. Sync your library and try again.",
                        color = Mist200,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp)
                    )
                }
            }
            item { Spacer(Modifier.height(96.dp)) }
        }
    }
}
