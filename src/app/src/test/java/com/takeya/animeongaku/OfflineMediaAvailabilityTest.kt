package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.media.MediaKey
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.requiredOfflineMediaKey
import org.junit.Assert.assertEquals
import org.junit.Test

class OfflineMediaAvailabilityTest {
    @Test
    fun `full-only recommendation uses its remote full song for offline checks`() {
        val theme = ThemeEntity(
            id = 7,
            animeId = null,
            title = "Full only",
            artistName = null,
            audioUrl = "",
            videoUrl = null,
            isDownloaded = false,
            localFilePath = null
        )
        val item = PlayableItem.Theme(
            theme = theme,
            remoteModeDescriptor = ThemeModeEntity(
                themeId = 7,
                tvSizeUrl = "",
                fullSizeSongId = 70,
                fullSizeUrl = "https://server/song/70"
            ),
            serverPreference = UserPreferenceEntity(
                themeId = 7,
                preferredMode = "FULL_SIZE",
                isDislikedTvSize = true
            )
        )

        assertEquals(MediaKey.songAudio(70), requiredOfflineMediaKey(QueueEntry(1L, item)))
    }
}
