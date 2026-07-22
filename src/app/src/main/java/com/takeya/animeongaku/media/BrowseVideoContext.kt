package com.takeya.animeongaku.media

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity

/** Replaces playback with a temporary Video-preferred context; it never persists Video policy. */
fun NowPlayingManager.playVideoContext(
    contextLabel: String,
    themes: List<ThemeEntity>,
    modesByThemeId: Map<Long, ThemeModeEntity>,
    startIndex: Int = 0,
    animeMap: Map<Long, AnimeEntity> = emptyMap()
) {
    playItems(
        contextLabel = contextLabel,
        items = themes.map { theme ->
            PlayableItem.Theme(
                theme = theme,
                anime = theme.animeId?.let(animeMap::get),
                modeDescriptor = modesByThemeId[theme.id]
            )
        },
        startIndex = startIndex,
        animeMap = animeMap,
        initialSessionMode = PlaybackMode.VIDEO
    )
}
