package com.takeya.animeongaku.di

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapters.PolymorphicJsonAdapterFactory
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.BuildConfig
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.auth.KitsuAuthRepository
import com.takeya.animeongaku.data.auth.KitsuAuthRepositoryImpl
import com.takeya.animeongaku.data.auth.KitsuTokenStore
import com.takeya.animeongaku.data.remote.ApiConstants
import com.takeya.animeongaku.data.remote.KitsuApi
import com.takeya.animeongaku.data.remote.KitsuAuthApi
import com.takeya.animeongaku.network.KitsuAuthInterceptor
import com.takeya.animeongaku.network.RateLimitInterceptor
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
    fun provideMoshi(): Moshi {
        val filterNodeFactory = PolymorphicJsonAdapterFactory.of(FilterNode::class.java, "type")
            // Operators
            .withSubtype(FilterNode.And::class.java, "and")
            .withSubtype(FilterNode.Or::class.java, "or")
            .withSubtype(FilterNode.Not::class.java, "not")
            // Anime metadata leaves
            .withSubtype(FilterNode.GenreIn::class.java, "genre_in")
            .withSubtype(FilterNode.AiredBefore::class.java, "aired_before")
            .withSubtype(FilterNode.AiredAfter::class.java, "aired_after")
            .withSubtype(FilterNode.AiredBetween::class.java, "aired_between")
            .withSubtype(FilterNode.SeasonIn::class.java, "season_in")
            .withSubtype(FilterNode.SubtypeIn::class.java, "subtype_in")
            .withSubtype(FilterNode.AverageRatingGte::class.java, "average_rating_gte")
            .withSubtype(FilterNode.UserRatingGte::class.java, "user_rating_gte")
            // Library/user leaves
            .withSubtype(FilterNode.WatchingStatusIn::class.java, "watching_status_in")
            .withSubtype(FilterNode.LibraryUpdatedAfter::class.java, "library_updated_after")
            .withSubtype(FilterNode.LibraryUpdatedWithin::class.java, "library_updated_within")
            // Theme leaves
            .withSubtype(FilterNode.ThemeTypeIn::class.java, "theme_type_in")
            .withSubtype(FilterNode.ArtistIn::class.java, "artist_in")
            .withSubtype(FilterNode.Liked::class.java, "liked")
            .withSubtype(FilterNode.Disliked::class.java, "disliked")
            .withSubtype(FilterNode.Downloaded::class.java, "downloaded")
            .withSubtype(FilterNode.PlayCountGte::class.java, "play_count_gte")
            .withSubtype(FilterNode.PlayedSince::class.java, "played_since")

        return Moshi.Builder()
            .add(filterNodeFactory)
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
            .addInterceptor(RateLimitInterceptor())
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
    @Named("kitsu")
    fun provideKitsuOkHttpClient(
        @Named("base") baseClient: OkHttpClient,
        kitsuAuthInterceptor: KitsuAuthInterceptor
    ): OkHttpClient {
        return baseClient.newBuilder()
            .addInterceptor(kitsuAuthInterceptor)
            .build()
    }

    @Provides
    @Singleton
    @Named("kitsu")
    fun provideKitsuRetrofit(
        @Named("kitsu") okHttpClient: OkHttpClient,
        moshi: Moshi
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl(ApiConstants.KITSU_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
    }

    @Provides
    @Singleton
    @Named("auth")
    fun provideAuthRetrofit(
        @Named("base") okHttpClient: OkHttpClient,
        moshi: Moshi
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl(ApiConstants.KITSU_AUTH_URL)
            .client(okHttpClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
    }

    @Provides
    @Singleton
    fun provideKitsuApi(@Named("kitsu") retrofit: Retrofit): KitsuApi {
        return retrofit.create(KitsuApi::class.java)
    }

    @Provides
    @Singleton
    fun provideKitsuAuthApi(@Named("auth") retrofit: Retrofit): KitsuAuthApi {
        return retrofit.create(KitsuAuthApi::class.java)
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
    fun provideTokenStore(prefs: SharedPreferences): KitsuTokenStore {
        return KitsuTokenStore(prefs)
    }

    @Provides
    @Singleton
    fun provideKitsuAuthRepository(
        impl: KitsuAuthRepositoryImpl
    ): KitsuAuthRepository = impl
}
