package com.takeya.animeongaku.data.filter

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity

/**
 * All data needed to evaluate a [FilterNode] tree, loaded once per evaluation pass.
 * Keys in maps use the same ID type as the table they correspond to.
 *
 * Null-handling contract:
 *   - Positive leaf predicates over a nullable field: null -> no match.
 *   - [FilterNode.Not] over a null-field predicate: null -> match.
 */
data class EvaluationContext(
    /** All themes from the library */
    val themes: List<ThemeEntity>,
    /** Anime keyed by animeThemesId (Long) — same FK used in ThemeEntity.animeId */
    val animeByThemesId: Map<Long, AnimeEntity>,
    /** Anime keyed by kitsuId (String) — needed for genre lookups */
    val animeByKitsuId: Map<String, AnimeEntity>,
    /** Genre slugs per anime, keyed by kitsuId */
    val genresByKitsuId: Map<String, Set<String>>,
    val likedThemeIds: Set<Long>,
    val dislikedThemeIds: Set<Long>,
    val downloadedThemeIds: Set<Long>,
    /** playCount keyed by themeId */
    val playCountByTheme: Map<Long, Int>,
    /** lastPlayedAt epoch millis, keyed by themeId */
    val lastPlayedByTheme: Map<Long, Long>,
    /** Current time in epoch millis — used for relative time filters */
    val nowMillis: Long
)
