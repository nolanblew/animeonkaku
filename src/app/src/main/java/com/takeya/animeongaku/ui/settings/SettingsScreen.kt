package com.takeya.animeongaku.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.RadioButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.BuildConfig
import com.takeya.animeongaku.media.BluetoothMetadataStyle
import com.takeya.animeongaku.ui.player.MiniPlayerHeight
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import com.takeya.animeongaku.updater.AvailableAppUpdate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit = {},
    onOpenImport: () -> Unit = {},
    onOpenDownloadManager: () -> Unit = {},
    updaterEnabled: Boolean = false,
    isCheckingForUpdates: Boolean = false,
    availableUpdate: AvailableAppUpdate? = null,
    onCheckForUpdates: () -> Unit = {},
    onDownloadUpdate: () -> Unit = {},
    onOpenReleasePage: () -> Unit = {},
    onOpenAbout: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val wifiOnly by viewModel.wifiOnly.collectAsStateWithLifecycle()
    val showOstsOnHome by viewModel.showOstsOnHome.collectAsStateWithLifecycle()
    val bluetoothMetadataStyle by viewModel.bluetoothMetadataStyle.collectAsStateWithLifecycle()
    var showBluetoothMetadataDialog by remember { mutableStateOf(false) }

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
                "Settings",
                style = MaterialTheme.typography.titleLarge,
                color = Mist100,
                fontWeight = FontWeight.Bold
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
        ) {
            // --- Account Section ---
            SectionHeader("Account")
            SettingsRow(
                icon = Icons.Rounded.CloudSync,
                title = "Kitsu Sync",
                subtitle = "Manage your Kitsu connection",
                onClick = onOpenImport
            )

            Spacer(modifier = Modifier.height(24.dp))

            SectionHeader("Home")
            SettingsToggleRow(
                icon = Icons.Rounded.Home,
                title = "Show OSTs on Home",
                subtitle = "Include soundtrack songs in Quick picks.",
                checked = showOstsOnHome,
                onCheckedChange = viewModel::setShowOstsOnHome
            )

            Spacer(modifier = Modifier.height(24.dp))

            SectionHeader("Playback")
            SettingsRow(
                icon = Icons.Rounded.Headphones,
                title = "Bluetooth display",
                subtitle = bluetoothMetadataStyle.displayName,
                onClick = { showBluetoothMetadataDialog = true }
            )

            Spacer(modifier = Modifier.height(24.dp))

            // --- Downloads Section ---
            SectionHeader("Downloads")
            SettingsRow(
                icon = Icons.Rounded.Download,
                title = "Manage Downloads",
                subtitle = "View and manage downloaded music",
                onClick = onOpenDownloadManager
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsToggleRow(
                icon = Icons.Rounded.Wifi,
                title = "Download over Wi-Fi only",
                subtitle = "Restrict downloads to Wi-Fi connections",
                checked = wifiOnly,
                onCheckedChange = { viewModel.setWifiOnly(it) }
            )

            Spacer(modifier = Modifier.height(24.dp))

            // --- Updates Section ---
            SectionHeader("Updates")
            if (updaterEnabled) {
                SettingsRow(
                    icon = Icons.Rounded.CloudSync,
                    title = if (isCheckingForUpdates) "Checking for updates..." else "Check for Update",
                    subtitle = availableUpdate?.let { "Version ${it.versionName} is available" }
                        ?: "Check GitHub Releases for a newer build",
                    onClick = onCheckForUpdates,
                    enabled = !isCheckingForUpdates
                )
                if (availableUpdate != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    SettingsRow(
                        icon = Icons.Rounded.Download,
                        title = "Download ${availableUpdate.versionName}",
                        subtitle = "Open the latest APK release",
                        onClick = onDownloadUpdate
                    )
                }
            } else {
                SettingsRow(
                    icon = Icons.Rounded.CloudSync,
                    title = "App Updates",
                    subtitle = "Automatic update checks are only enabled in release builds",
                    onClick = {},
                    enabled = false
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            SettingsRow(
                icon = Icons.Rounded.Info,
                title = "GitHub Releases",
                subtitle = "View release notes and published builds",
                onClick = onOpenReleasePage
            )

            Spacer(modifier = Modifier.height(24.dp))

            // --- About Section ---
            SectionHeader("About")
            SettingsRow(
                icon = Icons.Rounded.Info,
                title = "Anime Ongaku",
                subtitle = "Version ${BuildConfig.DISPLAY_VERSION}",
                onClick = onOpenAbout
            )

            Spacer(modifier = Modifier.height(MiniPlayerHeight + 32.dp))
        }
    }

    if (showBluetoothMetadataDialog) {
        BluetoothMetadataStyleDialog(
            selectedStyle = bluetoothMetadataStyle,
            onStyleSelected = { style ->
                viewModel.setBluetoothMetadataStyle(style)
                showBluetoothMetadataDialog = false
            },
            onDismiss = { showBluetoothMetadataDialog = false }
        )
    }
}

@Composable
internal fun BluetoothMetadataStyleDialog(
    selectedStyle: BluetoothMetadataStyle,
    onStyleSelected: (BluetoothMetadataStyle) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Bluetooth display") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                BluetoothMetadataStyle.entries.forEach { style ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onStyleSelected(style) }
                            .padding(vertical = 10.dp, horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = style == selectedStyle,
                            onClick = null
                        )
                        Column(modifier = Modifier.padding(start = 8.dp)) {
                            Text(style.displayName, fontWeight = FontWeight.SemiBold)
                            Text(style.description, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = Rose500,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.sp,
        modifier = Modifier.padding(bottom = 8.dp)
    )
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    enabled: Boolean = true
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Ink800)
            .then(
                if (enabled) {
                    Modifier.clickable(onClick = onClick)
                } else {
                    Modifier
                }
            )
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (enabled) Mist100 else Mist200.copy(alpha = 0.7f),
            modifier = Modifier.size(22.dp)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge,
                color = if (enabled) Mist100 else Mist200,
                fontWeight = FontWeight.Medium
            )
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = Mist200.copy(alpha = if (enabled) 1f else 0.75f)
            )
        }
        if (enabled) {
            Icon(
                Icons.AutoMirrored.Rounded.KeyboardArrowRight,
                contentDescription = null,
                tint = Mist200,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

@Composable
private fun SettingsToggleRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Ink800)
            .clickable { onCheckedChange(!checked) }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = Mist100,
            modifier = Modifier.size(22.dp)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge,
                color = Mist100,
                fontWeight = FontWeight.Medium
            )
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = Mist200
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Rose500,
                checkedTrackColor = Rose500.copy(alpha = 0.3f),
                uncheckedThumbColor = Mist200,
                uncheckedTrackColor = Ink700
            )
        )
    }
}
