package com.takeya.animeongaku.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.takeya.animeongaku.BuildConfig
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Plum500
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun AboutScreen(
    onBack: () -> Unit = {},
    viewModel: AboutViewModel = hiltViewModel()
) {
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
                "About",
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
            AboutHero()

            Spacer(modifier = Modifier.height(28.dp))

            SectionLabel("Build")
            InfoCard {
                InfoRow("Version", BuildConfig.DISPLAY_VERSION)
                InfoDivider()
                InfoRow("Version code", BuildConfig.VERSION_CODE.toString())
                InfoDivider()
                InfoRow("Build type", BuildConfig.BUILD_TYPE.replaceFirstChar { it.uppercase() })
                InfoDivider()
                InfoRow("Package", BuildConfig.APPLICATION_ID)
            }

            Spacer(modifier = Modifier.height(24.dp))

            SectionLabel("Server")
            InfoCard {
                InfoRow("Connected to", viewModel.serverBaseUrl, valueOnNewLine = true)
            }

            Spacer(modifier = Modifier.height(28.dp))

            Text(
                "Made with ♥ for anime music fans.",
                style = MaterialTheme.typography.bodySmall,
                color = Mist200.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
internal fun AboutHero() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(
                Brush.verticalGradient(
                    listOf(Rose500.copy(alpha = 0.22f), Plum500.copy(alpha = 0.08f), Ink800)
                )
            )
            .padding(vertical = 32.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Ink900),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Rounded.LibraryMusic,
                contentDescription = "Anime Ongaku",
                tint = Rose500,
                modifier = Modifier
                    .size(56.dp)
            )
        }
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            "Anime Ongaku",
            style = MaterialTheme.typography.headlineSmall,
            color = Mist100,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            "Opening & ending themes, on demand.",
            style = MaterialTheme.typography.bodyMedium,
            color = Mist200,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(14.dp))
        Text(
            "Version ${BuildConfig.DISPLAY_VERSION}",
            style = MaterialTheme.typography.labelMedium,
            color = Mist100,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(Rose500.copy(alpha = 0.18f))
                .padding(horizontal = 14.dp, vertical = 6.dp)
        )
    }
}

@Composable
private fun SectionLabel(title: String) {
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
private fun InfoCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Ink800)
            .padding(horizontal = 16.dp, vertical = 4.dp),
        content = content
    )
}

@Composable
private fun InfoRow(label: String, value: String, valueOnNewLine: Boolean = false) {
    if (valueOnNewLine) {
        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist200
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                value,
                style = MaterialTheme.typography.bodyLarge,
                color = Mist100,
                fontWeight = FontWeight.Medium
            )
        }
    } else {
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist200
            )
            Text(
                value,
                style = MaterialTheme.typography.bodyMedium,
                color = Mist100,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

@Composable
private fun InfoDivider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Mist200.copy(alpha = 0.08f))
    )
}
