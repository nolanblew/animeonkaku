package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.ArtistImageEntity
import com.takeya.animeongaku.data.repository.ArtistRepositoryImpl
import java.net.UnknownHostException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ArtistRepositoryImplTest {

    @Test
    fun `refreshArtistImages swallows offline lookup failures`() = runBlocking {
        val artistImageDao = FakeArtistImageDao()
        val repository = ArtistRepositoryImpl(
            okHttpClient = OkHttpClient.Builder()
                .addInterceptor { throw UnknownHostException("offline") }
                .build(),
            moshi = Moshi.Builder()
                .add(KotlinJsonAdapterFactory())
                .build(),
            artistImageDao = artistImageDao
        )

        repository.refreshArtistImages(listOf("LiSA"))

        val cached = artistImageDao.getByNames(listOf("LiSA")).singleOrNull()
        assertNotNull(cached)
        assertEquals("LiSA", cached?.name)
        assertNull(cached?.imageUrl)
    }
}

private class FakeArtistImageDao : ArtistImageDao {
    private val stored = linkedMapOf<String, ArtistImageEntity>()

    override fun observeByNames(names: List<String>): Flow<List<ArtistImageEntity>> =
        flowOf(names.mapNotNull(stored::get))

    override suspend fun getByNames(names: List<String>): List<ArtistImageEntity> =
        names.mapNotNull(stored::get)

    override suspend fun upsertAll(images: List<ArtistImageEntity>) {
        images.forEach { image -> stored[image.name] = image }
    }
}
