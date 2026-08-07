package com.takeya.animeongaku.di

import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.ArtistRepository
import com.takeya.animeongaku.data.repository.ArtistRepositoryImpl
import com.takeya.animeongaku.data.repository.ServerAnimeRepository
import com.takeya.animeongaku.data.repository.MusicRequestRepository
import com.takeya.animeongaku.data.repository.ServerMusicRequestRepository
import com.takeya.animeongaku.sync.InitialLibrarySync
import com.takeya.animeongaku.sync.LibraryPullServerUserStateRefresher
import com.takeya.animeongaku.sync.LibraryPullManager
import com.takeya.animeongaku.sync.LibraryPuller
import com.takeya.animeongaku.sync.ServerInitialLibrarySync
import com.takeya.animeongaku.sync.ServerUserStateRefresher
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
    abstract fun bindMusicRequestRepository(
        impl: ServerMusicRequestRepository
    ): MusicRequestRepository

    @Binds
    @Singleton
    abstract fun bindArtistRepository(impl: ArtistRepositoryImpl): ArtistRepository

    @Binds
    @Singleton
    abstract fun bindServerUserStateRefresher(
        impl: LibraryPullServerUserStateRefresher
    ): ServerUserStateRefresher

    @Binds
    @Singleton
    abstract fun bindLibraryPuller(impl: LibraryPullManager): LibraryPuller

    @Binds
    @Singleton
    abstract fun bindInitialLibrarySync(impl: ServerInitialLibrarySync): InitialLibrarySync
}
