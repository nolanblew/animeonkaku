package com.takeya.animeongaku.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Rose500,
    secondary = Ember400,
    tertiary = Gold400,
    background = Ink900,
    surface = Ink800,
    surfaceVariant = Ink700,
    onPrimary = Ink900,
    onSecondary = Ink900,
    onTertiary = Ink900,
    onBackground = Mist100,
    onSurface = Mist100,
    onSurfaceVariant = Mist200,
    outline = Mist200
)

private val LightColorScheme = lightColorScheme(
    primary = Plum500,
    secondary = Rose500,
    tertiary = Ember400,
    background = Mist100,
    surface = Color(0xFFF6F4FA),
    surfaceVariant = Color(0xFFE5E1EC),
    onPrimary = Ink900,
    onSecondary = Ink900,
    onTertiary = Ink900,
    onBackground = Ink900,
    onSurface = Ink900,
    onSurfaceVariant = Ink700,
    outline = Ink700
)

@Composable
fun AnimeOngakuTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
