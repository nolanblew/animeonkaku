package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.ArtistImageEntity
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.resolveServerUrl
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ArtistRepositoryImpl @Inject constructor(
    private val ongakuApi: OngakuApi,
    private val serverSettingsStore: ServerSettingsStore,
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
        return try {
            val artists = ongakuApi.search(name).animeThemes.search.artists
            val artist = artists.firstOrNull { it.name?.equals(name, ignoreCase = true) == true }
                ?: artists.firstOrNull()
            val slug = artist?.slug?.takeIf { it.isNotBlank() } ?: return null
            resolveServerUrl(serverSettingsStore.serverBaseUrl.orEmpty(), "/v1/media/images/artists/$slug")
        } catch (_: Exception) {
            null
        }
    }
}
