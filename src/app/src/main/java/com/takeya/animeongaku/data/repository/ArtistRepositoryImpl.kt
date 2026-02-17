package com.takeya.animeongaku.data.repository

import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.ArtistImageEntity
import com.takeya.animeongaku.data.remote.AnimeThemesArtistResponse
import com.takeya.animeongaku.data.remote.ApiArtistImage
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

@Singleton
class ArtistRepositoryImpl @Inject constructor(
    @param:Named("base") private val okHttpClient: OkHttpClient,
    private val moshi: Moshi,
    private val artistImageDao: ArtistImageDao
) : ArtistRepository {
    override suspend fun refreshArtistImages(names: List<String>) {
        val normalized = names.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        if (normalized.isEmpty()) return

        val existing = artistImageDao.getByNames(normalized)
            .associateBy { it.name.lowercase() }
        val missing = normalized.filter { name ->
            val cached = existing[name.lowercase()]
            cached?.imageUrl.isNullOrBlank()
        }
        if (missing.isEmpty()) return

        val now = System.currentTimeMillis()
        val updates = mutableListOf<ArtistImageEntity>()
        missing.forEach { name ->
            val imageUrl = fetchArtistImage(name)
            updates += ArtistImageEntity(
                name = name,
                imageUrl = imageUrl,
                updatedAt = now
            )
        }
        if (updates.isNotEmpty()) {
            artistImageDao.upsertAll(updates)
        }
    }

    private suspend fun fetchArtistImage(name: String): String? {
        val requestUrl = "https://api.animethemes.moe/artist".toHttpUrl()
            .newBuilder()
            .addQueryParameter("filter[name]", name)
            .addQueryParameter("include", "images")
            .build()

        val request = Request.Builder()
            .url(requestUrl)
            .get()
            .build()

        val adapter = moshi.adapter(AnimeThemesArtistResponse::class.java)
        return withContext(Dispatchers.IO) {
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val body = response.body?.string() ?: return@use null
                val payload = adapter.fromJson(body) ?: return@use null
                val artist = payload.artists.firstOrNull { it.name?.equals(name, ignoreCase = true) == true }
                    ?: payload.artists.firstOrNull()
                artist?.images?.bestImageUrl()
            }
        }
    }
}

private fun List<ApiArtistImage>.bestImageUrl(): String? {
    if (isEmpty()) return null
    val preferred = firstOrNull { it.facet?.contains("Small", ignoreCase = true) == true && !it.link.isNullOrBlank() }
        ?: firstOrNull { it.facet?.contains("Large", ignoreCase = true) == true && !it.link.isNullOrBlank() }
        ?: firstOrNull { !it.link.isNullOrBlank() }
    return preferred?.link
}
