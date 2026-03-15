package com.takeya.animeongaku.ui.sync

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Scaffold
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
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
    onBack: () -> Unit = {},
    viewModel: ImportViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val anime by viewModel.anime.collectAsStateWithLifecycle(initialValue = emptyList())
    val showResyncConfirmation by viewModel.showResyncConfirmation.collectAsStateWithLifecycle()

    // Request notification permission on Android 13+ before starting sync
    val notifPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* granted or not, proceed with sync regardless */ }
    val requestNotifPermission: () -> Unit = {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            notifPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    if (showResyncConfirmation) {
        ResyncConfirmationDialog(
            onDismiss = viewModel::dismissResyncConfirmation,
            onConfirm = {
                requestNotifPermission()
                viewModel.confirmForceFullSync()
            }
        )
    }

    val backgroundGradient = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundGradient)
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                ImportTopBar(
                    onBack = onBack,
                    isLinked = uiState.isLinked,
                    onForceResync = viewModel::requestForceFullSync,
                    onUnlink = viewModel::unlinkAccount
                )
            }
        ) { padding ->
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    HeaderSection()
                }

                item {
                    val syncWithPermission: () -> Unit = {
                        requestNotifPermission()
                        viewModel.syncLibrary()
                    }
                    if (uiState.isLinked) {
                        LinkedAccountCard(
                            uiState = uiState,
                            onSync = syncWithPermission
                        )
                    } else {
                        SignInCard(
                            uiState = uiState,
                            onUsernameChange = viewModel::onUsernameChange,
                            onPasswordChange = viewModel::onPasswordChange,
                            onSignIn = syncWithPermission
                        )
                    }
                }

                item {
                    StatusCard(uiState)
                }

                item {
                    ProgressCard(uiState)
                }

                if (uiState.isLoading) {
                    item {
                        SyncControlsRow(
                            isPaused = uiState.isPaused,
                            onPause = viewModel::pauseSync,
                            onResume = viewModel::resumeSync,
                            onCancel = viewModel::cancelSync
                        )
                    }
                }

                if (uiState.unmatchedAnime.isNotEmpty()) {
                    item {
                        UnmatchedAnimeCard(uiState.unmatchedAnime)
                    }
                }

                if (anime.isNotEmpty()) {
                    item {
                        LibraryHeader(count = anime.size)
                    }

                    items(anime) { entry ->
                        AnimeRow(entry)
                    }
                }

                item {
                    Spacer(modifier = Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun ImportTopBar(
    onBack: () -> Unit,
    isLinked: Boolean,
    onForceResync: () -> Unit,
    onUnlink: () -> Unit
) {
    var showMenu by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack) {
            Icon(
                imageVector = Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                contentDescription = "Back",
                tint = Mist100
            )
        }
        Text(
            text = "Kitsu Sync",
            style = MaterialTheme.typography.titleMedium,
            color = Mist100,
            modifier = Modifier.weight(1f)
        )
        if (isLinked) {
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(
                        imageVector = Icons.Rounded.MoreVert,
                        contentDescription = "More options",
                        tint = Mist200
                    )
                }
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Re-sync all") },
                        onClick = { showMenu = false; onForceResync() },
                        leadingIcon = { Icon(Icons.Rounded.Refresh, contentDescription = null) }
                    )
                    DropdownMenuItem(
                        text = { Text("Unlink account", color = Rose500) },
                        onClick = { showMenu = false; onUnlink() },
                        leadingIcon = { Icon(Icons.Rounded.LinkOff, contentDescription = null, tint = Rose500) }
                    )
                }
            }
        }
    }
}

@Composable
private fun HeaderSection() {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
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
    }
}

@Composable
private fun LinkedAccountCard(
    uiState: ImportUiState,
    onSync: () -> Unit
) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(Ember400.copy(alpha = 0.2f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = (uiState.linkedUsername ?: "?").take(1).uppercase(),
                    style = MaterialTheme.typography.titleMedium,
                    color = Ember400
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = uiState.linkedUsername ?: "Kitsu Account",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Mist100
                )
                Text(
                    text = "Linked account",
                    style = MaterialTheme.typography.labelSmall,
                    color = Mist200
                )
            }
        }
        Button(
            onClick = onSync,
            enabled = !uiState.isLoading,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(
                containerColor = Rose500,
                disabledContainerColor = Rose500.copy(alpha = 0.4f)
            )
        ) {
            if (uiState.isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    color = Ink900,
                    strokeWidth = 2.dp
                )
            } else {
                Icon(
                    imageVector = Icons.Rounded.CloudSync,
                    contentDescription = null,
                    tint = Ink900
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(text = "Sync Library")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SignInCard(
    uiState: ImportUiState,
    onUsernameChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSignIn: () -> Unit
) {
    val shape = RoundedCornerShape(16.dp)
    val isLoading = uiState.isLoading
    val canSignIn = !isLoading && uiState.username.isNotBlank() && uiState.password.isNotBlank()
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val textFieldColors = TextFieldDefaults.colors(
        focusedTextColor = Mist100,
        unfocusedTextColor = Mist100,
        disabledTextColor = Mist200,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        disabledContainerColor = Color.Transparent,
        focusedIndicatorColor = Rose500,
        unfocusedIndicatorColor = Mist200.copy(alpha = 0.5f),
        disabledIndicatorColor = Mist200.copy(alpha = 0.3f),
        focusedLabelColor = Mist200,
        unfocusedLabelColor = Mist200,
        disabledLabelColor = Mist200.copy(alpha = 0.5f),
        cursorColor = Rose500
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = "Sign in to Kitsu",
            style = MaterialTheme.typography.titleMedium,
            color = Mist100
        )
        Text(
            text = "Enter your Kitsu email and password to link your account.",
            style = MaterialTheme.typography.bodySmall,
            color = Mist200
        )
        OutlinedTextField(
            value = uiState.username,
            onValueChange = onUsernameChange,
            label = { Text("Email or username") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            maxLines = 1,
            textStyle = LocalTextStyle.current.copy(color = Mist100),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next
            ),
            colors = textFieldColors
        )
        OutlinedTextField(
            value = uiState.password,
            onValueChange = onPasswordChange,
            label = { Text("Password") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            maxLines = 1,
            textStyle = LocalTextStyle.current.copy(color = Mist100),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done
            ),
            keyboardActions = KeyboardActions(
                onDone = {
                    focusManager.clearFocus(force = true)
                    keyboardController?.hide()
                    onSignIn()
                }
            ),
            colors = textFieldColors
        )
        Button(
            onClick = {
                focusManager.clearFocus(force = true)
                keyboardController?.hide()
                onSignIn()
            },
            enabled = canSignIn,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(
                containerColor = Rose500,
                disabledContainerColor = Rose500.copy(alpha = 0.4f)
            )
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    color = Ink900,
                    strokeWidth = 2.dp
                )
            } else {
                Icon(
                    imageVector = Icons.Rounded.CloudSync,
                    contentDescription = null,
                    tint = Ink900
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(text = "Sign In & Sync")
        }
    }
}

@Composable
private fun StatusCard(uiState: ImportUiState) {
    val shape = RoundedCornerShape(14.dp)
    val isError = uiState.syncPhase == ImportSyncPhase.Error
    val statusColor = if (isError) Rose500 else Mist100
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape)
            .padding(12.dp),
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
                    .background(if (isError) Rose500 else Ember400, CircleShape)
            )
            Spacer(modifier = Modifier.width(12.dp))
        }

        Column {
            Text(
                text = uiState.status,
                style = MaterialTheme.typography.bodyMedium,
                color = statusColor
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
private fun ProgressCard(uiState: ImportUiState) {
    if (uiState.syncPhase == ImportSyncPhase.Idle) return

    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = when (uiState.syncPhase) {
                ImportSyncPhase.SyncingLibrary -> "Syncing library"
                ImportSyncPhase.MappingThemes -> "Mapping themes"
                ImportSyncPhase.FallbackSearch -> "Searching unmatched anime"
                ImportSyncPhase.Saving -> "Saving"
                ImportSyncPhase.Done -> "Sync complete"
                ImportSyncPhase.Error -> "Sync error"
                ImportSyncPhase.Idle -> "Idle"
            },
            style = MaterialTheme.typography.titleLarge,
            color = Mist100
        )

        uiState.libraryProgress?.let { progress ->
            ProgressSection(
                title = "Kitsu pages",
                subtitle = buildString {
                    append("Page ${progress.page}")
                    progress.totalPages?.let { append(" / $it") }
                    progress.totalCount?.let { append(" · ${progress.fetchedCount} / $it") }
                },
                progressValue = progress.totalCount?.let { total ->
                    if (total == 0) 0f else progress.fetchedCount / total.toFloat()
                }
            )
        }

        uiState.themeProgress?.let { progress ->
            ProgressSection(
                title = "AnimeThemes mapping",
                subtitle = "Batch ${progress.batchIndex} / ${progress.totalBatches} · ${progress.themesCount} themes",
                progressValue = if (progress.totalBatches == 0) 0f else progress.batchIndex / progress.totalBatches.toFloat()
            )
        }

        if (uiState.syncPhase == ImportSyncPhase.FallbackSearch && uiState.fallbackTotal > 0) {
            ProgressSection(
                title = "Fallback title search",
                subtitle = "${uiState.fallbackCurrent} / ${uiState.fallbackTotal} anime",
                progressValue = uiState.fallbackCurrent / uiState.fallbackTotal.toFloat()
            )
        }

        if (uiState.libraryProgress == null && uiState.themeProgress == null
            && uiState.syncPhase != ImportSyncPhase.FallbackSearch && uiState.isLoading) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = Ember400
            )
        }
    }
}

@Composable
private fun ProgressSection(
    title: String,
    subtitle: String,
    progressValue: Float?
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(text = title, style = MaterialTheme.typography.bodyLarge, color = Mist100)
        Text(text = subtitle, style = MaterialTheme.typography.labelMedium, color = Mist200)
        if (progressValue == null) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Ember400)
        } else {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                progress = { progressValue.coerceIn(0f, 1f) },
                color = Ember400,
                trackColor = Ink700
            )
        }
    }
}

@Composable
private fun SyncControlsRow(
    isPaused: Boolean,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onCancel: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)
    ) {
        Button(
            onClick = if (isPaused) onResume else onPause,
            colors = ButtonDefaults.buttonColors(
                containerColor = Mist200.copy(alpha = 0.15f),
                contentColor = Mist100
            )
        ) {
            Text(if (isPaused) "Resume" else "Pause")
        }
        Button(
            onClick = onCancel,
            colors = ButtonDefaults.buttonColors(
                containerColor = Rose500.copy(alpha = 0.15f),
                contentColor = Rose500
            )
        ) {
            Text("Stop")
        }
    }
}

@Composable
private fun UnmatchedAnimeCard(unmatchedAnime: List<String>) {
    val shape = RoundedCornerShape(14.dp)
    var expanded by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Rose500.copy(alpha = 0.10f), shape)
            .border(1.dp, Rose500.copy(alpha = 0.3f), shape)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "Could not match ${unmatchedAnime.size} anime",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = Rose500
        )
        Text(
            text = "These anime were not found on AnimeThemes.moe and will show 0 themes.",
            style = MaterialTheme.typography.labelSmall,
            color = Mist200
        )
        val displayList = if (expanded) unmatchedAnime else unmatchedAnime.take(3)
        displayList.forEach { name ->
            Text(
                text = "• $name",
                style = MaterialTheme.typography.bodySmall,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        if (unmatchedAnime.size > 3) {
            Text(
                text = if (expanded) "Show less" else "Show all ${unmatchedAnime.size}…",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                color = Rose500,
                modifier = Modifier
                    .clickable { expanded = !expanded }
                    .padding(vertical = 2.dp)
            )
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
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.5f), shape)
            .border(1.dp, Mist200.copy(alpha = 0.12f), shape)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(Color(0xFF2A2533), RoundedCornerShape(10.dp))
        ) {
            val imageUrl = entry.coverUrl ?: entry.thumbnailUrl
            if (!imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = imageUrl,
                    contentDescription = null,
                    modifier = Modifier.matchParentSize(),
                    contentScale = ContentScale.Crop
                )
            }
        }
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.title ?: "Untitled",
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "Kitsu #${entry.kitsuId}",
                style = MaterialTheme.typography.labelSmall,
                color = Mist200
            )
        }
        Text(
            text = "SYNCED",
            style = MaterialTheme.typography.labelSmall,
            color = Ember400,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun ResyncConfirmationDialog(
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        val shape = RoundedCornerShape(20.dp)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Ink800, shape)
                .border(1.dp, Mist200.copy(alpha = 0.15f), shape)
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Re-sync entire library?",
                style = MaterialTheme.typography.titleLarge,
                color = Mist100,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "This will re-import your full Kitsu library and refresh all themes, " +
                    "including new openings and endings for currently airing anime.\n\n" +
                    "Anime removed from your Kitsu library will be removed unless they " +
                    "were manually added or are in one of your playlists.\n\n" +
                    "Your listening history and play counts will be preserved.",
                style = MaterialTheme.typography.bodyMedium,
                color = Mist200,
                lineHeight = MaterialTheme.typography.bodyMedium.lineHeight
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End)
            ) {
                Button(
                    onClick = onDismiss,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Mist200.copy(alpha = 0.12f),
                        contentColor = Mist100
                    )
                ) {
                    Text("Cancel")
                }
                Button(
                    onClick = onConfirm,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Rose500,
                        contentColor = Ink900
                    )
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Refresh,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Re-sync")
                }
            }
        }
    }
}
