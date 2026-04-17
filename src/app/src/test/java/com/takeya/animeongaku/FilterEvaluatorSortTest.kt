package com.takeya.animeongaku

import com.takeya.animeongaku.data.filter.EvaluationContext
import com.takeya.animeongaku.data.filter.SortAttribute
import com.takeya.animeongaku.data.filter.SortDirection
import com.takeya.animeongaku.data.filter.SortKey
import com.takeya.animeongaku.data.filter.SortSpec
import com.takeya.animeongaku.data.filter.buildThemeComparator
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterEvaluatorSortTest {

    private fun theme(
        id: Long,
        title: String = "Song $id",
        animeId: Long? = null,
        artist: String? = null,
        themeType: String? = null
    ) = ThemeEntity(
        id = id,
        animeId = animeId,
        title = title,
        artistName = artist,
        audioUrl = "https://example.com/$id.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null,
        themeType = themeType
    )

    private fun anime(
        kitsuId: String,
        animeThemesId: Long?,
        title: String? = null,
        startDate: String? = null,
        libraryUpdatedAt: Long? = null,
        averageRating: Double? = null,
        userRating: Double? = null
    ) = AnimeEntity(
        kitsuId = kitsuId,
        animeThemesId = animeThemesId,
        title = title,
        thumbnailUrl = null,
        coverUrl = null,
        syncedAt = 0,
        startDate = startDate,
        libraryUpdatedAt = libraryUpdatedAt,
        averageRating = averageRating,
        userRating = userRating
    )

    private fun ctx(
        themes: List<ThemeEntity>,
        anime: List<AnimeEntity> = emptyList(),
        liked: Set<Long> = emptySet(),
        downloaded: Set<Long> = emptySet(),
        playCounts: Map<Long, Int> = emptyMap(),
        lastPlayed: Map<Long, Long> = emptyMap(),
        nowMillis: Long = 1_700_000_000_000L
    ) = EvaluationContext(
        themes = themes,
        animeByThemesId = anime.filter { it.animeThemesId != null }.associateBy { it.animeThemesId!! },
        animeByKitsuId = anime.associateBy { it.kitsuId },
        genresByKitsuId = emptyMap(),
        likedThemeIds = liked,
        dislikedThemeIds = emptySet(),
        downloadedThemeIds = downloaded,
        playCountByTheme = playCounts,
        lastPlayedByTheme = lastPlayed,
        nowMillis = nowMillis
    )

    private fun List<ThemeEntity>.sortedBy(spec: SortSpec, context: EvaluationContext): List<Long> =
        sortedWith(buildThemeComparator(spec, context)).map { it.id }

    @Test
    fun `default sort orders by watched desc then title asc`() {
        val animeA = anime("a", 10L, title = "A", libraryUpdatedAt = 100L)
        val animeB = anime("b", 20L, title = "B", libraryUpdatedAt = 200L)
        val animeC = anime("c", 30L, title = "C", libraryUpdatedAt = 200L)
        val t1 = theme(1, title = "Beta", animeId = 10L)  // watched = 100
        val t2 = theme(2, title = "Alpha", animeId = 20L) // watched = 200
        val t3 = theme(3, title = "Beta", animeId = 30L)  // watched = 200 — tied with t2

        val context = ctx(listOf(t1, t2, t3), anime = listOf(animeA, animeB, animeC))
        val ordered = listOf(t1, t2, t3).sortedBy(SortSpec.DEFAULT, context)

        // Newest first (200), tiebreaker = title asc -> Alpha (t2) before Beta (t3), then watched=100 -> t1
        assertEquals(listOf(2L, 3L, 1L), ordered)
    }

    @Test
    fun `null watched dates sort last regardless of direction`() {
        val withDate = anime("a", 10L, libraryUpdatedAt = 500L)
        val withoutDate = anime("b", 20L, libraryUpdatedAt = null)
        val t1 = theme(1, animeId = 10L)
        val t2 = theme(2, animeId = 20L)
        val context = ctx(listOf(t1, t2), anime = listOf(withDate, withoutDate))

        val desc = SortSpec(listOf(SortKey(SortAttribute.WATCHED_DATE, SortDirection.DESC)))
        val asc = SortSpec(listOf(SortKey(SortAttribute.WATCHED_DATE, SortDirection.ASC)))

        // Non-null always wins over null, regardless of direction.
        assertEquals(listOf(1L, 2L), listOf(t2, t1).sortedBy(desc, context))
        assertEquals(listOf(1L, 2L), listOf(t2, t1).sortedBy(asc, context))
    }

    @Test
    fun `string sort is case insensitive`() {
        val t1 = theme(1, title = "alpha")
        val t2 = theme(2, title = "Bravo")
        val t3 = theme(3, title = "Charlie")
        val context = ctx(listOf(t1, t2, t3))
        val spec = SortSpec(listOf(SortKey(SortAttribute.TITLE, SortDirection.ASC)))

        val ordered = listOf(t3, t1, t2).sortedBy(spec, context)
        assertEquals(listOf(1L, 2L, 3L), ordered)
    }

    @Test
    fun `descending title reverses ascending`() {
        val t1 = theme(1, title = "alpha")
        val t2 = theme(2, title = "Bravo")
        val context = ctx(listOf(t1, t2))
        val asc = SortSpec(listOf(SortKey(SortAttribute.TITLE, SortDirection.ASC)))
        val desc = SortSpec(listOf(SortKey(SortAttribute.TITLE, SortDirection.DESC)))

        assertEquals(listOf(1L, 2L), listOf(t1, t2).sortedBy(asc, context))
        assertEquals(listOf(2L, 1L), listOf(t1, t2).sortedBy(desc, context))
    }

    @Test
    fun `theme type orders by rank then sequence ascending`() {
        val t1 = theme(1, themeType = "ED1")
        val t2 = theme(2, themeType = "OP2")
        val t3 = theme(3, themeType = "OP1")
        val t4 = theme(4, themeType = "IN1")
        val context = ctx(listOf(t1, t2, t3, t4))
        val spec = SortSpec(listOf(SortKey(SortAttribute.THEME_TYPE, SortDirection.ASC)))

        val ordered = listOf(t1, t2, t3, t4).sortedBy(spec, context)
        assertEquals(listOf(3L, 2L, 4L, 1L), ordered) // OP1, OP2, IN1, ED1
    }

    @Test
    fun `multi key tiebreaking uses later keys only for equal earlier values`() {
        val animeA = anime("a", 10L, libraryUpdatedAt = 500L)
        val animeB = anime("b", 20L, libraryUpdatedAt = 500L)
        val animeC = anime("c", 30L, libraryUpdatedAt = 100L)
        val t1 = theme(1, title = "Z", animeId = 10L)
        val t2 = theme(2, title = "A", animeId = 20L)
        val t3 = theme(3, title = "M", animeId = 30L)
        val context = ctx(listOf(t1, t2, t3), anime = listOf(animeA, animeB, animeC))
        val spec = SortSpec(
            listOf(
                SortKey(SortAttribute.WATCHED_DATE, SortDirection.DESC),
                SortKey(SortAttribute.TITLE, SortDirection.ASC)
            )
        )

        // Both t1 and t2 have watched=500, so title tiebreaker gives t2 (A) before t1 (Z).
        // t3 has watched=100, so it's last.
        assertEquals(listOf(2L, 1L, 3L), listOf(t1, t2, t3).sortedBy(spec, context))
    }

    @Test
    fun `liked ascending places liked tracks first`() {
        // Give each theme a distinct anime so the default fallback (which sorts
        // by anime title) can deterministically break ties between the two
        // non-liked tracks.
        val animeA = anime("a", 10L, title = "A")
        val animeB = anime("b", 20L, title = "B")
        val animeC = anime("c", 30L, title = "C")
        val t1 = theme(1, animeId = 10L)
        val t2 = theme(2, animeId = 20L)
        val t3 = theme(3, animeId = 30L)
        val context = ctx(
            themes = listOf(t1, t2, t3),
            anime = listOf(animeA, animeB, animeC),
            liked = setOf(2L)
        )
        val asc = SortSpec(listOf(SortKey(SortAttribute.LIKED, SortDirection.ASC)))
        val desc = SortSpec(listOf(SortKey(SortAttribute.LIKED, SortDirection.DESC)))

        // Ascending = Yes first -> liked id=2 comes first; fallback orders
        // non-liked by anime title -> A (t1) then C (t3).
        assertEquals(listOf(2L, 1L, 3L), listOf(t3, t1, t2).sortedBy(asc, context))
        // Descending = No first -> liked id=2 last.
        assertEquals(listOf(1L, 3L, 2L), listOf(t3, t1, t2).sortedBy(desc, context))
    }

    @Test
    fun `play count sorts numerically`() {
        val t1 = theme(1)
        val t2 = theme(2)
        val t3 = theme(3)
        val context = ctx(
            themes = listOf(t1, t2, t3),
            playCounts = mapOf(1L to 0, 2L to 10, 3L to 5)
        )
        val desc = SortSpec(listOf(SortKey(SortAttribute.PLAY_COUNT, SortDirection.DESC)))
        assertEquals(listOf(2L, 3L, 1L), listOf(t1, t2, t3).sortedBy(desc, context))
    }

    @Test
    fun `empty sort spec falls back to default comparator`() {
        // The default fallback orders by anime title, then theme type rank,
        // then numeric sequence — it does not consider the theme title.
        val animeA = anime("a", 10L, title = "Alpha")
        val animeB = anime("b", 20L, title = "Beta")
        val t1 = theme(1, animeId = 20L) // anime title "Beta"
        val t2 = theme(2, animeId = 10L) // anime title "Alpha"
        val context = ctx(listOf(t1, t2), anime = listOf(animeA, animeB))

        val ordered = listOf(t1, t2).sortedBy(SortSpec(emptyList()), context)
        assertEquals(listOf(2L, 1L), ordered)
    }

    @Test
    fun `random sort is stable for a given seed but varies across seeds`() {
        val themes = (1L..10L).map { theme(it) }
        val ctx1 = ctx(themes, nowMillis = 111_111L)
        val ctx2 = ctx(themes, nowMillis = 222_222L)
        val spec = SortSpec(listOf(SortKey(SortAttribute.RANDOM)))

        val first = themes.sortedBy(spec, ctx1)
        val second = themes.sortedBy(spec, ctx1)
        assertEquals("random sort must be stable for a given seed", first, second)

        val different = themes.sortedBy(spec, ctx2)
        // Extremely unlikely to match across seeds with 10 items.
        assertNotEquals(first, different)
        assertTrue(first.toSet() == different.toSet())
    }

    @Test
    fun `aired date sort uses parsed year ordering`() {
        val animeA = anime("a", 10L, startDate = "2015-05-01")
        val animeB = anime("b", 20L, startDate = "2001-01-01")
        val animeC = anime("c", 30L, startDate = null)
        val t1 = theme(1, animeId = 10L)
        val t2 = theme(2, animeId = 20L)
        val t3 = theme(3, animeId = 30L)
        val context = ctx(listOf(t1, t2, t3), anime = listOf(animeA, animeB, animeC))

        val asc = SortSpec(listOf(SortKey(SortAttribute.AIRED_DATE, SortDirection.ASC)))
        val ordered = listOf(t1, t2, t3).sortedBy(asc, context)
        // 2001 (t2) < 2015 (t1), null aired goes last
        assertEquals(listOf(2L, 1L, 3L), ordered)
    }
}
