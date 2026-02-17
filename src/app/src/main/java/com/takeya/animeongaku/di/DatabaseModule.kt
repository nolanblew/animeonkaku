package com.takeya.animeongaku.di

import android.content.Context
import androidx.room.Room
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AppDatabase
import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.ThemeDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context
    ): AppDatabase = Room.databaseBuilder(
        context,
        AppDatabase::class.java,
        "anime_ongaku.db"
    ).fallbackToDestructiveMigration(true).build()

    @Provides
    fun provideAnimeDao(database: AppDatabase): AnimeDao = database.animeDao()

    @Provides
    fun providePlaylistDao(database: AppDatabase): PlaylistDao = database.playlistDao()

    @Provides
    fun provideThemeDao(database: AppDatabase): ThemeDao = database.themeDao()

    @Provides
    fun provideArtistImageDao(database: AppDatabase): ArtistImageDao = database.artistImageDao()
}
