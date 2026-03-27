package com.takeya.animeongaku.ui.common

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FeaturedPlaylistCard(
    title: String,
    subtitle: String,
    coverUrls: List<List<String>>,
    gradientSeed: Int,
    isAutoPlaylist: Boolean = false,
    onClick: () -> Unit = {},
    onLongClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .background(Ink800.copy(alpha = 0.6f), RoundedCornerShape(18.dp))
            .border(1.dp, Mist200.copy(alpha = 0.2f), RoundedCornerShape(18.dp))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(12.dp)
    ) {
        PlaylistCoverArt(
            coverUrlGroups = coverUrls,
            gradientSeed = gradientSeed,
            size = 136.dp,
            cornerRadius = 14.dp
        )
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = title,
            color = Mist100,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth()
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = subtitle, style = MaterialTheme.typography.labelMedium, color = Mist200)
            if (isAutoPlaylist) {
                Icon(
                    imageVector = Icons.Rounded.AutoAwesome,
                    contentDescription = "Auto Playlist",
                    tint = Mist200,
                    modifier = Modifier.size(14.dp)
                )
            }
        }
    }
}

@Composable
fun FeaturedPlaylistRow(
    playlists: List<PlaylistWithCount>,
    coverUrlsMap: Map<Long, List<List<String>>>,
    onOpenPlaylist: (Long) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        playlists.chunked(2).forEach { rowPlaylists ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                rowPlaylists.forEach { item ->
                    FeaturedPlaylistCard(
                        title = item.playlist.name,
                        subtitle = "${item.trackCount} tracks",
                        coverUrls = coverUrlsMap[item.playlist.id] ?: emptyList(),
                        gradientSeed = item.playlist.gradientSeed,
                        isAutoPlaylist = item.playlist.isAuto,
                        onClick = { onOpenPlaylist(item.playlist.id) },
                        modifier = Modifier.weight(1f)
                    )
                }
                if (rowPlaylists.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}
