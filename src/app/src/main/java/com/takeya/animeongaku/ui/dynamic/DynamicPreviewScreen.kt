package com.takeya.animeongaku.ui.dynamic

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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DynamicPreviewScreen(
    onPlaylistCreated: (Long) -> Unit,
    onBack: () -> Unit,
    viewModel: DynamicPlaylistDraftViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val preview by viewModel.previewResult.collectAsStateWithLifecycle()
    val coroutineScope = rememberCoroutineScope()
    var isSaving by remember { mutableStateOf(false) }

    val backgroundBrush = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(brush = backgroundBrush)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Header row
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.Rounded.ArrowBack,
                        contentDescription = "Back",
                        tint = Mist100
                    )
                }
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "New Smart Playlist",
                    color = Mist100,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            // Cover art mosaic
            CoverArtMosaic(tracks = preview.tracks)

            // Track count
            Text(
                text = "${preview.count} tracks",
                color = Mist200,
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )

            // Playlist name field
            OutlinedTextField(
                value = state.draftName,
                onValueChange = viewModel::setDraftName,
                label = { Text("Playlist name", color = Mist200) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Rose500,
                    unfocusedBorderColor = Mist200,
                    focusedTextColor = Mist100,
                    unfocusedTextColor = Mist100,
                    cursorColor = Rose500
                )
            )

            // Save mode selection
            SaveModeSelector(
                selectedMode = state.saveMode,
                onModeSelected = viewModel::setSaveMode
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Create Playlist button
            Button(
                onClick = {
                    if (isSaving) return@Button
                    isSaving = true
                    viewModel.savePlaylist()
                        .onEach { newId -> onPlaylistCreated(newId) }
                        .launchIn(coroutineScope)
                },
                enabled = !isSaving,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Rose500,
                    disabledContainerColor = Ink700
                )
            ) {
                if (isSaving) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Mist100,
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(
                    text = if (isSaving) "Creating..." else "Create Playlist",
                    color = if (isSaving) Mist200 else Color.White,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

// ---------------------------------------------------------------------------
// Cover art mosaic (first 3 thumbnails + overflow badge)
// ---------------------------------------------------------------------------

@Composable
private fun CoverArtMosaic(tracks: List<PlaylistTrack>) {
    // Tile colors used as placeholders since PlaylistTrack doesn't carry anime cover art.
    // Up to 3 distinct color tiles are shown, plus an overflow badge.
    val tileColors = listOf(
        Color(0xFF2A1520),
        Color(0xFF1A1F30),
        Color(0xFF1A2A20)
    )

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        val tileCount = minOf(tracks.size, 3)
        val overflow = (tracks.size - 3).coerceAtLeast(0)

        repeat(tileCount) { index ->
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(tileColors[index % tileColors.size]),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "♪",
                    color = Rose500,
                    fontSize = 24.sp
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
        }

        if (overflow > 0) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Ink700)
                    .border(1.dp, Mist200, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "+$overflow",
                    color = Mist100,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Save mode selector
// ---------------------------------------------------------------------------

@Composable
private fun SaveModeSelector(
    selectedMode: String,
    onModeSelected: (String) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "Update behavior",
            color = Mist100,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp
        )
        listOf(
            Triple("AUTO", "Auto-updating", "Tracks are refreshed automatically as your library changes."),
            Triple("SNAPSHOT", "Snapshot", "Locked to the tracks matching today. Won't change over time.")
        ).forEach { (mode, title, description) ->
            val selected = selectedMode == mode
            Card(
                onClick = { onModeSelected(mode) },
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (selected) Color(0xFF2A1520) else Color(0xFF181820)
                ),
                shape = RoundedCornerShape(12.dp),
                border = if (selected) {
                    androidx.compose.foundation.BorderStroke(1.dp, Rose500)
                } else null
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = title,
                            color = if (selected) Rose500 else Mist100,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = description,
                            color = Mist200,
                            fontSize = 13.sp
                        )
                    }
                    if (selected) {
                        Spacer(modifier = Modifier.width(12.dp))
                        Box(
                            modifier = Modifier
                                .size(20.dp)
                                .background(Rose500, RoundedCornerShape(10.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("✓", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
