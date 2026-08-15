package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.repository.withBroadThemeDislike
import com.takeya.animeongaku.data.repository.withModeThemeDislike
import com.takeya.animeongaku.data.repository.withThemeLike
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackResolver
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.ThemeModePolicy
import com.takeya.animeongaku.ui.common.themeModePreferenceAction
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemePreferredModeTest {
    private val resolver = PlaybackResolver()

    @Test
    fun `theme preference outranks queue playlist and remembered audio but not session Video`() {
        val entry = themeEntry(
            queueId = 41,
            policy = BaseModePolicy(ThemeModePolicy.TV_SIZE, PlaybackMode.TV_SIZE)
        )

        val preferred = resolver.resolve(
            entry, PlaybackIntent(PlaybackMode.TV_SIZE), true, emptyMap(),
            preferredThemeMode = PlaybackMode.FULL_SIZE
        )
        val video = resolver.resolve(
            entry, PlaybackIntent(PlaybackMode.TV_SIZE, PlaybackMode.VIDEO), true, emptyMap(),
            preferredThemeMode = PlaybackMode.FULL_SIZE
        )

        assertEquals(PlaybackMode.FULL_SIZE, preferred.preferredMode)
        assertEquals(PlaybackMode.FULL_SIZE, preferred.actualMode)
        assertEquals(PlaybackMode.VIDEO, video.preferredMode)
    }

    @Test
    fun `playlist override outranks a theme preference but never a scoped dislike`() {
        val overridingEntry = themeEntry(
            queueId = 42,
            policy = BaseModePolicy(
                entryPolicy = ThemeModePolicy.INHERIT,
                playlistDefault = PlaybackMode.TV_SIZE,
                overrideUserPreference = true
            )
        )

        val overridden = resolver.resolve(
            entry = overridingEntry,
            intent = PlaybackIntent(),
            isOnline = true,
            localMedia = emptyMap(),
            themePreference = UserPreferenceEntity(themeId = 1, preferredMode = "FULL_SIZE")
        )
        val disliked = resolver.resolve(
            entry = overridingEntry,
            intent = PlaybackIntent(),
            isOnline = true,
            localMedia = emptyMap(),
            themePreference = UserPreferenceEntity(
                themeId = 1,
                preferredMode = "FULL_SIZE",
                isDislikedTvSize = true
            )
        )

        assertEquals(PlaybackMode.TV_SIZE, overridden.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, overridden.actualMode)
        assertEquals(PlaybackMode.FULL_SIZE, disliked.preferredMode)
        assertEquals(PlaybackMode.FULL_SIZE, disliked.actualMode)
        assertTrue(PlaybackMode.TV_SIZE !in disliked.availableModes)
    }

    @Test
    fun `temporarily missing Full falls back to TV while retaining intent and queue identity`() {
        val unavailable = themeEntry(queueId = 71, fullAvailable = false)
        val available = themeEntry(queueId = 72, fullAvailable = true)

        val fallback = resolver.resolve(
            unavailable, PlaybackIntent(), true, emptyMap(), PlaybackMode.FULL_SIZE
        )
        val restored = resolver.resolve(
            available, PlaybackIntent(), true, emptyMap(), PlaybackMode.FULL_SIZE
        )

        assertEquals(71L, fallback.queueId)
        assertEquals(PlaybackMode.FULL_SIZE, fallback.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, fallback.actualMode)
        assertEquals(72L, restored.queueId)
        assertEquals(PlaybackMode.FULL_SIZE, restored.actualMode)
    }

    @Test
    fun `duplicate occurrences retain their own queue identities`() {
        val first = resolver.resolve(themeEntry(91), PlaybackIntent(), true, emptyMap(), PlaybackMode.FULL_SIZE)
        val duplicate = resolver.resolve(themeEntry(92), PlaybackIntent(), true, emptyMap(), PlaybackMode.FULL_SIZE)

        assertEquals(listOf(91L, 92L), listOf(first.queueId, duplicate.queueId))
        assertEquals(first.playableKey, duplicate.playableKey)
    }

    @Test
    fun `reaction mutations preserve preferred mode`() {
        val pref = UserPreferenceEntity(themeId = 1, preferredMode = "FULL_SIZE")

        assertEquals("FULL_SIZE", pref.withThemeLike(true, 1).preferredMode)
        assertEquals("FULL_SIZE", pref.withBroadThemeDislike(true, 2).preferredMode)
        assertEquals("FULL_SIZE", pref.withModeThemeDislike(true, true, 3).preferredMode)
    }

    @Test
    fun `scoped dislike resolves playback to the other available audio mode`() {
        val entry = themeEntry(queueId = 73)

        val fullDisliked = resolver.resolve(
            entry = entry,
            intent = PlaybackIntent(),
            isOnline = true,
            localMedia = emptyMap(),
            themePreference = UserPreferenceEntity(
                themeId = 1,
                preferredMode = "FULL_SIZE",
                isDislikedFullSize = true
            )
        )
        val tvDisliked = resolver.resolve(
            entry = entry,
            intent = PlaybackIntent(),
            isOnline = true,
            localMedia = emptyMap(),
            themePreference = UserPreferenceEntity(themeId = 1, isDislikedTvSize = true)
        )

        assertEquals(PlaybackMode.TV_SIZE, fullDisliked.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, fullDisliked.actualMode)
        assertTrue(PlaybackMode.FULL_SIZE !in fullDisliked.availableModes)
        assertEquals(PlaybackMode.FULL_SIZE, tvDisliked.preferredMode)
        assertEquals(PlaybackMode.FULL_SIZE, tvDisliked.actualMode)
        assertTrue(PlaybackMode.TV_SIZE !in tvDisliked.availableModes)
    }

    @Test
    fun `video failure falls back to Full when TV is specifically disliked`() {
        val fallback = resolver.resolveVideoFailureFallback(
            entry = themeEntry(queueId = 74),
            intent = PlaybackIntent(sessionOverride = PlaybackMode.VIDEO),
            isOnline = true,
            localMedia = emptyMap(),
            themePreference = UserPreferenceEntity(themeId = 1, isDislikedTvSize = true)
        )

        assertEquals(PlaybackMode.VIDEO, fallback.preferredMode)
        assertEquals(PlaybackMode.FULL_SIZE, fallback.actualMode)
    }

    @Test
    fun `action presentation exposes only the alternative when Full metadata is known`() {
        assertEquals("Prefer Full Size", themeModePreferenceAction(true, null)?.label)
        assertEquals("Prefer Full Size", themeModePreferenceAction(true, "TV_SIZE")?.label)
        assertEquals("Prefer TV Size", themeModePreferenceAction(true, "FULL_SIZE")?.label)
        assertNull(themeModePreferenceAction(false, "FULL_SIZE"))
        assertNull(themeModePreferenceAction(null, "FULL_SIZE"))
    }

    @Test
    fun `all theme menu surfaces use the shared seam and Related Music excludes it`() {
        val themeSurfaces = listOf(
            "ui/home/HomeScreen.kt",
            "ui/library/AnimeDetailScreen.kt",
            "ui/library/ArtistDetailScreen.kt",
            "ui/library/LibraryScreen.kt",
            "ui/library/PlaylistDetailScreen.kt",
            "ui/player/PlayerScreen.kt",
            "ui/player/UpNextSheet.kt",
            "ui/search/SearchScreen.kt"
        )
        themeSurfaces.forEach { relative ->
            val source = File("src/main/java/com/takeya/animeongaku/$relative").readText()
            assertTrue("Missing preferred-mode seam in $relative", source.contains("themeModePreferenceAction"))
        }
        val related = File("src/main/java/com/takeya/animeongaku/ui/library/RelatedMusicScreen.kt").readText()
        assertTrue(!related.contains("themeModePreferenceAction"))
    }

    private fun themeEntry(
        queueId: Long,
        fullAvailable: Boolean = true,
        policy: BaseModePolicy = BaseModePolicy()
    ) = QueueEntry(
        queueId = queueId,
        item = PlayableItem.Theme(
            ThemeEntity(1, null, "Theme", "Artist", "https://server/tv", null, false, null),
            modeDescriptor = ThemeModeEntity(
                themeId = 1,
                tvSizeUrl = "https://server/tv",
                fullSizeSongId = 10,
                fullSizeUrl = "https://server/full".takeIf { fullAvailable }
            )
        ),
        baseModePolicy = policy
    )
}
