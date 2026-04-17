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
        DynamicPlaylistSpecEntity::class
    ],
    version = 18,
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
    }
}
