package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackResolver
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.RetainedIntentReason
import com.takeya.animeongaku.media.ThemeModePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Cross-cutting regressions for the queue-mode contract shared with web and Sonos. */
class QueueModeContractTest {
    private val resolver = PlaybackResolver()

    @Test
    fun `ordinary replay restores the recorded actual mode without changing queue intent`() {
        val replay = resolve(
            entry = entry(
                descriptor = modes(tv = true, full = true, video = false),
                lastActualMode = PlaybackMode.FULL_SIZE,
                replayRequested = true
            ),
            intent = queueIntent(PlaybackMode.TV_SIZE)
        )

        assertEquals(PlaybackMode.TV_SIZE, replay.preferredMode)
        assertEquals(PlaybackMode.FULL_SIZE, replay.actualMode)
    }

    @Test
    fun `replay falls back within policy when its recorded media vanished`() {
        val replay = resolve(
            entry = entry(
                descriptor = modes(tv = true, full = false, video = false),
                lastActualMode = PlaybackMode.FULL_SIZE,
                replayRequested = true
            ),
            intent = queueIntent(PlaybackMode.TV_SIZE)
        )

        assertEquals(PlaybackMode.TV_SIZE, replay.actualMode)
    }

    @Test
    fun `strict Video requires its audio and exposes only required audio plus Video`() {
        val strictFull = BaseModePolicy(
            entryPolicy = ThemeModePolicy.FULL_SIZE,
            playlistDefault = PlaybackMode.TV_SIZE,
            overrideUserPreference = true
        )
        val missingRequired = resolve(
            entry = entry(modes(tv = true, full = false, video = true), policy = strictFull),
            intent = queueIntent(PlaybackMode.VIDEO)
        )
        assertNull(missingRequired.actualMode)
        assertEquals(emptySet<PlaybackMode>(), missingRequired.availableModes)
        assertEquals(RetainedIntentReason.REQUIRED_UNAVAILABLE, missingRequired.retainedIntentReason)

        val available = resolve(
            entry = entry(modes(tv = true, full = true, video = true), policy = strictFull),
            intent = queueIntent(PlaybackMode.VIDEO)
        )
        assertEquals(PlaybackMode.VIDEO, available.actualMode)
        assertEquals(setOf(PlaybackMode.FULL_SIZE, PlaybackMode.VIDEO), available.availableModes)
    }

    @Test
    fun `saved theme preference wins on the next automatic occurrence after manual audio`() {
        val next = resolve(
            entry = entry(modes(tv = true, full = true, video = false)),
            intent = queueIntent(
                mode = PlaybackMode.FULL_SIZE,
                manual = true,
                actionSequence = 2,
                desiredSequence = 2
            ),
            preference = UserPreferenceEntity(themeId = 1, preferredMode = "TV_SIZE")
        )

        assertEquals(PlaybackMode.TV_SIZE, next.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, next.actualMode)
    }

    @Test
    fun `later soft playlist audio supersedes older queue Video only for that occurrence`() {
        val laterSoft = resolve(
            entry = entry(
                descriptor = modes(tv = true, full = true, video = true),
                policy = BaseModePolicy(ThemeModePolicy.FULL_SIZE),
                modeSeedSequence = 3
            ),
            intent = queueIntent(
                mode = PlaybackMode.VIDEO,
                manual = true,
                actionSequence = 2,
                desiredSequence = 2
            )
        )
        assertEquals(PlaybackMode.FULL_SIZE, laterSoft.preferredMode)
        assertEquals(PlaybackMode.FULL_SIZE, laterSoft.actualMode)

        val inherited = resolve(
            entry = entry(modes(tv = true, full = true, video = true), modeSeedSequence = 3),
            intent = queueIntent(
                mode = PlaybackMode.VIDEO,
                manual = true,
                actionSequence = 2,
                desiredSequence = 2
            )
        )
        assertEquals(PlaybackMode.VIDEO, inherited.actualMode)
    }

    @Test
    fun `stored audio preference still wins after soft mode supersedes queue Video`() {
        val selected = resolve(
            entry = entry(
                descriptor = modes(tv = true, full = true, video = true),
                policy = BaseModePolicy(ThemeModePolicy.FULL_SIZE),
                modeSeedSequence = 3
            ),
            intent = queueIntent(
                mode = PlaybackMode.VIDEO,
                manual = true,
                actionSequence = 2,
                desiredSequence = 2
            ),
            preference = UserPreferenceEntity(themeId = 1, preferredMode = "TV_SIZE")
        )

        assertEquals(PlaybackMode.TV_SIZE, selected.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, selected.actualMode)
    }

    private fun resolve(
        entry: QueueEntry,
        intent: PlaybackIntent,
        preference: UserPreferenceEntity? = null
    ) = resolver.resolve(
        entry = entry,
        intent = intent,
        isOnline = true,
        localMedia = emptyMap(),
        themePreference = preference
    )

    private fun queueIntent(
        mode: PlaybackMode,
        manual: Boolean = false,
        actionSequence: Long = 0,
        desiredSequence: Long = actionSequence
    ) = PlaybackIntent(
        sessionOverride = mode,
        manualOverride = manual,
        actionSequence = actionSequence,
        queueDesiredSequence = desiredSequence,
        queueStarted = true
    )

    private fun entry(
        descriptor: ThemeModeEntity,
        policy: BaseModePolicy = BaseModePolicy.Inherit,
        lastActualMode: PlaybackMode? = null,
        modeSeedSequence: Long = 0,
        replayRequested: Boolean = false
    ) = QueueEntry(
        queueId = 1,
        item = PlayableItem.Theme(theme(), modeDescriptor = descriptor),
        baseModePolicy = policy,
        lastActualMode = lastActualMode,
        modeSeedSequence = modeSeedSequence,
        replayRequested = replayRequested
    )

    private fun theme() = ThemeEntity(
        id = 1,
        animeId = null,
        title = "Theme",
        artistName = "Artist",
        audioUrl = "/v1/media/audio/1",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    )

    private fun modes(tv: Boolean, full: Boolean, video: Boolean) = ThemeModeEntity(
        themeId = 1,
        tvSizeUrl = if (tv) "/v1/media/audio/1" else "",
        fullSizeSongId = 10,
        fullSizeUrl = if (full) "/v1/media/songs/10/audio" else null,
        videoUrl = if (video) "/v1/media/video/1" else null
    )
}
