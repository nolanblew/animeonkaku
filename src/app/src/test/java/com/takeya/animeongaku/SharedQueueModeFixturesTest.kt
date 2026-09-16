package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackResolver
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.ThemeModePolicy
import com.takeya.animeongaku.media.isQueueEntryAllowedByPreference
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

class SharedQueueModeFixturesTest {
    @Test
    fun `Android resolves the same playable modes as the shared web and Sonos fixtures`() {
        val fixtureFile = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "shared/queue-mode-policy.fixtures.json") }
            .first { it.isFile }
        val fixtures = Moshi.Builder().build().adapter(Any::class.java)
            .fromJson(fixtureFile.readText()) as List<*>
        for (raw in fixtures) {
            val fixture = raw as Map<*, *>
            val input = fixture["input"] as Map<*, *>
            val available = input["available"] as Map<*, *>
            val required = input["requiredAudioMode"] as String?
            val soft = input["softMode"] as String?
            val manual = (input["manualMode"] as String?)?.let(PlaybackMode::valueOf)
            val unskipped = input["allowDisliked"] == true || manual != null
            val theme = ThemeEntity(
                id = 1, animeId = null, title = "Fixture", artistName = null,
                audioUrl = if (available["TV_SIZE"] == true) "/tv" else "",
                videoUrl = null, isDownloaded = false, localFilePath = null
            )
            val entry = QueueEntry(
                queueId = 1,
                item = PlayableItem.Theme(theme, modeDescriptor = ThemeModeEntity(
                    themeId = 1,
                    tvSizeUrl = theme.audioUrl,
                    fullSizeSongId = 10,
                    fullSizeUrl = if (available["FULL_SIZE"] == true) "/full" else null,
                    videoUrl = if (available["VIDEO"] == true) "/video" else null
                )),
                baseModePolicy = BaseModePolicy(
                    entryPolicy = (required ?: soft)?.let(ThemeModePolicy::valueOf) ?: ThemeModePolicy.INHERIT,
                    overrideUserPreference = required != null
                ),
                manualMode = manual,
                isUnskipped = unskipped,
                modeSeedSequence = if (soft != null) 2 else 0
            )
            val preference = UserPreferenceEntity(
                themeId = 1,
                preferredMode = input["savedPreferredAudioMode"] as String?,
                isDisliked = input["globallyDisliked"] == true,
                isDislikedTvSize = input["dislikedTvSize"] == true,
                isDislikedFullSize = input["dislikedFullSize"] == true
            )
            val resolved = PlaybackResolver().resolve(
                entry, PlaybackIntent(
                    sessionOverride = (input["queueDesiredMode"] as String?)?.let(PlaybackMode::valueOf),
                    queueStarted = true, actionSequence = 1, queueDesiredSequence = 1
                ), isOnline = true, localMedia = emptyMap(), themePreference = preference
            )
            val allowed = isQueueEntryAllowedByPreference(
                entry, resolved.actualMode, mapOf(1L to preference), emptySet(),
                if (unskipped) setOf(1L) else emptySet()
            )
            val actual = resolved.actualMode.takeIf { allowed }?.name
            val expected = (fixture["expected"] as Map<*, *>)["actualMode"]
            assertEquals(fixture["name"] as String, expected, actual)
        }
    }
}
