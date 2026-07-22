package com.takeya.animeongaku.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        ThemeEntity::class,
        AnimeEntity::class,
        PlaylistEntity::class,
        PlaylistEntryEntity::class,
        ArtistImageEntity::class,
        ThemeArtistCrossRef::class,
        PlayCountEntity::class,
        DownloadRequestEntity::class,
        DownloadGroupEntity::class,
        DownloadGroupThemeEntity::class,
        UserPreferenceEntity::class,
        GenreEntity::class,
        AnimeGenreCrossRef::class,
        DynamicPlaylistSpecEntity::class,
        PendingPlayEntity::class,
        PendingOpEntity::class,
        SongEntity::class,
        MusicReleaseEntity::class,
        ReleaseTrackEntity::class,
        AnimeMusicReleaseEntity::class,
        ThemeModeEntity::class,
        SongPreferenceEntity::class,
        DownloadItemEntity::class,
        DownloadGroupItemEntity::class
    ],
    version = 23,
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun animeDao(): AnimeDao
    abstract fun artistImageDao(): ArtistImageDao
    abstract fun playlistDao(): PlaylistDao
    abstract fun themeDao(): ThemeDao
    abstract fun artistDao(): ArtistDao
    abstract fun playCountDao(): PlayCountDao
    abstract fun downloadDao(): DownloadDao
    abstract fun userPreferenceDao(): UserPreferenceDao
    abstract fun genreDao(): GenreDao
    abstract fun dynamicPlaylistSpecDao(): DynamicPlaylistSpecDao
    abstract fun pendingPlayDao(): PendingPlayDao
    abstract fun pendingOpDao(): PendingOpDao
    abstract fun musicCatalogDao(): MusicCatalogDao
    abstract fun themeModeDao(): ThemeModeDao
    abstract fun songPreferenceDao(): SongPreferenceDao
    abstract fun downloadItemDao(): DownloadItemDao

    companion object {
        val MIGRATION_9_10 = object : Migration(9, 10) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `play_count` (
                        `themeId` INTEGER NOT NULL,
                        `playCount` INTEGER NOT NULL,
                        `lastPlayedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`themeId`)
                    )"""
                )
            }
        }

        val MIGRATION_10_11 = object : Migration(10, 11) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `playlists` ADD COLUMN `isAuto` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `playlists` ADD COLUMN `gradientSeed` INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_11_12 = object : Migration(11, 12) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `isManuallyAdded` INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_12_13 = object : Migration(12, 13) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `download_request` (
                        `themeId` INTEGER NOT NULL,
                        `status` TEXT NOT NULL,
                        `progress` INTEGER NOT NULL DEFAULT 0,
                        `filePath` TEXT,
                        `imagePath` TEXT,
                        `fileSize` INTEGER NOT NULL DEFAULT 0,
                        `errorMessage` TEXT,
                        `createdAt` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        `workManagerId` TEXT,
                        PRIMARY KEY(`themeId`)
                    )"""
                )
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `download_group` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `groupType` TEXT NOT NULL,
                        `groupId` TEXT NOT NULL,
                        `label` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL
                    )"""
                )
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `download_group_theme` (
                        `groupId` INTEGER NOT NULL,
                        `themeId` INTEGER NOT NULL,
                        PRIMARY KEY(`groupId`, `themeId`)
                    )"""
                )
            }
        }

        val MIGRATION_13_14 = object : Migration(13, 14) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `user_preferences` (
                        `themeId` INTEGER NOT NULL,
                        `isLiked` INTEGER NOT NULL DEFAULT 0,
                        `isDisliked` INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY(`themeId`)
                    )"""
                )
            }
        }

        val MIGRATION_14_15 = object : Migration(14, 15) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `watchingStatus` TEXT")
            }
        }

        val MIGRATION_15_16 = object : Migration(15, 16) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `thumbnailUrlLarge` TEXT")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `coverUrlLarge` TEXT")
            }
        }

        val MIGRATION_16_17 = object : Migration(16, 17) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // New nullable columns on anime
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `subtype` TEXT")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `startDate` TEXT")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `endDate` TEXT")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `episodeCount` INTEGER")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `ageRating` TEXT")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `averageRating` REAL")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `userRating` REAL")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `libraryUpdatedAt` INTEGER")
                db.execSQL("ALTER TABLE `anime` ADD COLUMN `slug` TEXT")
                // Genres
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `genres` (
                        `slug` TEXT NOT NULL,
                        `displayName` TEXT NOT NULL,
                        `source` TEXT NOT NULL,
                        PRIMARY KEY(`slug`)
                    )
                """.trimIndent())
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `anime_genres` (
                        `kitsuId` TEXT NOT NULL,
                        `slug` TEXT NOT NULL,
                        PRIMARY KEY(`kitsuId`, `slug`),
                        FOREIGN KEY(`kitsuId`) REFERENCES `anime`(`kitsuId`) ON DELETE CASCADE
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_anime_genres_slug` ON `anime_genres` (`slug`)")
                // Dynamic playlist spec
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `dynamic_playlist_spec` (
                        `playlistId` INTEGER NOT NULL,
                        `filterJson` TEXT NOT NULL,
                        `mode` TEXT NOT NULL,
                        `createdMode` TEXT NOT NULL,
                        `lastEvaluatedAt` INTEGER NOT NULL DEFAULT 0,
                        `lastResultCount` INTEGER NOT NULL DEFAULT 0,
                        `schemaVersion` INTEGER NOT NULL DEFAULT 1,
                        PRIMARY KEY(`playlistId`),
                        FOREIGN KEY(`playlistId`) REFERENCES `playlists`(`id`) ON DELETE CASCADE
                    )
                """.trimIndent())
            }
        }

        val MIGRATION_17_18 = object : Migration(17, 18) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `dynamic_playlist_spec` ADD COLUMN `sortJson` TEXT")
            }
        }

        val MIGRATION_18_19 = object : Migration(18, 19) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `dynamic_playlist_spec` ADD COLUMN `simpleStateJson` TEXT")
            }
        }

        val MIGRATION_19_20 = object : Migration(19, 20) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `pending_plays` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `themeId` INTEGER NOT NULL,
                        `playedAt` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_pending_plays_themeId` ON `pending_plays` (`themeId`)")
            }
        }

        val MIGRATION_20_21 = object : Migration(20, 21) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `pending_ops` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `entityType` TEXT NOT NULL,
                        `entityKey` TEXT NOT NULL,
                        `opType` TEXT NOT NULL,
                        `payloadJson` TEXT NOT NULL,
                        `opTs` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `attempts` INTEGER NOT NULL DEFAULT 0
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_pending_ops_createdAt` ON `pending_ops` (`createdAt`)")
            }
        }

        val MIGRATION_21_22 = object : Migration(21, 22) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `user_preferences` ADD COLUMN `updatedAt` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `user_preferences` ADD COLUMN `deletedAt` INTEGER")
                db.execSQL("ALTER TABLE `playlists` ADD COLUMN `updatedAt` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("UPDATE `playlists` SET `updatedAt` = `createdAt` WHERE `updatedAt` = 0")
                db.execSQL("ALTER TABLE `playlists` ADD COLUMN `deletedAt` INTEGER")
                db.execSQL("ALTER TABLE `dynamic_playlist_spec` ADD COLUMN `serverManaged` INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_22_23 = object : Migration(22, 23) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `playlists` ADD COLUMN `defaultMode` TEXT NOT NULL DEFAULT 'TV_SIZE'")

                db.execSQL("ALTER TABLE `playlist_entries` RENAME TO `playlist_entries_legacy`")
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `playlist_entries` (
                        `playlistId` INTEGER NOT NULL,
                        `themeId` INTEGER,
                        `orderIndex` INTEGER NOT NULL,
                        `entryId` INTEGER NOT NULL,
                        `itemType` TEXT NOT NULL,
                        `itemId` INTEGER NOT NULL,
                        `modeOverride` TEXT,
                        PRIMARY KEY(`playlistId`, `entryId`)
                    )"""
                )
                db.execSQL(
                    """INSERT INTO `playlist_entries`
                        (`playlistId`, `themeId`, `orderIndex`, `entryId`, `itemType`, `itemId`, `modeOverride`)
                        SELECT `playlistId`, `themeId`, `orderIndex`, `themeId`, 'THEME', `themeId`, NULL
                        FROM `playlist_entries_legacy`"""
                )
                db.execSQL("DROP TABLE `playlist_entries_legacy`")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_playlist_entries_itemType_itemId` ON `playlist_entries` (`itemType`, `itemId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_playlist_entries_themeId` ON `playlist_entries` (`themeId`)")

                db.execSQL("ALTER TABLE `user_preferences` ADD COLUMN `isDislikedTvSize` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `user_preferences` ADD COLUMN `isDislikedFullSize` INTEGER NOT NULL DEFAULT 0")

                db.execSQL("ALTER TABLE `pending_plays` ADD COLUMN `clientEventId` TEXT")
                db.execSQL("ALTER TABLE `pending_plays` ADD COLUMN `itemType` TEXT NOT NULL DEFAULT 'THEME'")
                db.execSQL("ALTER TABLE `pending_plays` ADD COLUMN `itemId` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `pending_plays` ADD COLUMN `actualMode` TEXT NOT NULL DEFAULT 'TV_SIZE'")
                db.execSQL("UPDATE `pending_plays` SET `itemId` = `themeId` WHERE `itemId` = 0")

                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `songs` (
                        `id` INTEGER NOT NULL,
                        `title` TEXT NOT NULL,
                        `artistCredit` TEXT NOT NULL,
                        `durationSeconds` INTEGER,
                        `audioUrl` TEXT NOT NULL,
                        `fileSize` INTEGER,
                        PRIMARY KEY(`id`)
                    )"""
                )
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `music_releases` (
                        `id` INTEGER NOT NULL,
                        `title` TEXT NOT NULL,
                        `artistCredit` TEXT NOT NULL,
                        `releaseDate` TEXT,
                        `year` INTEGER,
                        `artworkUrl` TEXT,
                        PRIMARY KEY(`id`)
                    )"""
                )
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `release_tracks` (
                        `releaseId` INTEGER NOT NULL,
                        `songId` INTEGER NOT NULL,
                        `discNumber` INTEGER NOT NULL,
                        `trackNumber` INTEGER,
                        `displayOrder` INTEGER NOT NULL,
                        PRIMARY KEY(`releaseId`, `songId`),
                        FOREIGN KEY(`releaseId`) REFERENCES `music_releases`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE,
                        FOREIGN KEY(`songId`) REFERENCES `songs`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
                    )"""
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_release_tracks_songId` ON `release_tracks` (`songId`)")
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `anime_music_releases` (
                        `kitsuAnimeId` TEXT NOT NULL,
                        `releaseId` INTEGER NOT NULL,
                        `relationshipType` TEXT NOT NULL,
                        PRIMARY KEY(`kitsuAnimeId`, `releaseId`),
                        FOREIGN KEY(`kitsuAnimeId`) REFERENCES `anime`(`kitsuId`) ON UPDATE NO ACTION ON DELETE CASCADE,
                        FOREIGN KEY(`releaseId`) REFERENCES `music_releases`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
                    )"""
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_anime_music_releases_releaseId` ON `anime_music_releases` (`releaseId`)")
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `theme_modes` (
                        `themeId` INTEGER NOT NULL,
                        `tvSizeUrl` TEXT NOT NULL,
                        `tvSizeDurationSeconds` INTEGER,
                        `tvSizeFileSize` INTEGER,
                        `fullSizeSongId` INTEGER,
                        `fullSizeUrl` TEXT,
                        `fullSizeDurationSeconds` INTEGER,
                        `fullSizeFileSize` INTEGER,
                        `fullSizeSourceReleaseId` INTEGER,
                        `videoUrl` TEXT,
                        `videoMimeType` TEXT,
                        `videoSpoiler` INTEGER NOT NULL,
                        `videoNsfw` INTEGER NOT NULL,
                        `videoEntryVersion` INTEGER,
                        PRIMARY KEY(`themeId`),
                        FOREIGN KEY(`themeId`) REFERENCES `themes`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
                    )"""
                )
                db.execSQL(
                    """INSERT INTO `theme_modes`
                        (`themeId`, `tvSizeUrl`, `tvSizeDurationSeconds`, `tvSizeFileSize`,
                         `videoSpoiler`, `videoNsfw`)
                        SELECT `id`, `audioUrl`, NULL, NULL, 0, 0 FROM `themes`"""
                )
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `song_preferences` (
                        `songId` INTEGER NOT NULL,
                        `isLiked` INTEGER NOT NULL,
                        `isDisliked` INTEGER NOT NULL,
                        `playCount` INTEGER NOT NULL,
                        `lastPlayedAt` INTEGER,
                        `updatedAt` INTEGER NOT NULL,
                        `deletedAt` INTEGER,
                        PRIMARY KEY(`songId`)
                    )"""
                )

                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `download_items` (
                        `mediaKey` TEXT NOT NULL,
                        `itemType` TEXT NOT NULL,
                        `itemId` INTEGER NOT NULL,
                        `mode` TEXT NOT NULL,
                        `status` TEXT NOT NULL,
                        `progress` INTEGER NOT NULL,
                        `filePath` TEXT,
                        `imagePath` TEXT,
                        `fileSize` INTEGER NOT NULL,
                        `errorMessage` TEXT,
                        `createdAt` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        `workManagerId` TEXT,
                        `legacyThemeId` INTEGER,
                        PRIMARY KEY(`mediaKey`)
                    )"""
                )
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_download_items_itemType_itemId_mode` ON `download_items` (`itemType`, `itemId`, `mode`)")
                db.execSQL(
                    """INSERT INTO `download_items`
                        (`mediaKey`, `itemType`, `itemId`, `mode`, `status`, `progress`, `filePath`,
                         `imagePath`, `fileSize`, `errorMessage`, `createdAt`, `updatedAt`,
                         `workManagerId`, `legacyThemeId`)
                        SELECT 'THEME:' || `themeId` || ':TV_SIZE', 'THEME', `themeId`, 'TV_SIZE',
                               `status`, `progress`, `filePath`, `imagePath`, `fileSize`, `errorMessage`,
                               `createdAt`, `updatedAt`, `workManagerId`, `themeId`
                        FROM `download_request`
                        WHERE `status` = 'completed'"""
                )
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `download_group_items` (
                        `groupId` INTEGER NOT NULL,
                        `mediaKey` TEXT NOT NULL,
                        PRIMARY KEY(`groupId`, `mediaKey`)
                    )"""
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_download_group_items_mediaKey` ON `download_group_items` (`mediaKey`)")
                db.execSQL(
                    """INSERT INTO `download_group_items` (`groupId`, `mediaKey`)
                        SELECT dgt.`groupId`, 'THEME:' || dgt.`themeId` || ':TV_SIZE'
                        FROM `download_group_theme` dgt
                        INNER JOIN `download_request` dr ON dr.`themeId` = dgt.`themeId`
                        WHERE dr.`status` = 'completed'"""
                )
            }
        }
    }
}
