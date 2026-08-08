package com.takeya.animeongaku.media

import com.takeya.animeongaku.data.local.AnimeEntity

enum class BluetoothMetadataStyle(val displayName: String, val description: String) {
    ANIME_THEME("Anime and theme", "Anime name as the title and the theme number as the artist."),
    SONG_ARTIST("Song and artist", "Song title and performing artist."),
    COMBINED("Anime, theme, and song", "Anime and theme first, with song and artist underneath.")
}

data class PlayerDisplayInfo(val primaryText: String, val secondaryText: String)

internal data class BluetoothDisplayInfo(val title: String, val artist: String?)

fun playerDisplayInfo(item: PlayableItem, animeFallback: AnimeEntity? = null): PlayerDisplayInfo {
    val animeName = item.display.animeTitle
        ?.takeIf(String::isNotBlank)
        ?: item.anime?.title?.takeIf(String::isNotBlank)
        ?: animeFallback?.title?.takeIf(String::isNotBlank)
    val themeLabel = (item as? PlayableItem.Theme)?.theme?.themeType.toThemeDisplayLabel()
    val songAndArtist = listOfNotNull(
        item.display.title.takeIf(String::isNotBlank),
        item.display.artist?.takeIf(String::isNotBlank)
    ).joinToString(" · ")
    val primary = when {
        animeName != null && themeLabel != null -> "$animeName · $themeLabel"
        animeName != null -> animeName
        themeLabel != null -> "$themeLabel · ${item.display.title}"
        else -> item.display.title
    }
    return PlayerDisplayInfo(primary, songAndArtist.ifBlank { item.display.title })
}

internal fun ResolvedPlaybackItem.bluetoothDisplayInfo(style: BluetoothMetadataStyle): BluetoothDisplayInfo {
    val anime = animeTitle?.takeIf(String::isNotBlank)
        ?: animeOrRelease?.takeIf(String::isNotBlank)
    val theme = themeLabel?.takeIf(String::isNotBlank)
    val song = title.takeIf(String::isNotBlank)
    val credit = listOfNotNull(song, artist?.takeIf(String::isNotBlank)).joinToString(" · ")
    return when (style) {
        BluetoothMetadataStyle.ANIME_THEME -> BluetoothDisplayInfo(
            title = anime ?: song ?: "Anime Ongaku",
            artist = theme ?: artist
        )
        BluetoothMetadataStyle.SONG_ARTIST -> BluetoothDisplayInfo(
            title = song ?: anime ?: "Anime Ongaku",
            artist = artist ?: theme
        )
        BluetoothMetadataStyle.COMBINED -> BluetoothDisplayInfo(
            title = listOfNotNull(anime, theme).joinToString(" · ").ifBlank { song ?: "Anime Ongaku" },
            artist = credit.ifBlank { theme.orEmpty() }.ifBlank { null }
        )
    }
}

internal fun String?.toThemeDisplayLabel(): String? {
    val raw = this?.trim()?.takeIf(String::isNotBlank) ?: return null
    val match = Regex("^(OP|ED)(\\d+)$", RegexOption.IGNORE_CASE).matchEntire(raw)
    return if (match == null) raw.uppercase() else {
        "${match.groupValues[1].uppercase()} ${match.groupValues[2]}"
    }
}
