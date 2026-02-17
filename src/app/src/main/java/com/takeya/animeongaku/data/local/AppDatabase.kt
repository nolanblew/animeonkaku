package com.takeya.animeongaku.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        ThemeEntity::class,
        AnimeEntity::class,
        PlaylistEntity::class,
        PlaylistEntryEntity::class,
        ArtistImageEntity::class,
        ThemeArtistCrossRef::class
    ],
    version = 8,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun animeDao(): AnimeDao
    abstract fun artistImageDao(): ArtistImageDao
    abstract fun playlistDao(): PlaylistDao
    abstract fun themeDao(): ThemeDao
    abstract fun artistDao(): ArtistDao
}
