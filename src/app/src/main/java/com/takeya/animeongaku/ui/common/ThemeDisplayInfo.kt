package com.takeya.animeongaku.ui.common

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity

data class ThemeDisplayInfo(
    val primaryText: String,
    val secondaryText: String
)

fun ThemeEntity.displayInfo(anime: AnimeEntity? = null): ThemeDisplayInfo {
    val animeName = anime?.title
    val typeTag = themeType

    val primary = when {
        !animeName.isNullOrBlank() && !typeTag.isNullOrBlank() -> "$animeName · $typeTag"
        !animeName.isNullOrBlank() -> animeName
        !typeTag.isNullOrBlank() -> "$typeTag · $title"
        else -> title
    }

    val secondary = when {
        !artistName.isNullOrBlank() -> "$title · $artistName"
        else -> title
    }

    return ThemeDisplayInfo(primaryText = primary, secondaryText = secondary)
}

fun themeDisplayInfo(
    title: String,
    artistName: String?,
    themeType: String?,
    animeName: String?
): ThemeDisplayInfo {
    val primary = when {
        !animeName.isNullOrBlank() && !themeType.isNullOrBlank() -> "$animeName · $themeType"
        !animeName.isNullOrBlank() -> animeName
        !themeType.isNullOrBlank() -> "$themeType · $title"
        else -> title
    }

    val secondary = when {
        !artistName.isNullOrBlank() -> "$title · $artistName"
        else -> title
    }

    return ThemeDisplayInfo(primaryText = primary, secondaryText = secondary)
}
