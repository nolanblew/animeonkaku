package com.takeya.animeongaku.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun PendingSyncBanner(
    message: String,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Ink800.copy(alpha = 0.72f), RoundedCornerShape(12.dp))
            .border(1.dp, Rose500.copy(alpha = 0.28f), RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp)
    ) {
        Text(
            text = "Playlist sync",
            style = MaterialTheme.typography.labelMedium,
            color = Rose500,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = Mist100
        )
        Text(
            text = "You can keep editing; changes are kept locally until they sync.",
            style = MaterialTheme.typography.labelSmall,
            color = Mist200
        )
    }
}
