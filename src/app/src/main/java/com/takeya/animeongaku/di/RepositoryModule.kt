package com.takeya.animeongaku.di

import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.AnimeRepositoryImpl
import com.takeya.animeongaku.data.repository.UserRepository
import com.takeya.animeongaku.data.repository.UserRepositoryImpl
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
    abstract fun bindUserRepository(impl: UserRepositoryImpl): UserRepository

    @Binds
    @Singleton
    abstract fun bindAnimeRepository(impl: AnimeRepositoryImpl): AnimeRepository
}
