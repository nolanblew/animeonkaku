package com.takeya.animeongaku.ui.settings

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.Error
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlaylistPlay
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.data.local.DownloadGroupEntity
import com.takeya.animeongaku.data.local.DownloadRequestEntity
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun DownloadManagerScreen(
    onBack: () -> Unit = {},
    viewModel: DownloadManagerViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showRemoveAllDialog by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Ink900)
    ) {
        // Top bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                    contentDescription = "Back",
                    tint = Mist100,
                    modifier = Modifier.size(28.dp)
                )
            }
            Text(
                "Downloads",
                style = MaterialTheme.typography.titleLarge,
                color = Mist100,
                fontWeight = FontWeight.Bold
            )
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Storage info card
            item {
                StorageCard(
                    usedBytes = state.totalSize,
                    freeBytes = state.freeSpace,
                    totalBytes = state.totalSpace
                )
            }

            // Active downloads section
            val activeDownloads = state.downloads.filter {
                it.status in listOf(
                    DownloadRequestEntity.STATUS_PENDING,
                    DownloadRequestEntity.STATUS_DOWNLOADING,
                    DownloadRequestEntity.STATUS_WAITING_FOR_WIFI
                )
            }
            if (activeDownloads.isNotEmpty()) {
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    SectionLabel("Active Downloads")
                }
                item {
                    ActiveDownloadsCard(
                        activeDownloads = activeDownloads,
                        completedCount = state.batchCompletedCount,
                        totalCount = state.batchTotalCount,
                        onPauseAll = { viewModel.pauseAll() },
                        onResumeAll = { viewModel.resumeAll() },
                        onCancelAll = { viewModel.cancelAll() }
                    )
                }
            }

            // Failed downloads
            val failedDownloads = state.downloads.filter { it.status == DownloadRequestEntity.STATUS_FAILED }
            if (failedDownloads.isNotEmpty()) {
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        SectionLabel("Failed (${failedDownloads.size})")
                        TextButton(onClick = { viewModel.retryFailed() }) {
                            Icon(
                                Icons.Rounded.Refresh,
                                contentDescription = null,
                                tint = Rose500,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Retry All", color = Rose500, fontSize = 13.sp)
                        }
                    }
                }
            }

            // Paused downloads
            val pausedDownloads = state.downloads.filter { it.status == DownloadRequestEntity.STATUS_PAUSED }
            if (pausedDownloads.isNotEmpty()) {
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        SectionLabel("Paused (${pausedDownloads.size})")
                        TextButton(onClick = { viewModel.resumeAll() }) {
                            Icon(
                                Icons.Rounded.PlayArrow,
                                contentDescription = null,
                                tint = Rose500,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Resume All", color = Rose500, fontSize = 13.sp)
                        }
                    }
                }
            }

            // Downloaded content - grouped
            val animeGroups = state.groups.filter { it.groupType == DownloadGroupEntity.TYPE_ANIME }
            val playlistGroups = state.groups.filter { it.groupType == DownloadGroupEntity.TYPE_PLAYLIST }
            val singleGroups = state.groups.filter { it.groupType == DownloadGroupEntity.TYPE_SINGLE }

            if (animeGroups.isNotEmpty()) {
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    SectionLabel("Anime")
                }
                items(animeGroups, key = { "anime_${it.id}" }) { group ->
                    val groupDownloads = state.downloads.filter { dl ->
                        // We show the group as a unit
                        true
                    }
                    DownloadGroupRow(
                        group = group,
                        icon = Icons.Rounded.Album,
                        onRemove = { viewModel.removeGroup(group) }
                    )
                }
            }

            if (playlistGroups.isNotEmpty()) {
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    SectionLabel("Playlists")
                }
                items(playlistGroups, key = { "playlist_${it.id}" }) { group ->
                    DownloadGroupRow(
                        group = group,
                        icon = Icons.Rounded.PlaylistPlay,
                        onRemove = { viewModel.removeGroup(group) }
                    )
                }
            }

            if (singleGroups.isNotEmpty()) {
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    SectionLabel("Songs")
                }
                items(singleGroups, key = { "single_${it.id}" }) { group ->
                    DownloadGroupRow(
                        group = group,
                        icon = Icons.Rounded.MusicNote,
                        onRemove = { viewModel.removeGroup(group) }
                    )
                }
            }

            // Remove all button
            if (state.downloads.isNotEmpty()) {
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = { showRemoveAllDialog = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Rose500.copy(alpha = 0.15f),
                            contentColor = Rose500
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(
                            Icons.Rounded.DeleteSweep,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Remove All Downloads", fontWeight = FontWeight.Medium)
                    }
                    Spacer(modifier = Modifier.height(32.dp))
                }
            }

            // Empty state
            if (state.downloads.isEmpty()) {
                item {
                    Spacer(modifier = Modifier.height(48.dp))
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.Rounded.MusicNote,
                            contentDescription = null,
                            tint = Mist200.copy(alpha = 0.4f),
                            modifier = Modifier.size(48.dp)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            "No downloads yet",
                            style = MaterialTheme.typography.bodyLarge,
                            color = Mist200
                        )
                        Text(
                            "Download songs, anime, or playlists to listen offline",
                            style = MaterialTheme.typography.bodySmall,
                            color = Mist200.copy(alpha = 0.6f)
                        )
                    }
                }
            }
        }
    }

    // Remove all confirmation dialog
    if (showRemoveAllDialog) {
        AlertDialog(
            onDismissRequest = { showRemoveAllDialog = false },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.removeAllDownloads()
                    showRemoveAllDialog = false
                }) {
                    Text("Remove All", color = Rose500)
                }
            },
            dismissButton = {
                TextButton(onClick = { showRemoveAllDialog = false }) {
                    Text("Cancel", color = Mist200)
                }
            },
            title = { Text("Remove All Downloads?", color = Mist100) },
            text = {
                Text(
                    "This will delete all downloaded music from your device. You can re-download them anytime.",
                    color = Mist200
                )
            },
            containerColor = Ink800,
            shape = RoundedCornerShape(20.dp)
        )
    }
}

@Composable
private fun StorageCard(usedBytes: Long, freeBytes: Long, totalBytes: Long) {
    val usedMB = usedBytes / (1024.0 * 1024.0)
    val freeMB = freeBytes / (1024.0 * 1024.0)
    val fraction = if (totalBytes > 0) usedBytes.toFloat() / totalBytes.toFloat() else 0f

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Ink800)
            .padding(16.dp)
    ) {
        Text(
            "Storage",
            style = MaterialTheme.typography.titleSmall,
            color = Mist100,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(12.dp))

        LinearProgressIndicator(
            progress = { fraction.coerceIn(0f, 1f) },
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp)),
            color = Rose500,
            trackColor = Ink700,
            strokeCap = StrokeCap.Round
        )

        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                formatSize(usedBytes) + " used",
                style = MaterialTheme.typography.bodySmall,
                color = Rose500
            )
            Text(
                formatSize(freeBytes) + " free",
                style = MaterialTheme.typography.bodySmall,
                color = Mist200
            )
        }
    }
}

@Composable
private fun ActiveDownloadsCard(
    activeDownloads: List<DownloadRequestEntity>,
    completedCount: Int,
    totalCount: Int,
    onPauseAll: () -> Unit,
    onResumeAll: () -> Unit,
    onCancelAll: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Ink800)
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = Rose500,
                    strokeWidth = 2.dp
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "$completedCount / $totalCount downloaded",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Mist100,
                    fontWeight = FontWeight.Medium
                )
            }
            Row {
                IconButton(onClick = onPauseAll, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Rounded.Pause, contentDescription = "Pause All", tint = Mist200, modifier = Modifier.size(18.dp))
                }
                IconButton(onClick = onCancelAll, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Rounded.Cancel, contentDescription = "Cancel All", tint = Mist200, modifier = Modifier.size(18.dp))
                }
            }
        }

        // Show individual progress for actively downloading items (exclude 100% — those are finishing up)
        val inProgress = activeDownloads.filter {
            it.status == DownloadRequestEntity.STATUS_DOWNLOADING && it.progress < 100
        }
        for (dl in inProgress.take(3)) {
            Spacer(modifier = Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                LinearProgressIndicator(
                    progress = { dl.progress / 100f },
                    modifier = Modifier
                        .weight(1f)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    color = Rose500,
                    trackColor = Ink700,
                    strokeCap = StrokeCap.Round
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "${dl.progress}%",
                    style = MaterialTheme.typography.labelSmall,
                    color = Mist200
                )
            }
        }

        // Items finishing up (100% downloaded but not yet marked completed)
        val finishingUp = activeDownloads.filter {
            it.status == DownloadRequestEntity.STATUS_DOWNLOADING && it.progress >= 100
        }
        if (finishingUp.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "${finishingUp.size} finishing up\u2026",
                style = MaterialTheme.typography.bodySmall,
                color = Mist200
            )
        }

        // Pending (waiting to start)
        val pending = activeDownloads.filter { it.status == DownloadRequestEntity.STATUS_PENDING }
        if (pending.isNotEmpty()) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                "${pending.size} queued",
                style = MaterialTheme.typography.bodySmall,
                color = Mist200
            )
        }

        val waitingForWifi = activeDownloads.filter { it.status == DownloadRequestEntity.STATUS_WAITING_FOR_WIFI }
        if (waitingForWifi.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Rounded.WifiOff,
                    contentDescription = null,
                    tint = Ember400,
                    modifier = Modifier.size(14.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    "${waitingForWifi.size} waiting for Wi-Fi",
                    style = MaterialTheme.typography.bodySmall,
                    color = Ember400
                )
            }
        }
    }
}

@Composable
private fun DownloadGroupRow(
    group: DownloadGroupEntity,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onRemove: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Ink800)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Ink700),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = Mist200,
                modifier = Modifier.size(20.dp)
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                group.label,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                fontWeight = FontWeight.Medium,
                maxLines = 1
            )
            Text(
                when (group.groupType) {
                    DownloadGroupEntity.TYPE_ANIME -> "Anime"
                    DownloadGroupEntity.TYPE_PLAYLIST -> "Playlist"
                    else -> "Song"
                },
                style = MaterialTheme.typography.bodySmall,
                color = Mist200
            )
        }
        IconButton(onClick = onRemove, modifier = Modifier.size(36.dp)) {
            Icon(
                Icons.Rounded.Delete,
                contentDescription = "Remove",
                tint = Mist200,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = Mist100,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(bottom = 4.dp)
    )
}

private fun formatSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "%.1f KB".format(bytes / 1024.0)
        bytes < 1024 * 1024 * 1024 -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
        else -> "%.2f GB".format(bytes / (1024.0 * 1024.0 * 1024.0))
    }
}
