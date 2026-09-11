package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.*
import com.takeya.animeongaku.download.resolveThemeDownloadMedia
import com.takeya.animeongaku.media.*
import org.junit.Assert.assertEquals
import org.junit.Test

class VariantPolicyTest {
    @Test
    fun `playback and downloads agree across required preferred unavailable and disliked variants`() {
        val resolver = PlaybackResolver()
        for (required in listOf(false, true)) for (fullAvailable in listOf(false, true)) {
            for (playlistMode in listOf("TV_SIZE", "FULL_SIZE")) {
                for (saved in listOf(null, "TV_SIZE", "FULL_SIZE")) for (dislike in listOf(null, "TV_SIZE", "FULL_SIZE", "BOTH")) {
                    val pref = UserPreferenceEntity(1, preferredMode = saved,
                        isDislikedTvSize = dislike == "TV_SIZE" || dislike == "BOTH",
                        isDislikedFullSize = dislike == "FULL_SIZE" || dislike == "BOTH")
                    val mode = ThemeModeEntity(1, "/tv", fullSizeSongId = 10,
                        fullSizeUrl = if (fullAvailable) "/full" else null)
                    val theme = ThemeEntity(1, null, "Song", null, "/tv", null, false, null)
                    val entry = QueueEntry(7, PlayableItem.Theme(theme, modeDescriptor = mode),
                        BaseModePolicy(playlistDefault = PlaybackMode.valueOf(playlistMode), overrideUserPreference = required))
                    val chosen = saved ?: playlistMode
                    val allowed = listOf(chosen, if (chosen == "TV_SIZE") "FULL_SIZE" else "TV_SIZE").firstOrNull {
                        (it != "FULL_SIZE" || fullAvailable) &&
                            !(it == "TV_SIZE" && pref.isDislikedTvSize) && !(it == "FULL_SIZE" && pref.isDislikedFullSize)
                    }
                    val expected = allowed.takeUnless { required && (allowed != playlistMode || (saved != null && saved != playlistMode)) }
                    val playback = resolver.resolve(entry, PlaybackIntent(), true, emptyMap(), themePreference = pref)
                    val download = resolveThemeDownloadMedia(1, "/tv", mode, null, preference = pref,
                        fallbackMode = playlistMode, overrideUserPreference = required)
                    val label = "required=$required full=$fullAvailable playlist=$playlistMode saved=$saved dislike=$dislike"
                    assertEquals(label, expected, playback.actualMode?.name)
                    assertEquals(label, when (expected) { "TV_SIZE" -> "/tv"; "FULL_SIZE" -> "/full"; else -> null }, download?.sourceUrl)
                }
            }
        }
    }
}
