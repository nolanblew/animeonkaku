package com.takeya.animeongaku.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [ThemeEntity::class, AnimeEntity::class],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun animeDao(): AnimeDao
    abstract fun themeDao(): ThemeDao
}
