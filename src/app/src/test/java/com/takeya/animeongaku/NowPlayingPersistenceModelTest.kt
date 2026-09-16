package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.LoudnessProfile
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.media.PersistedNowPlayingState
import com.takeya.animeongaku.media.PersistedQueueEntry
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlayableKind
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.restorePersistedQueueState
import com.takeya.animeongaku.media.toPersistedState
import com.takeya.animeongaku.media.withLatestMediaMetadata
import com.takeya.animeongaku.media.matchesOwner
import com.takeya.animeongaku.media.newestActivePreference
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.ThemeModePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class NowPlayingPersistenceModelTest {
    @Test
    fun `newer local tombstone beats older live snapshot preference`() {
        val snapshot = UserPreferenceEntity(1, isLiked = true, updatedAt = 10)
        val tombstone = UserPreferenceEntity(1, updatedAt = 20, deletedAt = 20)

        assertEquals(null, newestActivePreference(tombstone, snapshot))
        assertEquals(snapshot, newestActivePreference(tombstone.copy(updatedAt = 5, deletedAt = 5), snapshot))
    }

    @Test
    fun `persisted owner scope accepts matching server and account only`() {
        val state = PersistedNowPlayingState(
            ownerKitsuUserId = "user-1",
            ownerServerBaseUrl = "https://server.example/"
        )

        assertEquals(true, state.matchesOwner("user-1" to "https://server.example"))
        assertEquals(false, state.matchesOwner("user-2" to "https://server.example"))
        assertEquals(false, state.matchesOwner("user-1" to "https://other.example"))
        assertEquals(false, state.matchesOwner(null))
    }

    @Test
    fun `legacy ownerless state remains eligible for Room-only restoration`() {
        val legacy = PersistedNowPlayingState(
            nowPlayingEntries = listOf(PersistedQueueEntry(queueId = 1, itemType = "THEME", itemId = 1))
        )

        assertEquals(true, legacy.matchesOwner("new-user" to "https://new.example"))
        val restored = restorePersistedQueueState(
            legacy,
            themes = mapOf(1L to theme(1)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )
        assertNotNull(restored)
    }

    @Test
    fun `legacy ownerless state ignores self-contained API fallback`() {
        val metadataOnly = NowPlayingState(
            originalQueueEntries = listOf(QueueEntry(1, PlayableItem.Theme(theme(1)))),
            nowPlayingEntries = listOf(QueueEntry(1, PlayableItem.Theme(theme(1))))
        ).toPersistedState(0, 0)

        val restored = restorePersistedQueueState(
            metadataOnly, emptyMap(), emptyMap(), emptyMap(), emptyMap(), emptyMap()
        )

        assertEquals(null, restored)
    }

    @Test
    fun `API-only theme survives persistence before Room sync`() {
        val anime = AnimeEntity(
            kitsuId = "anime-7",
            animeThemesId = 700,
            title = "Anime Seven",
            thumbnailUrl = "https://server/poster-small.jpg",
            coverUrl = "https://server/poster.jpg",
            syncedAt = 0
        )
        val descriptor = ThemeModeEntity(
            themeId = 7,
            tvSizeUrl = "https://server/theme/7",
            fullSizeSongId = 70,
            fullSizeUrl = "https://server/song/70",
            fullSizeLoudness = LoudnessProfile(gainDb = -4.5, state = "READY")
        )
        val entry = QueueEntry(
            queueId = 71,
            item = PlayableItem.Theme(
                theme = theme(7).copy(title = "API title"),
                anime = anime,
                remoteModeDescriptor = descriptor,
                serverPreference = UserPreferenceEntity(
                    themeId = 7,
                    isLiked = true,
                    isDislikedFullSize = false,
                    preferredMode = "FULL_SIZE",
                    updatedAt = 99
                )
            )
        )
        val persisted = NowPlayingState(
            originalQueueEntries = listOf(entry),
            nowPlayingEntries = listOf(entry)
        ).toPersistedState(0, 0).scoped()

        val restored = restorePersistedQueueState(
            persisted, emptyMap(), emptyMap(), emptyMap(), emptyMap(), emptyMap()
        )!!
        val item = restored.currentEntry!!.item as PlayableItem.Theme

        assertEquals(71L, restored.currentEntry!!.queueId)
        assertEquals("API title", item.theme.title)
        assertEquals("Anime Seven", item.anime?.title)
        assertEquals(70L, item.effectiveModeDescriptor?.fullSizeSongId)
        assertEquals(-4.5, item.effectiveModeDescriptor?.fullSizeLoudness?.gainDb)
        assertEquals("FULL_SIZE", item.serverPreference?.preferredMode)
        assertEquals(true, item.serverPreference?.isLiked)
    }

    @Test
    fun `API-only song and release survive persistence with duplicate queue identity`() {
        val song = SongEntity(
            id = 10,
            title = "API song",
            artistCredit = "API artist",
            audioUrl = "https://server/song/10",
            loudness = LoudnessProfile(gainDb = -3.0, state = "READY")
        )
        val release = MusicReleaseEntity(20, "API album", "API artist", artworkUrl = "https://server/album.jpg")
        val anime = AnimeEntity("anime-10", null, "API anime", thumbnailUrl = null, coverUrl = "https://server/anime.jpg", syncedAt = 0)
        val entries = listOf(101L, 102L).map { queueId ->
            QueueEntry(queueId, PlayableItem.RelatedSong(song, release, anime, "soundtrack"))
        }
        val persisted = NowPlayingState(
            originalQueueEntries = entries,
            nowPlayingEntries = entries,
            currentIndex = 1
        ).toPersistedState(0, 0).scoped()

        val restored = restorePersistedQueueState(
            persisted, emptyMap(), emptyMap(), emptyMap(), emptyMap(), emptyMap()
        )!!

        assertEquals(listOf(101L, 102L), restored.nowPlayingEntries.map { it.queueId })
        val item = restored.currentEntry!!.item as PlayableItem.RelatedSong
        assertEquals("API song", item.song.title)
        assertEquals(-3.0, item.song.loudness?.gainDb)
        assertEquals("API album", item.release?.title)
        assertEquals("API anime", item.anime?.title)
    }

    @Test
    fun `newer Room entities override persisted API fallback while remote mode remains available`() {
        val oldTheme = theme(8).copy(title = "old")
        val oldMode = ThemeModeEntity(8, "old-tv", fullSizeSongId = 80, fullSizeUrl = "old-full")
        val entry = QueueEntry(81, PlayableItem.Theme(oldTheme, remoteModeDescriptor = oldMode))
        val persisted = NowPlayingState(
            originalQueueEntries = listOf(entry),
            nowPlayingEntries = listOf(entry)
        ).toPersistedState(0, 0).scoped()
        val newTheme = oldTheme.copy(title = "new")
        val newMode = oldMode.copy(tvSizeUrl = "new-tv", fullSizeUrl = "new-full")

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(8L to newTheme),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap(),
            themeModes = mapOf(8L to newMode)
        )!!
        val item = restored.currentEntry!!.item as PlayableItem.Theme

        assertEquals("new", item.theme.title)
        assertEquals("new-full", item.effectiveModeDescriptor?.fullSizeUrl)
        assertEquals("old-full", item.remoteModeDescriptor?.fullSizeUrl)
    }

    @Test
    fun `fresh API descriptor survives stale Room hydration until Room actually changes`() {
        val staleRoom = ThemeModeEntity(12, "stale-tv", fullSizeSongId = null, fullSizeUrl = null)
        val liveApi = ThemeModeEntity(12, "api-tv", fullSizeSongId = 120, fullSizeUrl = "api-full")
        val entry = QueueEntry(
            121,
            PlayableItem.Theme(
                theme = theme(12),
                modeDescriptor = staleRoom,
                remoteModeDescriptor = liveApi,
                roomModeDescriptorBaseline = staleRoom
            )
        )
        val persisted = NowPlayingState(
            originalQueueEntries = listOf(entry),
            nowPlayingEntries = listOf(entry)
        ).toPersistedState(0, 0).scoped()
        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(12L to theme(12)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap(),
            themeModes = mapOf(12L to staleRoom)
        )!!

        val afterSameRoom = restored.currentEntry!!.withLatestMediaMetadata(
            mapOf(12L to staleRoom),
            emptyMap()
        )
        assertEquals("api-full", (afterSameRoom.item as PlayableItem.Theme).effectiveModeDescriptor?.fullSizeUrl)

        val newerRoom = staleRoom.copy(tvSizeUrl = "new-tv", fullSizeSongId = 121, fullSizeUrl = "new-full")
        val afterRoomChange = afterSameRoom.withLatestMediaMetadata(mapOf(12L to newerRoom), emptyMap())
        assertEquals("new-full", (afterRoomChange.item as PlayableItem.Theme).effectiveModeDescriptor?.fullSizeUrl)
    }

    @Test
    fun `newer local preference replaces every persisted recommendation reaction`() {
        val entry = QueueEntry(
            91,
            PlayableItem.Theme(
                theme(9),
                serverPreference = UserPreferenceEntity(
                    themeId = 9,
                    isLiked = true,
                    isDislikedFullSize = true,
                    preferredMode = "TV_SIZE",
                    updatedAt = 10
                )
            )
        )
        val persisted = NowPlayingState(
            originalQueueEntries = listOf(entry),
            nowPlayingEntries = listOf(entry)
        ).toPersistedState(0, 0).scoped()
        val local = UserPreferenceEntity(
            themeId = 9,
            isLiked = false,
            isDisliked = true,
            isDislikedTvSize = true,
            preferredMode = "FULL_SIZE",
            updatedAt = 20
        )

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(9L to theme(9)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap(),
            localPreferences = mapOf(9L to local)
        )!!
        val preference = (restored.currentEntry!!.item as PlayableItem.Theme).serverPreference

        assertEquals(local, preference)
    }

    @Test
    fun `newer local deletion prevents persisted recommendation preference resurrection`() {
        val entry = QueueEntry(
            92,
            PlayableItem.Theme(
                theme(9),
                serverPreference = UserPreferenceEntity(9, preferredMode = "FULL_SIZE", updatedAt = 10)
            )
        )
        val persisted = NowPlayingState(
            originalQueueEntries = listOf(entry),
            nowPlayingEntries = listOf(entry)
        ).toPersistedState(0, 0).scoped()
        val deleted = UserPreferenceEntity(9, updatedAt = 20, deletedAt = 20)

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(9L to theme(9)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap(),
            localPreferences = mapOf(9L to deleted)
        )!!

        assertEquals(null, (restored.currentEntry!!.item as PlayableItem.Theme).serverPreference)
    }

    @Test
    fun `typed persistence retains full-only recommendation preference`() {
        val persisted = PersistedNowPlayingState(
            ownerKitsuUserId = "user-1",
            ownerServerBaseUrl = "https://server.example",
            nowPlayingEntries = listOf(
                PersistedQueueEntry(
                    queueId = 17,
                    itemType = "THEME",
                    itemId = 7,
                    serverPreferredMode = "FULL_SIZE",
                    serverPreferenceUpdatedAt = 42L,
                    serverPreferenceDislikedTvSize = true,
                    serverPreferencePresent = true
                )
            )
        )
        val restored = restorePersistedQueueState(
            persisted = persisted,
            themes = mapOf(7L to theme(7)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap(),
            themeModes = mapOf(7L to ThemeModeEntity(
                themeId = 7,
                tvSizeUrl = "",
                fullSizeSongId = 70,
                fullSizeUrl = "https://server/song/70"
            ))
        )!!

        val item = restored.currentEntry!!.item as PlayableItem.Theme
        assertEquals("FULL_SIZE", item.serverPreference?.preferredMode)
        assertEquals(true, item.serverPreference?.isDislikedTvSize)
        assertEquals(70L, item.effectiveModeDescriptor?.fullSizeSongId)
    }

    @Test
    fun `typed queue round trip restores song context and queue ids`() {
        val theme = theme(1)
        val song = SongEntity(10, "Song", "Artist", audioUrl = "song.flac")
        val release = MusicReleaseEntity(20, "Album", "Artist")
        val entries = listOf(
            QueueEntry(41, PlayableItem.Theme(theme)),
            QueueEntry(42, PlayableItem.RelatedSong(song, release, relationshipType = "soundtrack"))
        )
        val persisted = NowPlayingState(
            originalQueueEntries = entries,
            nowPlayingEntries = entries,
            currentIndex = 1
        ).toPersistedState(positionMs = 1234, repeatMode = 2)

        val restored = restorePersistedQueueState(
            persisted = persisted,
            themes = mapOf(1L to theme),
            songs = mapOf(10L to song),
            releases = mapOf(20L to release),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )

        assertNotNull(restored)
        assertEquals(listOf(41L, 42L), restored!!.nowPlayingEntries.map { it.queueId })
        assertEquals(PlayableKind.SONG, restored.currentEntry!!.item.key.kind)
        assertEquals("Album", (restored.currentEntry!!.item as PlayableItem.RelatedSong).release?.title)
        assertEquals(1234L, persisted.positionMs)
    }

    @Test
    fun `deleted items are skipped and current index follows surviving occurrence`() {
        val persisted = PersistedNowPlayingState(
            nowPlayingEntries = listOf(
                PersistedQueueEntry(1, itemType = "THEME", itemId = 1),
                PersistedQueueEntry(2, itemType = "SONG", itemId = 99),
                PersistedQueueEntry(3, itemType = "THEME", itemId = 3)
            ),
            currentIndex = 2
        )

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(1L to theme(1), 3L to theme(3)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(listOf(1L, 3L), restored.nowPlayingEntries.map { it.queueId })
        assertEquals(1, restored.currentIndex)
        assertEquals(3L, restored.currentEntry!!.item.key.id)
    }

    @Test
    fun `legacy themeId only entry restores as theme`() {
        val persisted = PersistedNowPlayingState(
            nowPlayingEntries = listOf(PersistedQueueEntry(queueId = 7, themeId = 5))
        )

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(5L to theme(5)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(PlayableKind.THEME, restored.currentEntry!!.item.key.kind)
        assertEquals(5L, restored.currentEntry!!.themeOrNull!!.id)
    }

    @Test
    fun `pre A02 legacy lists restore duplicates metadata and remap deleted current`() {
        val persisted = PersistedNowPlayingState(
            originalQueueIds = listOf(1, 2, 1, 3),
            nowPlayingIds = listOf(99, 1, 2, 1, 3),
            currentIndex = 2,
            historyIds = listOf(1, 99, 1),
            playNextItemIds = listOf(1, 1),
            addedToQueueItemIds = listOf(3, 99),
            suggestedItemIds = listOf(1)
        )

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(1L to theme(1), 3L to theme(3)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(listOf(1L, 1L, 3L), restored.nowPlaying.map { it.id })
        assertEquals(1, restored.currentIndex)
        assertEquals(1L, restored.currentTheme!!.id)
        assertEquals(3, restored.nowPlayingEntries.map { it.queueId }.distinct().size)
        assertEquals(restored.nowPlayingEntries.take(2).map { it.queueId }, restored.playNextEntryIds)
        assertEquals(listOf(restored.nowPlayingEntries.last().queueId), restored.addedToQueueEntryIds)
        assertEquals(listOf(restored.nowPlayingEntries.first().queueId), restored.suggestedEntryIds)
        assertEquals(
            restored.nowPlayingEntries.take(2).map { it.queueId },
            restored.historyEntries.map { it.queueId }
        )
    }

    @Test
    fun `typed persistence round trip preserves duplicate song occurrences`() {
        val song = SongEntity(10, "Song", "Artist", audioUrl = "song.flac")
        val entries = listOf(
            QueueEntry(51, PlayableItem.RelatedSong(song)),
            QueueEntry(52, PlayableItem.RelatedSong(song))
        )
        val persisted = NowPlayingState(
            originalQueueEntries = entries,
            nowPlayingEntries = entries,
            currentIndex = 1,
            playNextEntryIds = listOf(52)
        ).toPersistedState(0, 0)

        val restored = restorePersistedQueueState(
            persisted,
            themes = emptyMap(),
            songs = mapOf(song.id to song),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(listOf(51L, 52L), restored.nowPlayingEntries.map { it.queueId })
        assertEquals(listOf(song.id, song.id), restored.nowPlayingItems.map { it.key.id })
        assertEquals(listOf(52L), restored.playNextEntryIds)
        assertEquals(1, restored.currentIndex)
    }

    @Test
    fun `typed persistence preserves playlist entry and default policy`() {
        val policy = BaseModePolicy(ThemeModePolicy.FULL_SIZE, PlaybackMode.TV_SIZE)
        val entry = QueueEntry(70, PlayableItem.Theme(theme(1)), policy)
        val persisted = NowPlayingState(
            originalQueueEntries = listOf(entry),
            nowPlayingEntries = listOf(entry)
        ).toPersistedState(0, 0)

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(1L to theme(1)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(policy, restored.currentEntry!!.baseModePolicy)
    }

    @Test
    fun `typed persistence restores current audio mode override`() {
        listOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE).forEach { mode ->
            val entry = QueueEntry(80, PlayableItem.Theme(theme(1)))
            val persisted = NowPlayingState(
                originalQueueEntries = listOf(entry),
                nowPlayingEntries = listOf(entry),
                playbackIntent = PlaybackIntent(sessionOverride = mode)
            ).toPersistedState(0, 0)

            val restored = restorePersistedQueueState(
                persisted,
                themes = mapOf(1L to theme(1)),
                songs = emptyMap(),
                releases = emptyMap(),
                animeByKitsuId = emptyMap(),
                animeMap = emptyMap()
            )!!

            assertEquals(mode, restored.playbackIntent.sessionOverride)
        }
    }

    @Test
    fun `typed persistence restores Video override`() {
        val entry = QueueEntry(81, PlayableItem.Theme(theme(1)))
        val persisted = NowPlayingState(
            originalQueueEntries = listOf(entry),
            nowPlayingEntries = listOf(entry),
            playbackIntent = PlaybackIntent(sessionOverride = PlaybackMode.VIDEO)
        ).toPersistedState(0, 0)

        val restored = restorePersistedQueueState(
            persisted,
            themes = mapOf(1L to theme(1)),
            songs = emptyMap(),
            releases = emptyMap(),
            animeByKitsuId = emptyMap(),
            animeMap = emptyMap()
        )!!

        assertEquals(PlaybackMode.VIDEO, restored.playbackIntent.sessionOverride)
    }

    private fun theme(id: Long) = ThemeEntity(
        id = id,
        animeId = null,
        title = "Theme $id",
        artistName = null,
        audioUrl = "theme-$id.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    )

    private fun PersistedNowPlayingState.scoped() = copy(
        ownerKitsuUserId = "user-1",
        ownerServerBaseUrl = "https://server.example"
    )
}
