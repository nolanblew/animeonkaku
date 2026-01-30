package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.model.KitsuAnimeEntry
import com.takeya.animeongaku.data.remote.KitsuApi
import com.takeya.animeongaku.data.remote.KitsuAnime
import com.takeya.animeongaku.data.remote.KitsuLibraryEntry
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepositoryImpl @Inject constructor(
    private val kitsuApi: KitsuApi
) : UserRepository {
    override suspend fun findUserId(username: String): String? {
        return kitsuApi.findUser(username).data.firstOrNull()?.id
    }

    override suspend fun getLibraryEntries(userId: String): List<KitsuAnimeEntry> {
        val results = mutableListOf<KitsuAnimeEntry>()
        var offset = 0
        val limit = 500

        while (true) {
            val response = kitsuApi.getLibraryEntries(
                userId = userId,
                limit = limit,
                offset = offset
            )
            val titlesById = response.included.associateBy({ it.id }, { it.displayTitle() })

            val pageResults = response.data.mapNotNull { entry ->
                val animeId = entry.animeId() ?: return@mapNotNull null
                KitsuAnimeEntry(
                    id = animeId,
                    title = titlesById[animeId]
                )
            }
            results.addAll(pageResults)

            if (response.data.size < limit) break
            offset += limit
        }

        return results
    }
}

private fun KitsuLibraryEntry.animeId(): String? {
    return relationships?.anime?.data?.id
}

private fun KitsuAnime.displayTitle(): String? {
    val attributes = attributes ?: return null
    return attributes.canonicalTitle
        ?: attributes.titles?.get("en")
        ?: attributes.titles?.values?.firstOrNull()
}
