package com.takeya.animeongaku.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.common.displayInfo
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun ArtistDetailScreen(
    onBack: () -> Unit,
    onPlayTheme: (Long) -> Unit,
    viewModel: ArtistDetailViewModel = hiltViewModel()
) {
    val themes by viewModel.themes.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle()
    val artistImageUrl by viewModel.artistImageUrl.collectAsStateWithLifecycle()
    val artistName = viewModel.artistName
    val background = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    val animeByThemesId = remember(anime) {
        anime.mapNotNull { entry -> entry.animeThemesId?.let { id -> id to entry } }.toMap()
    }
    val artistAnime = remember(themes, animeByThemesId) {
        themes.mapNotNull { it.animeId?.let { id -> animeByThemesId[id] } }.distinctBy { it.kitsuId }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(background)
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            // Hero header
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(260.dp)
                        .background(
                            Brush.verticalGradient(
                                listOf(Rose500.copy(alpha = 0.25f), Ink900)
                            )
                        )
                ) {
                    IconButton(
                        onClick = onBack,
                        modifier = Modifier
                            .padding(8.dp)
                            .align(Alignment.TopStart)
                    ) {
                        Icon(
                            Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                            contentDescription = "Back",
                            tint = Mist100
                        )
                    }
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(top = 32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(
                            modifier = Modifier
                                .size(100.dp)
                                .clip(CircleShape)
                                .background(
                                    Brush.linearGradient(listOf(Rose500.copy(alpha = 0.4f), Ink800)),
                                    CircleShape
                                )
                                .border(2.dp, Mist200.copy(alpha = 0.2f), CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            if (!artistImageUrl.isNullOrBlank()) {
                                AsyncImage(
                                    model = artistImageUrl,
                                    contentDescription = artistName,
                                    modifier = Modifier.matchParentSize().clip(CircleShape),
                                    contentScale = ContentScale.Crop
                                )
                            } else {
                                Text(
                                    text = artistName.take(2).uppercase(),
                                    style = MaterialTheme.typography.headlineMedium,
                                    color = Mist100.copy(alpha = 0.6f)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = artistName,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            color = Mist100,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 32.dp)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${themes.size} songs · ${artistAnime.size} anime",
                            style = MaterialTheme.typography.labelMedium,
                            color = Mist200
                        )
                    }
                }
            }

            // Play / Shuffle
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = { themes.firstOrNull()?.let { onPlayTheme(it.id) } },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Rose500),
                        shape = RoundedCornerShape(12.dp),
                        enabled = themes.isNotEmpty()
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Play")
                    }
                    Button(
                        onClick = { themes.randomOrNull()?.let { onPlayTheme(it.id) } },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Ink800),
                        shape = RoundedCornerShape(12.dp),
                        enabled = themes.isNotEmpty()
                    ) {
                        Icon(Icons.Rounded.Shuffle, contentDescription = null, modifier = Modifier.size(20.dp), tint = Mist100)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Shuffle", color = Mist100)
                    }
                }
            }

            // Songs section
            item {
                Text(
                    text = "Songs",
                    style = MaterialTheme.typography.titleMedium,
                    color = Mist100,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                )
            }

            if (themes.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                            .background(Ink800.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
                            .padding(20.dp)
                    ) {
                        Text(
                            text = "No songs found for this artist.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Mist200
                        )
                    }
                }
            } else {
                itemsIndexed(themes) { index, theme ->
                    val animeEntry = theme.animeId?.let { animeByThemesId[it] }
                    val imageUrl = animeEntry?.coverUrl ?: animeEntry?.thumbnailUrl
                    ArtistSongRow(
                        index = index + 1,
                        theme = theme,
                        anime = animeEntry,
                        imageUrl = imageUrl,
                        onPlay = { onPlayTheme(theme.id) }
                    )
                }
            }

            // Anime section
            if (artistAnime.isNotEmpty()) {
                item {
                    Text(
                        text = "Appears In",
                        style = MaterialTheme.typography.titleMedium,
                        color = Mist100,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)
                    )
                }
                items(artistAnime) { animeEntity ->
                    AnimeRow(
                        anime = animeEntity,
                        songCount = themes.count { it.animeId == animeEntity.animeThemesId }
                    )
                }
            }

            item {
                Spacer(modifier = Modifier.height(90.dp))
            }
        }
    }
}

@Composable
private fun ArtistSongRow(index: Int, theme: ThemeEntity, anime: AnimeEntity?, imageUrl: String?, onPlay: () -> Unit) {
    val info = theme.displayInfo(anime)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onPlay() }
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "$index",
            style = MaterialTheme.typography.labelMedium,
            color = Mist200,
            modifier = Modifier.width(24.dp)
        )
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Rose500.copy(alpha = 0.15f))
        ) {
            if (!imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = info.primaryText,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = info.secondaryText,
                style = MaterialTheme.typography.labelSmall,
                color = Mist200
            )
        }
    }
}

@Composable
private fun AnimeRow(anime: AnimeEntity, songCount: Int) {
    val coverUrl = anime.coverUrl ?: anime.thumbnailUrl
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(50.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Ember400.copy(alpha = 0.15f))
        ) {
            if (!coverUrl.isNullOrBlank()) {
                AsyncImage(
                    model = coverUrl,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = anime.title ?: "Unknown",
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = if (songCount == 1) "1 song" else "$songCount songs",
                style = MaterialTheme.typography.labelSmall,
                color = Mist200
            )
        }
    }
}
