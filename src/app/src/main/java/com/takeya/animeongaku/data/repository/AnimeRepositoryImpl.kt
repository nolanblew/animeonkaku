package com.takeya.animeongaku.data.repository

import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.remote.ApiConstants
import com.takeya.animeongaku.data.remote.FindAnimeByExternalSiteData
import com.takeya.animeongaku.data.remote.GraphQlRequest
import com.takeya.animeongaku.data.remote.GraphQlResponse
import com.takeya.animeongaku.data.remote.GqlAnime
import com.takeya.animeongaku.data.remote.GqlAnimeTheme
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

@Singleton
class AnimeRepositoryImpl @Inject constructor(
    private val okHttpClient: OkHttpClient,
    private val moshi: Moshi
) : AnimeRepository {
    override suspend fun mapKitsuThemes(kitsuIds: List<String>): AnimeThemeSyncResult {
        val ids = kitsuIds.mapNotNull { it.toIntOrNull() }
        if (ids.isEmpty()) return AnimeThemeSyncResult(emptyList(), emptyMap())

        val themes = mutableListOf<AnimeThemeEntry>()
        val mappings = mutableMapOf<String, Long>()

        ids.chunked(50).forEach { batch ->
            val response = fetchAnimeByKitsuIds(batch)
            response.anime.forEach { anime ->
                val kitsuId = anime.kitsuExternalId()
                if (kitsuId != null) {
                    mappings[kitsuId] = anime.id.toLong()
                }
                themes += anime.toThemeEntries()
            }
        }

        return AnimeThemeSyncResult(themes, mappings)
    }

    private suspend fun fetchAnimeByKitsuIds(ids: List<Int>): FindAnimeByExternalSiteData {
        val query = """
            query(${ '$' }site: ResourceSite!, ${ '$' }id: [Int!]) {
              findAnimeByExternalSite(site: ${ '$' }site, id: ${ '$' }id) {
                id
                name
                resources {
                  nodes {
                    site
                    externalId
                  }
                }
                animethemes {
                  id
                  type
                  sequence
                  song {
                    title
                    performances {
                      artist {
                        ... on Artist {
                          name
                        }
                        ... on Membership {
                          member {
                            name
                          }
                        }
                      }
                    }
                  }
                  animethemeentries {
                    id
                    videos {
                      nodes {
                        link
                      }
                    }
                  }
                }
              }
            }
        """.trimIndent()

        val requestPayload = GraphQlRequest(
            query = query,
            variables = mapOf(
                "site" to "KITSU",
                "id" to ids
            )
        )

        val requestAdapter = moshi.adapter(GraphQlRequest::class.java)
        val responseType = Types.newParameterizedType(
            GraphQlResponse::class.java,
            FindAnimeByExternalSiteData::class.java
        )
        val responseAdapter = moshi.adapter<GraphQlResponse<FindAnimeByExternalSiteData>>(responseType)

        val body = requestAdapter.toJson(requestPayload)
            .toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url(ApiConstants.ANIMETHEMES_GRAPHQL_URL)
            .post(body)
            .build()

        return withContext(Dispatchers.IO) {
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("AnimeThemes request failed: ${response.code}")
                }
                val responseBody = response.body?.string()
                    ?: throw IOException("Empty AnimeThemes response")
                val decoded = responseAdapter.fromJson(responseBody)
                    ?: throw IOException("Unable to parse AnimeThemes response")
                if (!decoded.errors.isNullOrEmpty()) {
                    val message = decoded.errors.joinToString { it.message.orEmpty() }
                    throw IOException("AnimeThemes error: $message")
                }
                decoded.data ?: FindAnimeByExternalSiteData()
            }
        }
    }
}

private fun GqlAnime.kitsuExternalId(): String? {
    return resources?.nodes?.firstOrNull { it.site == "KITSU" }?.externalId?.toString()
}

private fun GqlAnime.toThemeEntries(): List<AnimeThemeEntry> {
    return animeThemes.mapNotNull { theme ->
        val videoLink = theme.entries.firstOrNull()
            ?.videos
            ?.nodes
            ?.firstOrNull()
            ?.link
            ?: return@mapNotNull null
        AnimeThemeEntry(
            animeId = id.toString(),
            themeId = theme.id.toString(),
            title = theme.title(),
            artist = theme.artistNames(),
            audioUrl = videoLink,
            videoUrl = videoLink
        )
    }
}

private fun GqlAnimeTheme.title(): String {
    val base = song?.title?.takeIf { it.isNotBlank() }
    if (base != null) return base
    val sequence = sequence?.let { "${type ?: "Theme"} $it" }
    return sequence ?: (type ?: "Theme")
}

private fun GqlAnimeTheme.artistNames(): String? {
    val names = song?.performances
        ?.mapNotNull { performance ->
            performance.artist?.name ?: performance.artist?.member?.name
        }
        ?.distinct()
        ?.filter { it.isNotBlank() }
        .orEmpty()
    return if (names.isEmpty()) null else names.joinToString(", ")
}
