package com.takeya.animeongaku.ui.sync

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudDownload
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun ImportScreen(
    onOpenPlayer: () -> Unit,
    viewModel: ImportViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle(initialValue = emptyList())

    val backgroundGradient = Brush.verticalGradient(
        listOf(
            Ink900,
            Ink800,
            Ink700
        )
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundGradient)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            item {
                HeaderSection(onOpenPlayer)
            }

            item {
                KitsuLoginCard(
                    uiState = uiState,
                    onUsernameChange = viewModel::onUsernameChange,
                    onPasswordChange = viewModel::onPasswordChange,
                    onFindUser = viewModel::findUser,
                    onSync = viewModel::syncLibrary
                )
            }

            item {
                StatusCard(uiState)
            }

            item {
                LibraryHeader(count = anime.size)
            }

            items(anime) { entry ->
                AnimeRow(entry)
            }

            item {
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun HeaderSection(onOpenPlayer: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "Import from Kitsu",
            style = MaterialTheme.typography.headlineSmall,
            color = Mist100
        )
        Text(
            text = "Sync your anime list and auto-build a library of OPs, EDs, and OSTs.",
            style = MaterialTheme.typography.bodyMedium,
            color = Mist200
        )
        Button(
            onClick = onOpenPlayer,
            colors = ButtonDefaults.buttonColors(containerColor = Ink800)
        ) {
            Icon(
                imageVector = Icons.Rounded.PlayArrow,
                contentDescription = null,
                tint = Mist100
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(text = "Open Player", color = Mist100)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KitsuLoginCard(
    uiState: ImportUiState,
    onUsernameChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onFindUser: () -> Unit,
    onSync: () -> Unit
) {
    val shape = RoundedCornerShape(24.dp)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.7f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.25f), shape)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Kitsu Access",
            style = MaterialTheme.typography.titleLarge,
            color = Mist100
        )
        Text(
            text = "Use public profiles or your login details to sync your watch list.",
            style = MaterialTheme.typography.bodyMedium,
            color = Mist200
        )
        OutlinedTextField(
            value = uiState.username,
            onValueChange = onUsernameChange,
            label = { Text("Kitsu username") },
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = uiState.password,
            onValueChange = onPasswordChange,
            label = { Text("Password (optional)") },
            modifier = Modifier.fillMaxWidth()
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Button(
                onClick = onFindUser,
                colors = ButtonDefaults.buttonColors(containerColor = Ink700)
            ) {
                Icon(imageVector = Icons.Rounded.Search, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = "Find User")
            }
            Button(
                onClick = onSync,
                colors = ButtonDefaults.buttonColors(containerColor = Rose500)
            ) {
                Icon(imageVector = Icons.Rounded.CloudDownload, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = "Sync Library")
            }
        }
    }
}

@Composable
private fun StatusCard(uiState: ImportUiState) {
    val shape = RoundedCornerShape(20.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.6f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.2f), shape)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (uiState.isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                color = Ember400,
                strokeWidth = 2.dp
            )
            Spacer(modifier = Modifier.width(12.dp))
        } else {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .background(Rose500, CircleShape)
            )
            Spacer(modifier = Modifier.width(12.dp))
        }

        Column {
            Text(
                text = uiState.status,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100
            )
            uiState.userId?.let { id ->
                Text(
                    text = "User ID: $id · Imported: ${uiState.lastSyncCount}",
                    style = MaterialTheme.typography.labelMedium,
                    color = Mist200
                )
            }
        }
    }
}

@Composable
private fun LibraryHeader(count: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom
    ) {
        Text(
            text = "Imported Anime",
            style = MaterialTheme.typography.titleLarge,
            color = Mist100
        )
        Text(
            text = "$count titles",
            style = MaterialTheme.typography.labelMedium,
            color = Mist200
        )
    }
}

@Composable
private fun AnimeRow(entry: AnimeEntity) {
    val shape = RoundedCornerShape(18.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.55f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.2f), shape)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .background(Color(0xFF2A2533), RoundedCornerShape(14.dp))
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.title ?: "Untitled",
                style = MaterialTheme.typography.bodyLarge,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "Kitsu #${entry.kitsuId}",
                style = MaterialTheme.typography.labelMedium,
                color = Mist200
            )
        }
        Text(
            text = "SYNCED",
            style = MaterialTheme.typography.labelMedium,
            color = Ember400,
            fontWeight = FontWeight.Bold
        )
    }
}
