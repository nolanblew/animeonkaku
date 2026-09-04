package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.LocalMediaFile
import com.takeya.animeongaku.media.MediaKey
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackResolver
import com.takeya.animeongaku.media.PlaybackSource
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.RetainedIntentReason
import com.takeya.animeongaku.media.ThemeModePolicy
import com.takeya.animeongaku.media.completedLocalMedia
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackResolverTest {
    private val resolver = PlaybackResolver()

    @Test
    fun `online preferred and fallback matrix is exact`() {
        data class Case(
            val name: String,
            val preferred: PlaybackMode,
            val tv: Boolean,
            val full: Boolean,
            val video: Boolean,
            val expected: PlaybackMode?
        )
        val cases = listOf(
            Case("TV preferred", PlaybackMode.TV_SIZE, true, true, true, PlaybackMode.TV_SIZE),
            Case("TV to Full", PlaybackMode.TV_SIZE, false, true, true, PlaybackMode.FULL_SIZE),
            Case("TV never enters Video", PlaybackMode.TV_SIZE, false, false, true, null),
            Case("Full preferred", PlaybackMode.FULL_SIZE, true, true, true, PlaybackMode.FULL_SIZE),
            Case("Full to TV", PlaybackMode.FULL_SIZE, true, false, true, PlaybackMode.TV_SIZE),
            Case("Full never enters Video", PlaybackMode.FULL_SIZE, false, false, true, null),
            Case("Video preferred", PlaybackMode.VIDEO, true, true, true, PlaybackMode.VIDEO),
            Case("Video to TV", PlaybackMode.VIDEO, true, true, false, PlaybackMode.TV_SIZE),
            Case("Video does not fall through TV to Full", PlaybackMode.VIDEO, false, true, false, null)
        )

        cases.forEach { case ->
            val result = resolver.resolve(
                entry = themeEntry(modes(case.tv, case.full, case.video)),
                intent = PlaybackIntent(rememberedAudioMode = case.preferred.audioOrTv(), sessionOverride = case.preferred),
                isOnline = true,
                localMedia = emptyMap()
            )
            assertEquals(case.name, case.expected, result.actualMode)
            if (case.expected != null && case.expected != case.preferred) {
                assertEquals(case.name, RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE, result.retainedIntentReason)
                assertEquals(case.name, case.preferred, result.preferredMode)
            }
        }
    }

    @Test
    fun `all online preferred and ready metadata combinations follow fallback contract`() {
        val preferredModes = listOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE, PlaybackMode.VIDEO)
        preferredModes.forEach { preferred ->
            listOf(false, true).forEach { tv ->
                listOf(false, true).forEach { full ->
                    listOf(false, true).forEach { video ->
                        val expected = when (preferred) {
                            PlaybackMode.TV_SIZE -> when { tv -> PlaybackMode.TV_SIZE; full -> PlaybackMode.FULL_SIZE; else -> null }
                            PlaybackMode.FULL_SIZE -> when { full -> PlaybackMode.FULL_SIZE; tv -> PlaybackMode.TV_SIZE; else -> null }
                            PlaybackMode.VIDEO -> when { video -> PlaybackMode.VIDEO; tv -> PlaybackMode.TV_SIZE; else -> null }
                            PlaybackMode.RELATED_AUDIO -> null
                        }
                        val actual = resolver.resolve(
                            themeEntry(modes(tv, full, video)),
                            PlaybackIntent(PlaybackMode.TV_SIZE, preferred),
                            true,
                            emptyMap()
                        ).actualMode
                        assertEquals("preferred=$preferred tv=$tv full=$full video=$video", expected, actual)
                    }
                }
            }
        }
    }

    @Test
    fun `offline audio preferences fall back to another available local size`() {
        val entry = themeEntry(modes(tv = true, full = true, video = true))
        listOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE, PlaybackMode.VIDEO).forEach { preferred ->
            listOf(false, true).forEach { tvLocal ->
                listOf(false, true).forEach { fullLocal ->
                    val locals = buildMap {
                        if (tvLocal) MediaKey.themeTv(1).also { put(it, LocalMediaFile(it, "/tv")) }
                        if (fullLocal) MediaKey.songAudio(10).also { put(it, LocalMediaFile(it, "/full")) }
                    }
                    val expected = when (preferred) {
                        PlaybackMode.TV_SIZE -> if (tvLocal) PlaybackMode.TV_SIZE else PlaybackMode.FULL_SIZE.takeIf { fullLocal }
                        PlaybackMode.FULL_SIZE -> if (fullLocal) PlaybackMode.FULL_SIZE else PlaybackMode.TV_SIZE.takeIf { tvLocal }
                        PlaybackMode.VIDEO -> if (tvLocal) PlaybackMode.TV_SIZE else PlaybackMode.FULL_SIZE.takeIf { fullLocal }
                        PlaybackMode.RELATED_AUDIO -> null
                    }
                    assertEquals(
                        "preferred=$preferred tvLocal=$tvLocal fullLocal=$fullLocal",
                        expected,
                        resolver.resolve(entry, PlaybackIntent(PlaybackMode.TV_SIZE, preferred), false, locals).actualMode
                    )
                }
            }
        }
    }

    @Test
    fun `playlist precedence is session then entry then playlist then remembered`() {
        val allModes = modes(tv = true, full = true, video = true)
        val remembered = PlaybackIntent(PlaybackMode.TV_SIZE)

        assertEquals(
            PlaybackMode.FULL_SIZE,
            resolver.resolve(
                themeEntry(allModes, BaseModePolicy(ThemeModePolicy.FULL_SIZE, PlaybackMode.TV_SIZE)),
                remembered,
                true,
                emptyMap()
            ).preferredMode
        )
        assertEquals(
            PlaybackMode.FULL_SIZE,
            resolver.resolve(
                themeEntry(allModes, BaseModePolicy(ThemeModePolicy.INHERIT, PlaybackMode.FULL_SIZE)),
                remembered,
                true,
                emptyMap()
            ).preferredMode
        )
        assertEquals(
            PlaybackMode.VIDEO,
            resolver.resolve(
                themeEntry(allModes, BaseModePolicy(ThemeModePolicy.TV_SIZE, PlaybackMode.FULL_SIZE)),
                remembered.copy(sessionOverride = PlaybackMode.VIDEO),
                true,
                emptyMap()
            ).preferredMode
        )
        assertEquals(PlaybackMode.TV_SIZE, remembered.rememberedAudioMode)
    }

    @Test
    fun `offline prefers the selected size and falls back to available audio`() {
        val entry = themeEntry(modes(tv = true, full = true, video = true))
        val tvKey = MediaKey.themeTv(1)
        val fullKey = MediaKey.songAudio(10)
        val tvLocal = mapOf(tvKey to LocalMediaFile(tvKey, "/local/tv.m4a"))
        val fullLocal = mapOf(fullKey to LocalMediaFile(fullKey, "/local/full.flac"))

        val fullMissing = resolver.resolve(
            entry,
            PlaybackIntent(PlaybackMode.FULL_SIZE),
            isOnline = false,
            localMedia = tvLocal
        )
        assertEquals(PlaybackMode.TV_SIZE, fullMissing.actualMode)
        assertEquals(RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE, fullMissing.retainedIntentReason)

        val tvMissing = resolver.resolve(
            entry,
            PlaybackIntent(PlaybackMode.TV_SIZE),
            isOnline = false,
            localMedia = fullLocal
        )
        assertEquals(PlaybackMode.FULL_SIZE, tvMissing.actualMode)

        val fullReady = resolver.resolve(
            entry,
            PlaybackIntent(PlaybackMode.FULL_SIZE),
            isOnline = false,
            localMedia = fullLocal
        )
        assertEquals(PlaybackMode.FULL_SIZE, fullReady.actualMode)
        assertEquals(PlaybackSource.LOCAL, fullReady.source)
        assertEquals("file:///local/full.flac", fullReady.uri)

        val videoOffline = resolver.resolve(
            entry,
            PlaybackIntent(PlaybackMode.TV_SIZE, sessionOverride = PlaybackMode.VIDEO),
            isOnline = false,
            localMedia = tvLocal + fullLocal
        )
        assertEquals(PlaybackMode.TV_SIZE, videoOffline.actualMode)
        assertTrue(PlaybackMode.VIDEO !in videoOffline.availableModes)
    }

    @Test
    fun `offline exact pre-cached full size remains playable from server cache`() {
        val fullKey = MediaKey.songAudio(10)

        val cached = resolver.resolve(
            entry = themeEntry(modes(tv = true, full = true, video = true)),
            intent = PlaybackIntent(PlaybackMode.FULL_SIZE),
            isOnline = false,
            localMedia = emptyMap(),
            cachedServerMedia = setOf(fullKey)
        )

        assertEquals(PlaybackMode.FULL_SIZE, cached.preferredMode)
        assertEquals(PlaybackMode.FULL_SIZE, cached.actualMode)
        assertEquals(PlaybackSource.SERVER_AUDIO, cached.source)
        assertEquals("https://server/song/10", cached.uri)
        assertEquals(setOf(PlaybackMode.FULL_SIZE), cached.availableModes)
    }

    @Test
    fun `offline exact pre-cached related song remains playable from server cache`() {
        val song = SongEntity(88, "OST", "Composer", audioUrl = "https://server/song/88")
        val key = MediaKey.songAudio(88)

        val cached = resolver.resolve(
            entry = QueueEntry(9, PlayableItem.RelatedSong(song)),
            intent = PlaybackIntent(),
            isOnline = false,
            localMedia = emptyMap(),
            cachedServerMedia = setOf(key)
        )

        assertEquals(PlaybackMode.RELATED_AUDIO, cached.actualMode)
        assertEquals(PlaybackSource.SERVER_AUDIO, cached.source)
        assertEquals("https://server/song/88", cached.uri)
    }

    @Test
    fun `online exact local file wins over server URI`() {
        val key = MediaKey.songAudio(10)
        val result = resolver.resolve(
            themeEntry(modes(tv = true, full = true, video = false)),
            PlaybackIntent(PlaybackMode.FULL_SIZE),
            isOnline = true,
            localMedia = mapOf(key to LocalMediaFile(key, "content://downloads/full"))
        )

        assertEquals(PlaybackSource.LOCAL, result.source)
        assertEquals("content://downloads/full", result.uri)
        assertEquals(key, result.mediaKey)
    }

    @Test
    fun `downloaded playlist entry still offers remote modes while online`() {
        val tvKey = MediaKey.themeTv(1)
        val result = resolver.resolve(
            themeEntry(modes(tv = true, full = true, video = true)),
            PlaybackIntent(PlaybackMode.TV_SIZE),
            isOnline = true,
            localMedia = mapOf(tvKey to LocalMediaFile(tvKey, "/downloads/tv.webm"))
        )

        assertEquals(PlaybackSource.LOCAL, result.source)
        assertEquals(
            setOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE, PlaybackMode.VIDEO),
            result.availableModes
        )
    }

    @Test
    fun `related song always uses related audio and exact song key`() {
        val song = SongEntity(88, "OST", "Composer", audioUrl = "https://server/song/88")
        val entry = QueueEntry(9, PlayableItem.RelatedSong(song))
        val key = MediaKey.songAudio(88)

        val online = resolver.resolve(
            entry,
            PlaybackIntent(PlaybackMode.FULL_SIZE, sessionOverride = PlaybackMode.VIDEO),
            isOnline = true,
            localMedia = emptyMap()
        )
        assertEquals(PlaybackMode.RELATED_AUDIO, online.preferredMode)
        assertEquals(PlaybackMode.RELATED_AUDIO, online.actualMode)
        assertEquals(key, online.mediaKey)

        val offlineMissing = resolver.resolve(entry, PlaybackIntent(), false, emptyMap())
        assertNull(offlineMissing.actualMode)

        val offlineReady = resolver.resolve(
            entry,
            PlaybackIntent(),
            false,
            mapOf(key to LocalMediaFile(key, "/songs/88.flac"))
        )
        assertEquals(PlaybackMode.RELATED_AUDIO, offlineReady.actualMode)
        assertEquals("file:///songs/88.flac", offlineReady.uri)
    }

    @Test
    fun `video playback failure resolves TV for same queue entry and retains Video preference`() {
        val entry = themeEntry(modes(tv = true, full = true, video = true))
        val fallback = resolver.resolveVideoFailureFallback(
            entry = entry,
            intent = PlaybackIntent(PlaybackMode.TV_SIZE, PlaybackMode.VIDEO),
            isOnline = true,
            localMedia = emptyMap()
        )

        assertEquals(entry.queueId, fallback.queueId)
        assertEquals(PlaybackMode.VIDEO, fallback.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, fallback.actualMode)
        assertEquals(PlaybackSource.SERVER_AUDIO, fallback.source)
    }

    @Test
    fun `available modes reflect connectivity ready metadata and exact downloads`() {
        val entry = themeEntry(modes(tv = true, full = true, video = true))
        val offline = resolver.resolve(
            entry,
            PlaybackIntent(),
            false,
            mapOf(MediaKey.themeTv(1) to LocalMediaFile(MediaKey.themeTv(1), "/tv.m4a"))
        )
        assertEquals(setOf(PlaybackMode.TV_SIZE), offline.availableModes)

        val online = resolver.resolve(entry, PlaybackIntent(), true, emptyMap())
        assertEquals(setOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE, PlaybackMode.VIDEO), online.availableModes)
    }

    @Test
    fun `fallback retains intent and returns to preferred mode on next eligible item`() {
        val intent = PlaybackIntent(PlaybackMode.FULL_SIZE)
        val fallback = resolver.resolve(themeEntry(modes(true, false, false)), intent, true, emptyMap())
        val next = resolver.resolve(themeEntry(modes(true, true, false)), intent, true, emptyMap())

        assertEquals(PlaybackMode.FULL_SIZE, fallback.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, fallback.actualMode)
        assertEquals(PlaybackMode.FULL_SIZE, next.preferredMode)
        assertEquals(PlaybackMode.FULL_SIZE, next.actualMode)
    }

    @Test
    fun `only completed exact download rows become local media`() {
        val readyFile = kotlin.io.path.createTempFile("ready", ".m4a").toFile().apply { writeText("audio") }
        fun download(key: String, status: String, path: String?) = DownloadItemEntity(
            mediaKey = key,
            itemType = "THEME",
            itemId = 1,
            mode = "TV_SIZE",
            status = status,
            filePath = path,
            createdAt = 1,
            updatedAt = 1
        )
        val readyKey = MediaKey.themeTv(1)
        val result = completedLocalMedia(
            listOf(
                download(readyKey.value, "completed", readyFile.absolutePath),
                download(MediaKey.songAudio(10).value, "downloading", "/partial.flac"),
                download(MediaKey.songAudio(11).value, "completed", null)
            )
        )

        assertEquals(mapOf(readyKey to LocalMediaFile(readyKey, readyFile.absolutePath)), result)
        readyFile.delete()
    }

    private fun themeEntry(
        descriptor: ThemeModeEntity,
        policy: BaseModePolicy = BaseModePolicy()
    ) = QueueEntry(
        queueId = 7,
        item = PlayableItem.Theme(theme(), modeDescriptor = descriptor),
        baseModePolicy = policy
    )

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

    private fun modes(tv: Boolean, full: Boolean, video: Boolean) = ThemeModeEntity(
        themeId = 1,
        tvSizeUrl = if (tv) "https://server/theme/1" else "",
        fullSizeSongId = 10,
        fullSizeUrl = if (full) "https://server/song/10" else null,
        videoUrl = if (video) "https://animethemes/video.webm" else null,
        videoSpoiler = true,
        videoNsfw = false
    )

    private fun PlaybackMode.audioOrTv(): PlaybackMode =
        if (this == PlaybackMode.FULL_SIZE) this else PlaybackMode.TV_SIZE
}
