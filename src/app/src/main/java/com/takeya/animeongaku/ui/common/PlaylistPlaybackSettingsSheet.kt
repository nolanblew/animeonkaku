package com.takeya.animeongaku.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaylistPlaybackSettingsSheet(
    selectedMode: String,
    overrideUserPreference: Boolean,
    onModeSelected: (String) -> Unit,
    onOverrideChanged: (Boolean) -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Ink900,
        dragHandle = null
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Playlist settings",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = Mist100,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Rounded.Close, contentDescription = "Close", tint = Mist200)
                }
            }
            Text("Preferred version", style = MaterialTheme.typography.labelLarge, color = Mist100)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("TV_SIZE" to "TV Size", "FULL_SIZE" to "Full Size").forEach { (mode, label) ->
                    val selected = selectedMode == mode
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .clickable { onModeSelected(mode) },
                        shape = RoundedCornerShape(12.dp),
                        color = if (selected) Color(0xFF2A1520) else Ink700,
                        border = if (selected) BorderStroke(1.dp, Rose500) else null
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 14.dp),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            if (selected) Icon(Icons.Rounded.Check, null, tint = Rose500)
                            Text(
                                text = label,
                                color = if (selected) Rose500 else Mist100,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }
            }
            Text(
                text = "Used for playback and downloads when an allowed version is available.",
                style = MaterialTheme.typography.bodySmall,
                color = Mist200
            )
            HorizontalDivider(color = Mist200.copy(alpha = 0.12f))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOverrideChanged(!overrideUserPreference) }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Override song preferences", color = Mist100, fontWeight = FontWeight.Medium)
                    Text(
                        "Use the playlist choice instead of a song's saved TV/Full preference. Disliked versions are always excluded.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Mist200
                    )
                }
                Switch(
                    checked = overrideUserPreference,
                    onCheckedChange = onOverrideChanged,
                    modifier = Modifier.semantics { contentDescription = "Override song preferences" }
                )
            }
        }
    }
}
