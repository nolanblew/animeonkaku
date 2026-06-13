package com.takeya.animeongaku.di

import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.ArtistRepository
import com.takeya.animeongaku.data.repository.ArtistRepositoryImpl
import com.takeya.animeongaku.data.repository.ServerAnimeRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds
    @Singleton
    abstract fun bindAnimeRepository(impl: ServerAnimeRepository): AnimeRepository

    @Binds
    @Singleton
    abstract fun bindArtistRepository(impl: ArtistRepositoryImpl): ArtistRepository
}
