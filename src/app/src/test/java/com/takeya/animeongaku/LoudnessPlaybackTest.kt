package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.LoudnessProfile
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.dbToLinearVolume
import com.takeya.animeongaku.media.LocalMediaFile
import com.takeya.animeongaku.media.MediaKey
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackResolver
import com.takeya.animeongaku.media.QueueEntry
import org.junit.Assert.assertEquals
import org.junit.Test

class LoudnessPlaybackTest {
    @Test
    fun `decibels convert to linear attenuation and never boost`() {
        assertEquals(1f, dbToLinearVolume(0.0), 0.0001f)
        assertEquals(0.5012f, dbToLinearVolume(-6.0), 0.001f)
        assertEquals(1f, dbToLinearVolume(3.0), 0.0001f)
        assertEquals(1f, dbToLinearVolume(Double.NaN), 0.0001f)

        assertEquals(1f, profile(3.0).playerVolume(), 0.0001f)
        assertEquals(1f, profile(-8.0, state = "FAILED").playerVolume(), 0.0001f)
        assertEquals(1f, LoudnessProfile(gainDb = Double.NaN, state = "READY").playerVolume(), 0.0001f)
    }

    @Test
    fun `TV full and local media retain their exact loudness profiles`() {
        val tv = profile(-1.5)
        val full = profile(-8.0)
        val localFull = profile(-4.0)
        val entry = QueueEntry(
            queueId = 7,
            item = PlayableItem.Theme(
                theme = ThemeEntity(1, null, "Theme", "Artist", "https://server/tv", null, false, null),
                modeDescriptor = ThemeModeEntity(
                    themeId = 1,
                    tvSizeUrl = "https://server/tv",
                    fullSizeSongId = 2,
                    fullSizeUrl = "https://server/full",
                    tvSizeLoudness = tv,
                    fullSizeLoudness = full
                )
            )
        )
        val resolver = PlaybackResolver()

        val resolvedTv = resolver.resolve(entry, PlaybackIntent(PlaybackMode.TV_SIZE), true, emptyMap())
        val resolvedFull = resolver.resolve(entry, PlaybackIntent(PlaybackMode.FULL_SIZE), true, emptyMap())
        val resolvedOfflineFull = resolver.resolve(
            entry,
            PlaybackIntent(PlaybackMode.FULL_SIZE),
            false,
            mapOf(MediaKey.songAudio(2) to LocalMediaFile(MediaKey.songAudio(2), "/full.flac", localFull))
        )

        assertEquals(tv, resolvedTv.loudness)
        assertEquals(full, resolvedFull.loudness)
        assertEquals(localFull, resolvedOfflineFull.loudness)

        assertEquals(localFull.playerVolume(), resolvedOfflineFull.loudness!!.playerVolume(), 0.0001f)
    }

    private fun profile(gainDb: Double, state: String = "READY") = LoudnessProfile(
        integratedLufs = -10.0,
        truePeakDbtp = -1.0,
        loudnessRangeLu = 7.0,
        gainDb = gainDb,
        policyVersion = 1,
        state = state
    )
}
