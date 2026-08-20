package com.takeya.animeongaku

import androidx.room.testing.MigrationTestHelper
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.takeya.animeongaku.data.local.AppDatabase
import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.sync.MusicCatalogSnapshot
import com.takeya.animeongaku.sync.RoomLibraryPullCache
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        AppDatabase::class.java
    )

    @Test
    @Throws(IOException::class)
    fun migrate26To27DefaultsPlaylistPreferenceOverrideOff() {
        helper.createDatabase(DB_NAME, 26).apply {
            execSQL(
                """INSERT INTO playlists
                    (id, name, createdAt, isAuto, gradientSeed, defaultMode, updatedAt, deletedAt)
                    VALUES (7, 'Smart', 1, 1, 0, 'FULL_SIZE', 1, NULL)"""
            )
            close()
        }

        val db = helper.runMigrationsAndValidate(
            DB_NAME,
            27,
            true,
            AppDatabase.MIGRATION_26_27
        )

        db.query("SELECT defaultMode, overrideUserPreference FROM playlists WHERE id = 7").use { cursor ->
            cursor.moveToFirst()
            assertEquals("FULL_SIZE", cursor.getString(0))
            assertEquals(0, cursor.getInt(1))
        }
        db.close()
    }

    @Test
    @Throws(IOException::class)
    fun migrate25To26AddsNullablePreferredModeAndPreservesPreference() {
        helper.createDatabase(DB_NAME, 25).apply {
            execSQL(
                """INSERT INTO user_preferences
                    (themeId, isLiked, isDisliked, isDislikedTvSize, isDislikedFullSize, updatedAt, deletedAt)
                    VALUES (100, 1, 0, 0, 0, 1234, NULL)"""
            )
            close()
        }

        val db = helper.runMigrationsAndValidate(
            DB_NAME,
            26,
            true,
            AppDatabase.MIGRATION_25_26
        )

        db.query("SELECT isLiked, preferredMode, updatedAt FROM user_preferences WHERE themeId = 100").use { cursor ->
            cursor.moveToFirst()
            assertEquals(1, cursor.getInt(0))
            assertNull(cursor.getString(1))
            assertEquals(1234L, cursor.getLong(2))
        }
        db.close()
    }

    @Test
    @Throws(IOException::class)
    fun migrate22To23PreservesLegacyStateAndCreatesExactMediaKeys() {
        helper.createDatabase(DB_NAME, 22).apply {
            execSQL(
                """INSERT INTO anime
                    (kitsuId, animeThemesId, title, titleEn, titleRomaji, titleJa,
                     thumbnailUrl, thumbnailUrlLarge, coverUrl, coverUrlLarge, syncedAt,
                     isManuallyAdded, watchingStatus, subtype, startDate, endDate,
                     episodeCount, ageRating, averageRating, userRating, libraryUpdatedAt, slug)
                    VALUES ('1', 10, 'Anime', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                            1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)"""
            )
            execSQL(
                """INSERT INTO themes
                    (id, animeId, title, artistName, audioUrl, videoUrl, isDownloaded,
                     localFilePath, themeType, source)
                    VALUES (100, 10, 'OP1', 'Artist', 'https://old/audio/100', NULL,
                            1, '/data/audio/100.ogg', 'OP1', 'kitsu')"""
            )
            execSQL(
                """INSERT INTO playlists
                    (id, name, createdAt, isAuto, gradientSeed, updatedAt, deletedAt)
                    VALUES (7, 'Legacy', 1, 0, 0, 1, NULL)"""
            )
            execSQL("INSERT INTO playlist_entries (playlistId, themeId, orderIndex) VALUES (7, 100, 0)")
            execSQL(
                """INSERT INTO download_request
                    (themeId, status, progress, filePath, imagePath, fileSize, errorMessage,
                     createdAt, updatedAt, workManagerId)
                    VALUES (100, 'completed', 100, '/data/audio/100.ogg', NULL, 42,
                            NULL, 1, 2, 'work-1')"""
            )
            execSQL(
                """INSERT INTO download_request
                    (themeId, status, progress, filePath, imagePath, fileSize, errorMessage,
                     createdAt, updatedAt, workManagerId)
                    VALUES (101, 'failed', 20, NULL, NULL, 0, 'retry', 1, 2, 'work-2')"""
            )
            execSQL(
                """INSERT INTO download_group
                    (id, groupType, groupId, label, createdAt)
                    VALUES (3, 'playlist', '7', 'Legacy', 1)"""
            )
            execSQL("INSERT INTO download_group_theme (groupId, themeId) VALUES (3, 100)")
            execSQL("INSERT INTO download_group_theme (groupId, themeId) VALUES (3, 101)")
            execSQL("INSERT INTO pending_plays (id, themeId, playedAt, createdAt) VALUES (5, 100, 10, 11)")
            close()
        }

        val db = helper.runMigrationsAndValidate(
            DB_NAME,
            23,
            true,
            AppDatabase.MIGRATION_22_23
        )

        db.query("SELECT defaultMode FROM playlists WHERE id = 7").use { cursor ->
            cursor.moveToFirst()
            assertEquals("TV_SIZE", cursor.getString(0))
        }
        db.query(
            "SELECT entryId, itemType, itemId, modeOverride FROM playlist_entries WHERE playlistId = 7"
        ).use { cursor ->
            cursor.moveToFirst()
            assertEquals(100L, cursor.getLong(0))
            assertEquals("THEME", cursor.getString(1))
            assertEquals(100L, cursor.getLong(2))
            assertNull(cursor.getString(3))
        }
        db.query(
            "SELECT mediaKey, mode, status, filePath FROM download_items WHERE legacyThemeId = 100"
        ).use { cursor ->
            cursor.moveToFirst()
            assertEquals("THEME:100:TV_SIZE", cursor.getString(0))
            assertEquals("TV_SIZE", cursor.getString(1))
            assertEquals("completed", cursor.getString(2))
            assertEquals("/data/audio/100.ogg", cursor.getString(3))
        }
        db.query("SELECT mediaKey FROM download_group_items WHERE groupId = 3").use { cursor ->
            cursor.moveToFirst()
            assertEquals("THEME:100:TV_SIZE", cursor.getString(0))
            assertEquals(1, cursor.count)
        }
        db.query("SELECT COUNT(*) FROM download_items WHERE legacyThemeId = 101").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0, cursor.getInt(0))
        }
        db.query("SELECT tvSizeUrl FROM theme_modes WHERE themeId = 100").use { cursor ->
            cursor.moveToFirst()
            assertEquals("https://old/audio/100", cursor.getString(0))
        }
        db.query("SELECT itemType, itemId, actualMode FROM pending_plays WHERE id = 5").use { cursor ->
            cursor.moveToFirst()
            assertEquals("THEME", cursor.getString(0))
            assertEquals(100L, cursor.getLong(1))
            assertEquals("TV_SIZE", cursor.getString(2))
        }
        db.close()
    }

    @Test
    fun replacingCatalogSnapshotPreservesIndependentDownloadItems() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            AppDatabase::class.java
        ).allowMainThreadQueries().build()
        val cache = RoomLibraryPullCache(
            database = database,
            animeDao = database.animeDao(),
            themeDao = database.themeDao(),
            artistDao = database.artistDao(),
            genreDao = database.genreDao(),
            userPreferenceDao = database.userPreferenceDao(),
            playCountDao = database.playCountDao(),
            pendingOpDao = database.pendingOpDao(),
            playlistDao = database.playlistDao(),
            dynamicPlaylistSpecDao = database.dynamicPlaylistSpecDao(),
            themeModeDao = database.themeModeDao(),
            musicCatalogDao = database.musicCatalogDao(),
            songPreferenceDao = database.songPreferenceDao()
        )
        val download = DownloadItemEntity(
            mediaKey = DownloadItemEntity.songMediaKey(300),
            itemType = "SONG",
            itemId = 300,
            mode = "AUDIO",
            status = "completed",
            filePath = "/data/song-300.flac",
            createdAt = 1,
            updatedAt = 2
        )
        database.downloadItemDao().upsert(download)

        cache.replaceMusicCatalog(
            MusicCatalogSnapshot(
                songs = emptyList(),
                releases = emptyList(),
                releaseTracks = emptyList(),
                animeReleases = emptyList()
            )
        )

        assertEquals(download, database.downloadItemDao().get(download.mediaKey))
        database.close()
    }

    private companion object {
        const val DB_NAME = "mc-a01-migration-test"
    }
}
