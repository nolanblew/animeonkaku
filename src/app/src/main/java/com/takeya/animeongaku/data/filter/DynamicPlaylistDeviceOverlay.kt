package com.takeya.animeongaku.data.filter

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeGenreCrossRef
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.ThemeEntity
import java.time.LocalDate
import java.time.ZoneOffset

internal fun shouldApplyDynamicDeviceOverlay(
    spec: DynamicPlaylistSpecEntity?,
    filter: FilterNode?,
    sort: SortSpec
): Boolean =
    spec?.serverManaged == true &&
        spec.mode == "AUTO" &&
        (filter?.containsDownloadedPredicate() == true || sort.hasDownloadedSort())

internal fun applyDynamicDeviceOverlay(
    tracks: List<PlaylistTrack>,
    filter: FilterNode?,
    sort: SortSpec,
    context: EvaluationContext
): List<PlaylistTrack> {
    val filtered = if (filter?.containsDownloadedPredicate() == true) {
        tracks.filter { matchesOverlayFilter(filter, it.theme, context) }
    } else {
        tracks
    }
    return if (sort.hasDownloadedSort()) {
        val comparator = buildThemeComparator(sort, context)
        filtered.sortedWith { left, right -> comparator.compare(left.theme, right.theme) }
    } else {
        filtered
    }
}

internal fun buildDynamicOverlayContext(
    tracks: List<PlaylistTrack>,
    anime: List<AnimeEntity>,
    genreRefs: List<AnimeGenreCrossRef>,
    likedThemeIds: Set<Long>,
    dislikedThemeIds: Set<Long>,
    downloadedThemeIds: Set<Long>,
    playCounts: List<PlayCountEntity>,
    nowMillis: Long = System.currentTimeMillis()
): EvaluationContext =
    EvaluationContext(
        themes = tracks.map { it.theme },
        animeByThemesId = anime.mapNotNull { entry ->
            entry.animeThemesId?.let { it to entry }
        }.toMap(),
        animeByKitsuId = anime.associateBy { it.kitsuId },
        genresByKitsuId = genreRefs
            .groupBy { it.kitsuId }
            .mapValues { (_, refs) -> refs.map { it.slug }.toSet() },
        likedThemeIds = likedThemeIds,
        dislikedThemeIds = dislikedThemeIds,
        downloadedThemeIds = downloadedThemeIds,
        playCountByTheme = playCounts.associate { it.themeId to it.playCount },
        lastPlayedByTheme = playCounts.associate { it.themeId to it.lastPlayedAt },
        nowMillis = nowMillis
    )

internal fun FilterNode.containsDownloadedPredicate(): Boolean =
    when (this) {
        is FilterNode.And -> children.any { it.containsDownloadedPredicate() }
        is FilterNode.Or -> children.any { it.containsDownloadedPredicate() }
        is FilterNode.Not -> child.containsDownloadedPredicate()
        is FilterNode.Downloaded -> true
        else -> false
    }

internal fun SortSpec.hasDownloadedSort(): Boolean =
    keys.any { it.attribute == SortAttribute.DOWNLOADED }

@Suppress("DEPRECATION")
private fun matchesOverlayFilter(node: FilterNode, theme: ThemeEntity, ctx: EvaluationContext): Boolean {
    val anime = theme.animeId?.let { ctx.animeByThemesId[it] }
    val animeKitsuId = anime?.kitsuId
    return when (node) {
        is FilterNode.And -> node.children.isEmpty() || node.children.all { matchesOverlayFilter(it, theme, ctx) }
        is FilterNode.Or -> node.children.isNotEmpty() && node.children.any { matchesOverlayFilter(it, theme, ctx) }
        is FilterNode.Not -> !matchesOverlayFilter(node.child, theme, ctx)
        is FilterNode.GenreIn -> {
            if (animeKitsuId == null) return false
            val genreSlugs = ctx.genresByKitsuId[animeKitsuId] ?: return false
            if (node.matchAll) node.slugs.all { it in genreSlugs } else node.slugs.any { it in genreSlugs }
        }
        is FilterNode.AiredOn -> {
            val year = anime?.startDate?.take(4)?.toIntOrNull() ?: return false
            val anchorYear = resolveOverlayYear(node.anchor, ctx.nowMillis)
            when (node.operator) {
                DateOperator.GT -> year >= anchorYear
                DateOperator.LT -> year < anchorYear
                DateOperator.BETWEEN -> {
                    val endYear = node.endAnchor?.let { resolveOverlayYear(it, ctx.nowMillis) } ?: anchorYear
                    year in minOf(anchorYear, endYear)..maxOf(anchorYear, endYear)
                }
            }
        }
        is FilterNode.AiredBefore -> {
            val year = anime?.startDate?.take(4)?.toIntOrNull() ?: return false
            year < node.year
        }
        is FilterNode.AiredAfter -> {
            val year = anime?.startDate?.take(4)?.toIntOrNull() ?: return false
            year >= node.year
        }
        is FilterNode.AiredBetween -> {
            val year = anime?.startDate?.take(4)?.toIntOrNull() ?: return false
            year in node.minYear..node.maxYear
        }
        is FilterNode.SeasonIn -> {
            val month = anime?.startDate?.drop(5)?.take(2)?.toIntOrNull() ?: return false
            val season = overlayMonthToSeason(month) ?: return false
            season in node.seasons
        }
        is FilterNode.SubtypeIn -> {
            val subtype = anime?.subtype ?: return false
            subtype.lowercase() in node.subtypes.map { it.lowercase() }
        }
        is FilterNode.AverageRatingGte -> {
            val rating = anime?.averageRating ?: return false
            rating >= node.min
        }
        is FilterNode.UserRatingGte -> {
            val rating = anime?.userRating ?: return false
            rating >= node.min
        }
        is FilterNode.WatchingStatusIn -> {
            val status = anime?.watchingStatus ?: return false
            status in node.statuses
        }
        is FilterNode.WatchedOn -> {
            val updatedAt = anime?.libraryUpdatedAt ?: return false
            val anchorMillis = resolveOverlayMillis(node.anchor, ctx.nowMillis)
            when (node.operator) {
                DateOperator.GT -> updatedAt > anchorMillis
                DateOperator.LT -> updatedAt < anchorMillis
                DateOperator.BETWEEN -> {
                    val endMillis = node.endAnchor?.let { resolveOverlayMillis(it, ctx.nowMillis) } ?: anchorMillis
                    updatedAt in minOf(anchorMillis, endMillis)..maxOf(anchorMillis, endMillis)
                }
            }
        }
        is FilterNode.LibraryUpdatedAfter -> {
            val updatedAt = anime?.libraryUpdatedAt ?: return false
            updatedAt > node.epochMillis
        }
        is FilterNode.LibraryUpdatedWithin -> {
            val updatedAt = anime?.libraryUpdatedAt ?: return false
            updatedAt > (ctx.nowMillis - node.durationMillis)
        }
        is FilterNode.ThemeTypeIn -> {
            val type = theme.themeType?.uppercase() ?: return false
            node.types.any { prefix -> type.startsWith(prefix.uppercase()) }
        }
        is FilterNode.ArtistIn -> {
            val artistName = theme.artistName ?: return false
            node.artistNames.any { artistName.contains(it, ignoreCase = true) }
        }
        is FilterNode.TitleMatches -> {
            val title = anime?.title ?: return false
            matchesOverlayPattern(title, node.pattern, node.isRegex)
        }
        is FilterNode.SongTitleMatches ->
            matchesOverlayPattern(theme.title, node.pattern, node.isRegex)
        is FilterNode.Liked -> theme.id in ctx.likedThemeIds
        is FilterNode.Disliked -> theme.id in ctx.dislikedThemeIds
        is FilterNode.Downloaded -> theme.id in ctx.downloadedThemeIds
        is FilterNode.PlayCountGte -> (ctx.playCountByTheme[theme.id] ?: 0) >= node.min
        is FilterNode.PlayedOn -> {
            val lastPlayed = ctx.lastPlayedByTheme[theme.id] ?: return false
            val anchorMillis = resolveOverlayMillis(node.anchor, ctx.nowMillis)
            when (node.operator) {
                DateOperator.GT -> lastPlayed >= anchorMillis
                DateOperator.LT -> lastPlayed < anchorMillis
                DateOperator.BETWEEN -> {
                    val endMillis = node.endAnchor?.let { resolveOverlayMillis(it, ctx.nowMillis) } ?: anchorMillis
                    lastPlayed in minOf(anchorMillis, endMillis)..maxOf(anchorMillis, endMillis)
                }
            }
        }
        is FilterNode.PlayedSince -> {
            val lastPlayed = ctx.lastPlayedByTheme[theme.id] ?: return false
            lastPlayed >= node.epochMillis
        }
    }
}

private fun resolveOverlayYear(anchor: DateAnchor, nowMillis: Long): Int =
    when (anchor) {
        is DateAnchor.AbsoluteYear -> anchor.year
        is DateAnchor.Relative -> {
            val now = LocalDate.ofEpochDay(nowMillis / 86_400_000L)
            when (anchor.unit) {
                DateUnit.DAYS -> now.minusDays(anchor.amount.toLong())
                DateUnit.MONTHS -> now.minusMonths(anchor.amount.toLong())
                DateUnit.YEARS -> now.minusYears(anchor.amount.toLong())
            }.year
        }
    }

private fun resolveOverlayMillis(anchor: DateAnchor, nowMillis: Long): Long =
    when (anchor) {
        is DateAnchor.AbsoluteYear -> LocalDate.of(anchor.year, 1, 1)
            .atStartOfDay(ZoneOffset.UTC)
            .toInstant()
            .toEpochMilli()
        is DateAnchor.Relative -> {
            val now = LocalDate.ofEpochDay(nowMillis / 86_400_000L)
            when (anchor.unit) {
                DateUnit.DAYS -> now.minusDays(anchor.amount.toLong())
                DateUnit.MONTHS -> now.minusMonths(anchor.amount.toLong())
                DateUnit.YEARS -> now.minusYears(anchor.amount.toLong())
            }.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        }
    }

private fun matchesOverlayPattern(text: String, pattern: String, isRegex: Boolean): Boolean {
    if (pattern.isBlank()) return true
    return if (isRegex) {
        runCatching { Regex(pattern).containsMatchIn(text) }.getOrElse { false }
    } else {
        text.contains(pattern, ignoreCase = true)
    }
}

private fun overlayMonthToSeason(month: Int): Season? =
    when (month) {
        1, 2, 3 -> Season.WINTER
        4, 5, 6 -> Season.SPRING
        7, 8, 9 -> Season.SUMMER
        10, 11, 12 -> Season.FALL
        else -> null
    }
