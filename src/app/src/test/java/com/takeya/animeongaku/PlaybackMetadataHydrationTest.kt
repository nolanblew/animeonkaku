package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.LoudnessProfile
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.withLatestMediaMetadata
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackMetadataHydrationTest {
    @Test
    fun `existing queue descriptor is replaced with current Room loudness`() {
        val stale = modes(gainDb = 0.0)
        val current = modes(gainDb = -8.22)
        val entry = QueueEntry(
            queueId = 99,
            item = PlayableItem.Theme(theme = theme(), modeDescriptor = stale)
        )

        val hydrated = entry.withLatestMediaMetadata(
            descriptorsByThemeId = mapOf(1L to current),
            songsById = emptyMap()
        )

        val descriptor = (hydrated.item as PlayableItem.Theme).modeDescriptor
        assertEquals(-8.22, descriptor?.fullSizeLoudness?.gainDb ?: 0.0, 0.001)
    }

    private fun theme() = ThemeEntity(
        id = 1,
        animeId = null,
        title = "Theme",
        artistName = "Artist",
        audioUrl = "https://server/theme/1",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    )

    private fun modes(gainDb: Double) = ThemeModeEntity(
        themeId = 1,
        tvSizeUrl = "https://server/theme/1",
        fullSizeSongId = 10,
        fullSizeUrl = "https://server/song/10",
        fullSizeLoudness = LoudnessProfile(
            state = "READY",
            integratedLufs = -7.78,
            truePeakDbtp = -0.2,
            loudnessRangeLu = 5.0,
            gainDb = gainDb,
            policyVersion = 1
        )
    )
}
