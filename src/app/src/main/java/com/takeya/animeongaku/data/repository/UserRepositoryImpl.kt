package com.takeya.animeongaku.data.repository

import android.util.Log
import com.takeya.animeongaku.data.model.KitsuAnimeEntry
import com.takeya.animeongaku.data.remote.KitsuApi
import com.takeya.animeongaku.data.remote.KitsuAnime
import com.takeya.animeongaku.data.remote.KitsuLibraryEntry
import com.takeya.animeongaku.data.remote.KitsuImageSet
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepositoryImpl @Inject constructor(
    private val kitsuApi: KitsuApi
) : UserRepository {
    override suspend fun findUserId(username: String): String? {
        val response = kitsuApi.findUser(username)
        val exactMatch = response.data.firstOrNull {
            it.attributes?.slug?.equals(username, ignoreCase = true) == true
        }
        return (exactMatch ?: response.data.firstOrNull())?.id
    }

    override suspend fun getAuthenticatedUserId(): String? {
        return kitsuApi.getSelfUser().data.firstOrNull()?.id
    }

    override suspend fun getLibraryEntries(
        userId: String,
        onProgress: (LibrarySyncProgress) -> Unit
    ): List<KitsuAnimeEntry> {
        val results = mutableListOf<KitsuAnimeEntry>()
        var offset = 0
        val limit = 500
        var page = 1

        while (true) {
            val response = kitsuApi.getLibraryEntries(
                userId = userId,
                limit = limit,
                offset = offset
            )
            val animeById = response.included.associateBy { it.id }

            val pageResults = response.data.mapNotNull { entry ->
                val animeId = entry.animeId() ?: return@mapNotNull null
                val anime = animeById[animeId]
                KitsuAnimeEntry(
                    id = animeId,
                    title = anime?.displayTitle(),
                    titleEn = anime?.titleEn(),
                    titleRomaji = anime?.titleRomaji(),
                    titleJa = anime?.titleJa(),
                    abbreviatedTitles = anime?.abbreviatedTitles() ?: emptyList(),
                    posterUrl = anime?.posterUrl(),
                    coverUrl = anime?.coverUrl()
                )
            }
            results.addAll(pageResults)

            val totalCount = response.meta?.count
            val totalPages = totalCount?.let { (it + limit - 1) / limit }
            val isLastPage = response.data.size < limit
            onProgress(
                LibrarySyncProgress(
                    page = page,
                    totalPages = totalPages,
                    fetchedCount = results.size,
                    totalCount = totalCount,
                    isLastPage = isLastPage
                )
            )

            if (isLastPage) break
            offset += limit
            page += 1
        }

        val missingIds = results
            .filter { it.title.isNullOrBlank() || it.posterUrl.isNullOrBlank() || it.coverUrl.isNullOrBlank() }
            .map { it.id }
            .distinct()

        if (missingIds.isEmpty()) {
            return results
        }

        val detailsById = fetchAnimeDetailsByIds(missingIds)
        if (detailsById.isEmpty()) {
            return results
        }

        return results.map { entry ->
            val details = detailsById[entry.id] ?: return@map entry
            entry.copy(
                title = entry.title ?: details.displayTitle(),
                titleEn = entry.titleEn ?: details.titleEn(),
                titleRomaji = entry.titleRomaji ?: details.titleRomaji(),
                titleJa = entry.titleJa ?: details.titleJa(),
                posterUrl = entry.posterUrl ?: details.posterUrl(),
                coverUrl = entry.coverUrl ?: details.coverUrl()
            )
        }
    }

    override suspend fun getLibraryEntriesDelta(
        userId: String,
        knownKitsuIds: Set<String>,
        onProgress: (LibrarySyncProgress) -> Unit
    ): List<KitsuAnimeEntry> {
        val newEntries = mutableListOf<KitsuAnimeEntry>()
        var offset = 0
        val limit = 500
        var page = 1

        while (true) {
            val response = kitsuApi.getLibraryEntries(
                userId = userId,
                sort = "-updatedAt",
                limit = limit,
                offset = offset
            )
            val animeById = response.included.associateBy { it.id }

            val pageEntries = response.data.mapNotNull { entry ->
                val animeId = entry.animeId() ?: return@mapNotNull null
                val anime = animeById[animeId]
                KitsuAnimeEntry(
                    id = animeId,
                    title = anime?.displayTitle(),
                    titleEn = anime?.titleEn(),
                    titleRomaji = anime?.titleRomaji(),
                    titleJa = anime?.titleJa(),
                    abbreviatedTitles = anime?.abbreviatedTitles() ?: emptyList(),
                    posterUrl = anime?.posterUrl(),
                    coverUrl = anime?.coverUrl()
                )
            }

            val newOnThisPage = pageEntries.filter { it.id !in knownKitsuIds }
            newEntries.addAll(newOnThisPage)

            val totalCount = response.meta?.count
            val totalPages = totalCount?.let { (it + limit - 1) / limit }
            val isLastPage = response.data.size < limit
            val allKnown = newOnThisPage.isEmpty() && pageEntries.isNotEmpty()

            onProgress(
                LibrarySyncProgress(
                    page = page,
                    totalPages = totalPages,
                    fetchedCount = newEntries.size,
                    totalCount = totalCount,
                    isLastPage = isLastPage || allKnown
                )
            )

            if (isLastPage || allKnown) break
            offset += limit
            page += 1
        }

        if (newEntries.isEmpty()) return newEntries

        val missingIds = newEntries
            .filter { it.title.isNullOrBlank() || it.posterUrl.isNullOrBlank() || it.coverUrl.isNullOrBlank() }
            .map { it.id }
            .distinct()

        if (missingIds.isEmpty()) return newEntries

        val detailsById = fetchAnimeDetailsByIds(missingIds)
        if (detailsById.isEmpty()) return newEntries

        return newEntries.map { entry ->
            val details = detailsById[entry.id] ?: return@map entry
            entry.copy(
                title = entry.title ?: details.displayTitle(),
                titleEn = entry.titleEn ?: details.titleEn(),
                titleRomaji = entry.titleRomaji ?: details.titleRomaji(),
                titleJa = entry.titleJa ?: details.titleJa(),
                posterUrl = entry.posterUrl ?: details.posterUrl(),
                coverUrl = entry.coverUrl ?: details.coverUrl()
            )
        }
    }

    override suspend fun getAnimeDetails(ids: List<String>): List<KitsuAnimeEntry> {
        val details = fetchAnimeDetailsByIds(ids)
        if (details.isEmpty()) return emptyList()
        return details.values.map { anime ->
            KitsuAnimeEntry(
                id = anime.id,
                title = anime.displayTitle(),
                titleEn = anime.titleEn(),
                titleRomaji = anime.titleRomaji(),
                titleJa = anime.titleJa(),
                abbreviatedTitles = anime.abbreviatedTitles(),
                posterUrl = anime.posterUrl(),
                coverUrl = anime.coverUrl()
            )
        }
    }

    override suspend fun getAnimeMappings(
        kitsuIds: List<String>
    ): Map<String, Map<String, String>> {
        if (kitsuIds.isEmpty()) return emptyMap()
        val result = mutableMapOf<String, MutableMap<String, String>>()
        val batchSize = 20
        kitsuIds.distinct().chunked(batchSize).forEach { batch ->
            try {
                val response = kitsuApi.getAnimeWithMappings(
                    ids = batch.joinToString(","),
                    limit = batch.size
                )
                val mappingsById = response.included.associateBy { it.id }
                response.data.forEach { anime ->
                    val externalIds = mutableMapOf<String, String>()
                    anime.relationships?.mappings?.data?.forEach { ref ->
                        val mappingId = ref.id ?: return@forEach
                        val mapping = mappingsById[mappingId]
                        val site = mapping?.attributes?.externalSite ?: return@forEach
                        val extId = mapping.attributes.externalId ?: return@forEach
                        externalIds[site] = extId
                    }
                    if (externalIds.isNotEmpty()) {
                        result[anime.id] = externalIds
                        Log.d(TAG, "Kitsu ${anime.id} mappings: $externalIds")
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to fetch mappings for batch $batch", e)
            }
        }
        return result
    }

    override suspend fun getCurrentlyWatchingEntries(userId: String): List<KitsuAnimeEntry> {
        val results = mutableListOf<KitsuAnimeEntry>()
        var offset = 0
        val limit = 500

        while (true) {
            val response = kitsuApi.getLibraryEntriesByStatus(
                userId = userId,
                status = "current",
                limit = limit,
                offset = offset
            )
            val animeById = response.included.associateBy { it.id }

            val pageResults = response.data.mapNotNull { entry ->
                val animeId = entry.animeId() ?: return@mapNotNull null
                val anime = animeById[animeId]
                KitsuAnimeEntry(
                    id = animeId,
                    title = anime?.displayTitle(),
                    titleEn = anime?.titleEn(),
                    titleRomaji = anime?.titleRomaji(),
                    titleJa = anime?.titleJa(),
                    abbreviatedTitles = anime?.abbreviatedTitles() ?: emptyList(),
                    posterUrl = anime?.posterUrl(),
                    coverUrl = anime?.coverUrl()
                )
            }
            results.addAll(pageResults)

            if (response.data.size < limit) break
            offset += limit
        }
        return results
    }

    override suspend fun searchKitsuAnime(query: String): List<KitsuAnimeEntry> {
        if (query.isBlank()) return emptyList()
        return try {
            val response = kitsuApi.searchAnime(query = query, limit = 5)
            response.data.map { anime ->
                KitsuAnimeEntry(
                    id = anime.id,
                    title = anime.displayTitle(),
                    titleEn = anime.titleEn(),
                    titleRomaji = anime.titleRomaji(),
                    titleJa = anime.titleJa(),
                    abbreviatedTitles = anime.abbreviatedTitles(),
                    posterUrl = anime.posterUrl(),
                    coverUrl = anime.coverUrl()
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "Kitsu anime search failed for '$query'", e)
            emptyList()
        }
    }

    private suspend fun fetchAnimeDetailsByIds(ids: List<String>): Map<String, KitsuAnime> {
        if (ids.isEmpty()) return emptyMap()
        val uniqueIds = ids.filter { it.isNotBlank() }.distinct()
        if (uniqueIds.isEmpty()) return emptyMap()

        val batchSize = 20
        val results = mutableMapOf<String, KitsuAnime>()
        uniqueIds.chunked(batchSize).forEach { batch ->
            try {
                val response = kitsuApi.getAnimeByIds(
                    ids = batch.joinToString(","),
                    limit = batch.size
                )
                response.data.forEach { anime -> results[anime.id] = anime }
            } catch (_: Exception) {
                return@forEach
            }
        }
        return results
    }
}

private fun KitsuLibraryEntry.animeId(): String? {
    return relationships?.anime?.data?.id
}

private const val TAG = "UserRepository"

private fun KitsuAnime.displayTitle(): String? {
    val attributes = attributes ?: return null
    return attributes.titles?.get("en")
        ?: attributes.canonicalTitle
        ?: attributes.titles?.get("en_jp")
        ?: attributes.titles?.values?.firstOrNull()
}

private fun KitsuAnime.titleEn(): String? {
    return attributes?.titles?.get("en")
}

private fun KitsuAnime.titleRomaji(): String? {
    return attributes?.titles?.get("en_jp")
        ?: attributes?.canonicalTitle
}

private fun KitsuAnime.titleJa(): String? {
    return attributes?.titles?.get("ja_jp")
}

private fun KitsuAnime.abbreviatedTitles(): List<String> {
    return attributes?.abbreviatedTitles?.filter { it.isNotBlank() } ?: emptyList()
}

private fun KitsuAnime.posterUrl(): String? {
    val attributes = attributes ?: return null
    return attributes.posterImage.bestUrl()
}

private fun KitsuAnime.coverUrl(): String? {
    val attributes = attributes ?: return null
    return attributes.coverImage.bestUrl()
}

private fun KitsuImageSet?.bestUrl(): String? {
    if (this == null) return null
    return original ?: large ?: medium ?: small ?: tiny
}
