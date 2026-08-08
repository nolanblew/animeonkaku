package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.BluetoothMetadataStyle
import com.takeya.animeongaku.media.MediaKey
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlayableKey
import com.takeya.animeongaku.media.PlayableKind
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackSource
import com.takeya.animeongaku.media.ResolvedPlaybackItem
import com.takeya.animeongaku.media.playerDisplayInfo
import com.takeya.animeongaku.media.toPlaybackMediaDescriptor
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackPresentationTest {
    @Test
    fun `player gives anime and theme visual priority over song and artist`() {
        val item = PlayableItem.Theme(
            theme = ThemeEntity(
                id = 7,
                animeId = 70,
                title = "Blue Bird",
                artistName = "Ikimono-gakari",
                audioUrl = "https://server/theme/7",
                videoUrl = null,
                isDownloaded = true,
                localFilePath = "/downloads/7.webm",
                themeType = "OP3"
            ),
            anime = anime()
        )

        val display = playerDisplayInfo(item, anime())

        assertEquals("Naruto Shippuden · OP 3", display.primaryText)
        assertEquals("Blue Bird · Ikimono-gakari", display.secondaryText)
    }

    @Test
    fun `Bluetooth anime theme style is the anime first default presentation`() {
        val descriptor = resolvedTheme().toPlaybackMediaDescriptor(
            bluetoothMetadataStyle = BluetoothMetadataStyle.ANIME_THEME
        )

        assertEquals("Naruto Shippuden", descriptor.title)
        assertEquals("OP 3", descriptor.artist)
    }

    @Test
    fun `Bluetooth song artist style uses music credits`() {
        val descriptor = resolvedTheme().toPlaybackMediaDescriptor(
            bluetoothMetadataStyle = BluetoothMetadataStyle.SONG_ARTIST
        )

        assertEquals("Blue Bird", descriptor.title)
        assertEquals("Ikimono-gakari", descriptor.artist)
    }

    @Test
    fun `Bluetooth combined style keeps anime main and song credits secondary`() {
        val descriptor = resolvedTheme().toPlaybackMediaDescriptor(
            bluetoothMetadataStyle = BluetoothMetadataStyle.COMBINED
        )

        assertEquals("Naruto Shippuden · OP 3", descriptor.title)
        assertEquals("Blue Bird · Ikimono-gakari", descriptor.artist)
    }

    private fun anime() = AnimeEntity(
        kitsuId = "naruto-shippuden",
        animeThemesId = 70,
        title = "Naruto Shippuden",
        thumbnailUrl = null,
        coverUrl = null,
        syncedAt = 1
    )

    private fun resolvedTheme() = ResolvedPlaybackItem(
        queueId = 99,
        playableKey = PlayableKey(PlayableKind.THEME, 7),
        preferredMode = PlaybackMode.TV_SIZE,
        actualMode = PlaybackMode.TV_SIZE,
        uri = "https://server/theme/7",
        mediaKey = MediaKey.themeTv(7),
        source = PlaybackSource.SERVER_AUDIO,
        availableModes = setOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE, PlaybackMode.VIDEO),
        retainedIntentReason = null,
        title = "Blue Bird",
        artist = "Ikimono-gakari",
        animeOrRelease = "Naruto Shippuden",
        artworkUrl = null,
        animeTitle = "Naruto Shippuden",
        themeLabel = "OP 3"
    )
}
