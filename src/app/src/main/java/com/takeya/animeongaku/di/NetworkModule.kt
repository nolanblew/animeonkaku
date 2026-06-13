package com.takeya.animeongaku.di

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapters.PolymorphicJsonAdapterFactory
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.BuildConfig
import com.takeya.animeongaku.data.filter.CustomRange
import com.takeya.animeongaku.data.filter.DateAnchor
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.auth.OngakuAuthRepository
import com.takeya.animeongaku.data.auth.OngakuAuthRepositoryImpl
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.network.OngakuAuthInterceptor
import com.takeya.animeongaku.network.OngakuBaseUrlInterceptor
import com.takeya.animeongaku.network.RetryInterceptor
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Named
import javax.inject.Singleton
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    @Suppress("DEPRECATION")
    fun provideMoshi(): Moshi {
        val filterNodeFactory = PolymorphicJsonAdapterFactory.of(FilterNode::class.java, "type")
            // Operators
            .withSubtype(FilterNode.And::class.java, "and")
            .withSubtype(FilterNode.Or::class.java, "or")
            .withSubtype(FilterNode.Not::class.java, "not")
            // Anime metadata leaves
            .withSubtype(FilterNode.GenreIn::class.java, "genre_in")
            .withSubtype(FilterNode.AiredOn::class.java, "aired_on")
            .withSubtype(FilterNode.SeasonIn::class.java, "season_in")
            .withSubtype(FilterNode.SubtypeIn::class.java, "subtype_in")
            .withSubtype(FilterNode.AverageRatingGte::class.java, "average_rating_gte")
            .withSubtype(FilterNode.UserRatingGte::class.java, "user_rating_gte")
            // Library/user leaves
            .withSubtype(FilterNode.WatchingStatusIn::class.java, "watching_status_in")
            .withSubtype(FilterNode.WatchedOn::class.java, "watched_on")
            // Theme leaves
            .withSubtype(FilterNode.ThemeTypeIn::class.java, "theme_type_in")
            .withSubtype(FilterNode.ArtistIn::class.java, "artist_in")
            .withSubtype(FilterNode.TitleMatches::class.java, "title_matches")
            .withSubtype(FilterNode.SongTitleMatches::class.java, "song_title_matches")
            .withSubtype(FilterNode.Liked::class.java, "liked")
            .withSubtype(FilterNode.Disliked::class.java, "disliked")
            .withSubtype(FilterNode.Downloaded::class.java, "downloaded")
            .withSubtype(FilterNode.PlayCountGte::class.java, "play_count_gte")
            .withSubtype(FilterNode.PlayedOn::class.java, "played_on")
            // Legacy nodes — kept for safe deserialization of old specs
            .withSubtype(FilterNode.AiredBefore::class.java, "aired_before")
            .withSubtype(FilterNode.AiredAfter::class.java, "aired_after")
            .withSubtype(FilterNode.AiredBetween::class.java, "aired_between")
            .withSubtype(FilterNode.LibraryUpdatedAfter::class.java, "library_updated_after")
            .withSubtype(FilterNode.LibraryUpdatedWithin::class.java, "library_updated_within")
            .withSubtype(FilterNode.PlayedSince::class.java, "played_since")

        val dateAnchorFactory = PolymorphicJsonAdapterFactory.of(DateAnchor::class.java, "type")
            .withSubtype(DateAnchor.AbsoluteYear::class.java, "absolute_year")
            .withSubtype(DateAnchor.Relative::class.java, "relative")

        val customRangeFactory = PolymorphicJsonAdapterFactory.of(CustomRange::class.java, "type")
            .withSubtype(CustomRange.Relative::class.java, "relative")
            .withSubtype(CustomRange.Exact::class.java, "exact")

        return Moshi.Builder()
            .add(filterNodeFactory)
            .add(dateAnchorFactory)
            .add(customRangeFactory)
            .add(KotlinJsonAdapterFactory())
            .build()
    }

    @Provides
    @Singleton
    @Named("base")
    fun provideBaseOkHttpClient(): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }

        return OkHttpClient.Builder()
            .addInterceptor(RetryInterceptor())
            .addInterceptor(logging)
            .build()
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(@Named("base") baseClient: OkHttpClient): OkHttpClient {
        return baseClient
    }

    @Provides
    @Singleton
    @Named("ongaku")
    fun provideOngakuOkHttpClient(
        @Named("base") baseClient: OkHttpClient,
        baseUrlInterceptor: OngakuBaseUrlInterceptor,
        authInterceptor: OngakuAuthInterceptor
    ): OkHttpClient {
        return baseClient.newBuilder()
            .addInterceptor(baseUrlInterceptor)
            .addInterceptor(authInterceptor)
            .build()
    }

    @Provides
    @Singleton
    @Named("ongaku")
    fun provideOngakuRetrofit(
        @Named("ongaku") okHttpClient: OkHttpClient,
        moshi: Moshi
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl("https://ongaku.local/")
            .client(okHttpClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
    }

    @Provides
    @Singleton
    fun provideOngakuApi(@Named("ongaku") retrofit: Retrofit): OngakuApi {
        return retrofit.create(OngakuApi::class.java)
    }

    @Provides
    @Singleton
    fun provideEncryptedPreferences(
        @ApplicationContext context: Context
    ): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            "kitsu_auth_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    @Provides
    @Singleton
    fun provideServerSettingsStore(prefs: SharedPreferences): ServerSettingsStore {
        return ServerSettingsStore(prefs, BuildConfig.ONGAKU_SERVER_BASE_URL)
    }

    @Provides
    @Singleton
    fun provideServerTokenStore(prefs: SharedPreferences): ServerTokenStore {
        return ServerTokenStore(prefs)
    }

    @Provides
    @Singleton
    fun provideOngakuAuthRepository(
        impl: OngakuAuthRepositoryImpl
    ): OngakuAuthRepository = impl
}
