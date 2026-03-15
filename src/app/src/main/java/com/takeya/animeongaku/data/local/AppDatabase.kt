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
        PlayCountEntity::class
    ],
    version = 12,
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun animeDao(): AnimeDao
    abstract fun artistImageDao(): ArtistImageDao
    abstract fun playlistDao(): PlaylistDao
    abstract fun themeDao(): ThemeDao
    abstract fun artistDao(): ArtistDao
    abstract fun playCountDao(): PlayCountDao

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
    }
}
