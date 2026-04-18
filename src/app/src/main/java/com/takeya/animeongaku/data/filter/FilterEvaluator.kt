package com.takeya.animeongaku.data.filter

import android.util.Log
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.GenreDao
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.UserPreferenceDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneOffset
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FilterEvaluator @Inject constructor(
    private val animeDao: AnimeDao,
    private val themeDao: ThemeDao,
    private val genreDao: GenreDao,
    private val userPreferenceDao: UserPreferenceDao,
    private val playCountDao: PlayCountDao,
    private val downloadDao: DownloadDao
) {
    companion object {
        private const val TAG = "FilterEvaluator"
    }

    /** Returns ordered list of themeIds matching the filter, using the provided sort spec. */
    suspend fun evaluate(
        filter: FilterNode,
        sort: SortSpec = SortSpec.DEFAULT
    ): List<Long> = withContext(Dispatchers.IO) {
        val start = System.currentTimeMillis()
        val ctx = loadContext()
        val comparator = buildComparator(sort, ctx)
        val result = ctx.themes
            .filter { theme -> matches(filter, theme, ctx) }
            .sortedWith(comparator)
            .map { it.id }
        Log.d(TAG, "Evaluated filter in ${System.currentTimeMillis() - start}ms -> ${result.size} tracks")
        result
    }

    /** Cheap count without building the full result list. */
    suspend fun count(filter: FilterNode): Int = withContext(Dispatchers.IO) {
        val ctx = loadContext()
        ctx.themes.count { theme -> matches(filter, theme, ctx) }
    }

    private suspend fun loadContext(): EvaluationContext {
        val themes = themeDao.getAllThemes()
        val animeList = animeDao.getAllAnime()
        val crossRefs = genreDao.getAllCrossRefs()
        val likedIds = userPreferenceDao.getLikedThemeIds().toSet()
        val dislikedIds = userPreferenceDao.getDislikedThemeIds().toSet()
        val downloadedIds = downloadDao.getCompletedThemeIds().toSet()
        val playCounts = playCountDao.getAllPlayCounts()

        val animeByThemesId = animeList
            .filter { it.animeThemesId != null }
            .associateBy { it.animeThemesId!! }
        val animeByKitsuId = animeList.associateBy { it.kitsuId }
        val genresByKitsuId: Map<String, Set<String>> = crossRefs
            .groupBy { it.kitsuId }
            .mapValues { (_, refs) -> refs.map { it.slug }.toSet() }

        return EvaluationContext(
            themes = themes,
            animeByThemesId = animeByThemesId,
            animeByKitsuId = animeByKitsuId,
            genresByKitsuId = genresByKitsuId,
            likedThemeIds = likedIds,
            dislikedThemeIds = dislikedIds,
            downloadedThemeIds = downloadedIds,
            playCountByTheme = playCounts.associate { it.themeId to it.playCount },
            lastPlayedByTheme = playCounts.associate { it.themeId to it.lastPlayedAt },
            nowMillis = System.currentTimeMillis()
        )
    }

    @Suppress("DEPRECATION")
    internal fun matches(node: FilterNode, theme: ThemeEntity, ctx: EvaluationContext): Boolean {
        val anime: AnimeEntity? = theme.animeId?.let { ctx.animeByThemesId[it] }
        val animeKitsuId: String? = anime?.kitsuId
        return when (node) {
            is FilterNode.And -> node.children.isEmpty() || node.children.all { matches(it, theme, ctx) }
            is FilterNode.Or -> node.children.isNotEmpty() && node.children.any { matches(it, theme, ctx) }
            is FilterNode.Not -> !matches(node.child, theme, ctx)

            is FilterNode.GenreIn -> {
                if (animeKitsuId == null) return false
                val genreSlugs = ctx.genresByKitsuId[animeKitsuId] ?: return false
                if (node.matchAll) node.slugs.all { it in genreSlugs }
                else node.slugs.any { it in genreSlugs }
            }
            is FilterNode.AiredOn -> {
                val year = anime?.startDate?.take(4)?.toIntOrNull() ?: return false
                val anchorYear = resolveYear(node.anchor, ctx.nowMillis)
                when (node.operator) {
                    DateOperator.GT -> year >= anchorYear
                    DateOperator.LT -> year < anchorYear
                    DateOperator.BETWEEN -> {
                        val endYear = node.endAnchor?.let { resolveYear(it, ctx.nowMillis) } ?: anchorYear
                        year in minOf(anchorYear, endYear)..maxOf(anchorYear, endYear)
                    }
                }
            }
            // Legacy aired nodes — delegate to AiredOn semantics
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
                val season = monthToSeason(month) ?: return false
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
                val anchorMillis = resolveMillis(node.anchor, ctx.nowMillis)
                when (node.operator) {
                    DateOperator.GT -> updatedAt > anchorMillis
                    DateOperator.LT -> updatedAt < anchorMillis
                    DateOperator.BETWEEN -> {
                        val endMillis = node.endAnchor?.let { resolveMillis(it, ctx.nowMillis) } ?: anchorMillis
                        updatedAt in minOf(anchorMillis, endMillis)..maxOf(anchorMillis, endMillis)
                    }
                }
            }
            // Legacy library nodes
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
                node.artistNames.any { name ->
                    artistName.contains(name, ignoreCase = true)
                }
            }
            is FilterNode.TitleMatches -> {
                val title = anime?.title ?: return false
                matchesPattern(title, node.pattern, node.isRegex)
            }
            is FilterNode.SongTitleMatches -> {
                val songTitle = theme.title ?: return false
                matchesPattern(songTitle, node.pattern, node.isRegex)
            }
            is FilterNode.Liked -> theme.id in ctx.likedThemeIds
            is FilterNode.Disliked -> theme.id in ctx.dislikedThemeIds
            is FilterNode.Downloaded -> theme.id in ctx.downloadedThemeIds
            is FilterNode.PlayCountGte -> {
                val count = ctx.playCountByTheme[theme.id] ?: 0
                count >= node.min
            }
            is FilterNode.PlayedOn -> {
                val lastPlayed = ctx.lastPlayedByTheme[theme.id] ?: return false
                val anchorMillis = resolveMillis(node.anchor, ctx.nowMillis)
                when (node.operator) {
                    DateOperator.GT -> lastPlayed >= anchorMillis
                    DateOperator.LT -> lastPlayed < anchorMillis
                    DateOperator.BETWEEN -> {
                        val endMillis = node.endAnchor?.let { resolveMillis(it, ctx.nowMillis) } ?: anchorMillis
                        lastPlayed in minOf(anchorMillis, endMillis)..maxOf(anchorMillis, endMillis)
                    }
                }
            }
            // Legacy played node
            is FilterNode.PlayedSince -> {
                val lastPlayed = ctx.lastPlayedByTheme[theme.id] ?: return false
                lastPlayed >= node.epochMillis
            }
        }
    }

    private fun buildComparator(sort: SortSpec, ctx: EvaluationContext): Comparator<ThemeEntity> =
        buildThemeComparator(sort, ctx)

    private fun monthToSeason(month: Int): Season? = when (month) {
        1, 2, 3 -> Season.WINTER
        4, 5, 6 -> Season.SPRING
        7, 8, 9 -> Season.SUMMER
        10, 11, 12 -> Season.FALL
        else -> null
    }

    private fun resolveYear(anchor: DateAnchor, nowMillis: Long): Int = when (anchor) {
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

    private fun resolveMillis(anchor: DateAnchor, nowMillis: Long): Long = when (anchor) {
        is DateAnchor.AbsoluteYear -> LocalDate.of(anchor.year, 1, 1)
            .atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        is DateAnchor.Relative -> {
            val now = LocalDate.ofEpochDay(nowMillis / 86_400_000L)
            when (anchor.unit) {
                DateUnit.DAYS -> now.minusDays(anchor.amount.toLong())
                DateUnit.MONTHS -> now.minusMonths(anchor.amount.toLong())
                DateUnit.YEARS -> now.minusYears(anchor.amount.toLong())
            }.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        }
    }

    private fun matchesPattern(text: String, pattern: String, isRegex: Boolean): Boolean {
        if (pattern.isBlank()) return true
        return if (isRegex) {
            runCatching { Regex(pattern).containsMatchIn(text) }.getOrElse { false }
        } else {
            text.contains(pattern, ignoreCase = true)
        }
    }
}
