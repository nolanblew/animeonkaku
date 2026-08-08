package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.download.DownloadMediaSpec
import com.takeya.animeongaku.download.resolvePlaylistDownloadMedia
import com.takeya.animeongaku.download.resolveThemeFullSizeDownload
import com.takeya.animeongaku.download.resolveSongDownloadSource
import com.takeya.animeongaku.download.safeDownloadFileName
import com.takeya.animeongaku.download.shouldDeletePhysicalDownload
import com.takeya.animeongaku.download.audioExtensionForContentType
import com.takeya.animeongaku.download.downloadInitialStatus
import com.takeya.animeongaku.download.resumedDownloadStatus
import com.takeya.animeongaku.download.isDownloadStillEligible
import com.takeya.animeongaku.download.canonicalDownloadItemDirectory
import com.takeya.animeongaku.download.deleteUncommittedTransfer
import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.download.resolveThemeDownloadMedia
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DownloadMediaResolutionTest {
    @Test
    fun `preferred Full Size is the single theme download`() {
        val descriptor = ThemeModeEntity(
            themeId = 10,
            tvSizeUrl = "/tv/10",
            fullSizeSongId = 90,
            fullSizeUrl = "/songs/90"
        )

        assertEquals(
            DownloadMediaSpec.song(90, "/songs/90"),
            resolveThemeDownloadMedia(
                themeId = 10,
                fallbackTvUrl = "/legacy/tv/10",
                descriptor = descriptor,
                canonicalSongUrl = "/songs/90",
                preference = UserPreferenceEntity(10, preferredMode = "FULL_SIZE")
            )
        )
    }

    @Test
    fun `scoped dislike replaces the preferred download with the other available version`() {
        val descriptor = ThemeModeEntity(
            themeId = 10,
            tvSizeUrl = "/tv/10",
            fullSizeSongId = 90,
            fullSizeUrl = "/songs/90"
        )

        assertEquals(
            DownloadMediaSpec.themeTv(10, "/tv/10"),
            resolveThemeDownloadMedia(
                themeId = 10,
                fallbackTvUrl = "/legacy/tv/10",
                descriptor = descriptor,
                canonicalSongUrl = "/songs/90",
                preference = UserPreferenceEntity(
                    10,
                    preferredMode = "FULL_SIZE",
                    isDislikedFullSize = true
                )
            )
        )
        assertEquals(
            DownloadMediaSpec.song(90, "/songs/90"),
            resolveThemeDownloadMedia(
                themeId = 10,
                fallbackTvUrl = "/legacy/tv/10",
                descriptor = descriptor,
                canonicalSongUrl = "/songs/90",
                preference = UserPreferenceEntity(10, isDislikedTvSize = true)
            )
        )
    }

    @Test
    fun `unavailable preferred download falls back without changing the preference`() {
        assertEquals(
            DownloadMediaSpec.themeTv(10, "/tv/10"),
            resolveThemeDownloadMedia(
                themeId = 10,
                fallbackTvUrl = "/tv/10",
                descriptor = ThemeModeEntity(10, "/tv/10"),
                canonicalSongUrl = null,
                preference = UserPreferenceEntity(10, preferredMode = "FULL_SIZE")
            )
        )
    }

    @Test
    fun `worker song source falls back to Full mapping when canonical row is absent`() {
        assertEquals(
            "/v1/media/songs/1/audio",
            resolveSongDownloadSource(null, "/v1/media/songs/1/audio")
        )
    }

    @Test
    fun `worker song source prefers canonical catalog row`() {
        assertEquals(
            "/canonical/song/1",
            resolveSongDownloadSource("/canonical/song/1", "/mapped/song/1")
        )
    }

    @Test
    fun `full only mapped song falls back to descriptor URL when song row is absent`() {
        val descriptor = ThemeModeEntity(
            themeId = 13434,
            tvSizeUrl = "/v1/media/audio/13434",
            fullSizeSongId = 1,
            fullSizeUrl = "/v1/media/songs/1/audio"
        )

        assertEquals(
            DownloadMediaSpec.song(1, "/v1/media/songs/1/audio"),
            resolveThemeFullSizeDownload(descriptor, canonicalSongUrl = null)
        )
    }

    @Test
    fun `canonical song URL wins over mapped descriptor fallback`() {
        val descriptor = ThemeModeEntity(
            themeId = 13434,
            tvSizeUrl = "/v1/media/audio/13434",
            fullSizeSongId = 1,
            fullSizeUrl = "/fallback/songs/1"
        )

        assertEquals(
            DownloadMediaSpec.song(1, "/canonical/songs/1"),
            resolveThemeFullSizeDownload(descriptor, canonicalSongUrl = "/canonical/songs/1")
        )
    }

    @Test
    fun `playlist resolver uses exact entry mode and canonical song key`() {
        val entries = listOf(
            PlaylistEntryEntity(7, 10, 0, 100, "THEME", 10, null),
            PlaylistEntryEntity(7, 11, 1, 101, "THEME", 11, "TV_SIZE"),
            PlaylistEntryEntity(7, null, 2, 102, "SONG", 90, null)
        )
        val modes = mapOf(
            10L to ThemeModeEntity(10, "/tv/10", fullSizeSongId = 90, fullSizeUrl = "/songs/90"),
            11L to ThemeModeEntity(11, "/tv/11", fullSizeSongId = 91, fullSizeUrl = "/songs/91")
        )

        assertEquals(
            listOf(
                DownloadMediaSpec.song(90, "/songs/90"),
                DownloadMediaSpec.themeTv(11, "/tv/11")
            ),
            resolvePlaylistDownloadMedia(entries, "FULL_SIZE", modes, mapOf(90L to "/songs/90"))
        )
    }

    @Test
    fun `theme preference outranks playlist policy for downloads`() {
        val entry = PlaylistEntryEntity(7, 10, 0, 100, "THEME", 10, null)
        val mode = ThemeModeEntity(10, "/tv/10", fullSizeSongId = 90, fullSizeUrl = "/songs/90")

        assertEquals(
            listOf(DownloadMediaSpec.song(90, "/songs/90")),
            resolvePlaylistDownloadMedia(
                entries = listOf(entry),
                playlistDefaultMode = "TV_SIZE",
                themeModes = mapOf(10L to mode),
                songUrls = mapOf(90L to "/songs/90"),
                themePreferences = mapOf(10L to UserPreferenceEntity(10, preferredMode = "FULL_SIZE"))
            )
        )
    }

    @Test
    fun `full requirement with no full song is unavailable rather than TV fallback`() {
        val entry = PlaylistEntryEntity(7, 10, 0, 100, "THEME", 10, "FULL_SIZE")
        val modes = mapOf(10L to ThemeModeEntity(10, "/tv/10"))

        assertEquals(emptyList<DownloadMediaSpec>(), resolvePlaylistDownloadMedia(listOf(entry), "TV_SIZE", modes, emptyMap()))
    }

    @Test
    fun `video policy never creates download media`() {
        val entry = PlaylistEntryEntity(7, 10, 0, 100, "THEME", 10, "VIDEO")
        val modes = mapOf(10L to ThemeModeEntity(10, "/tv/10", videoUrl = "/video/10"))

        assertEquals(emptyList<DownloadMediaSpec>(), resolvePlaylistDownloadMedia(listOf(entry), "TV_SIZE", modes, emptyMap()))
    }

    @Test
    fun `server filename is preserved only when safe`() {
        assertEquals("track 01.flac", safeDownloadFileName("attachment; filename=\"track 01.flac\""))
        assertNull(safeDownloadFileName("attachment; filename=\"../escape.flac\""))
        assertNull(safeDownloadFileName("attachment; filename=\"video.webm\""))
    }

    @Test
    fun `shared physical item survives one membership removal`() {
        assertEquals(false, shouldDeletePhysicalDownload(1, false))
        assertEquals(true, shouldDeletePhysicalDownload(0, false))
        assertEquals(true, shouldDeletePhysicalDownload(3, true))
    }

    @Test
    fun `audio content type preserves original extension and video has none`() {
        assertEquals("flac", audioExtensionForContentType("audio/flac; charset=binary"))
        assertNull(audioExtensionForContentType("video/webm"))
    }

    @Test
    fun `wifi pause and resume states remain explicit`() {
        assertEquals(DownloadItemEntity.STATUS_WAITING_FOR_WIFI, downloadInitialStatus(true, false))
        assertEquals(DownloadItemEntity.STATUS_PENDING, downloadInitialStatus(true, true))
        assertEquals(DownloadItemEntity.STATUS_PENDING, resumedDownloadStatus(DownloadItemEntity.STATUS_PAUSED))
        assertEquals(DownloadItemEntity.STATUS_FAILED, resumedDownloadStatus(DownloadItemEntity.STATUS_FAILED))
    }

    @Test
    fun `removed or paused row cannot finalize worker temp file`() {
        fun item(status: String) = DownloadItemEntity(
            mediaKey = "SONG:1:AUDIO",
            itemType = "SONG",
            itemId = 1,
            mode = "AUDIO",
            status = status,
            createdAt = 0,
            updatedAt = 0
        )

        assertEquals(true, isDownloadStillEligible(item(DownloadItemEntity.STATUS_DOWNLOADING)))
        assertEquals(false, isDownloadStillEligible(item(DownloadItemEntity.STATUS_PAUSED)))
        assertEquals(false, isDownloadStillEligible(null))
    }

    @Test
    fun `uncommitted finalized transfer is deleted from canonical item directory`() {
        val root = kotlin.io.path.createTempDirectory("download-cleanup").toFile()
        val itemDir = canonicalDownloadItemDirectory(root, DownloadMediaSpec.TYPE_SONG, 42)!!
        itemDir.mkdirs()
        val finalized = java.io.File(itemDir, "original.flac").apply { writeText("audio") }

        deleteUncommittedTransfer(finalized)

        assertEquals(false, finalized.exists())
        root.deleteRecursively()
    }
}
