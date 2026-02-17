package com.takeya.animeongaku.data.repository

import android.util.Log
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.KitsuAnimeEntry
import com.takeya.animeongaku.data.remote.AnimeThemesApiResponse
import com.takeya.animeongaku.data.remote.ApiAnime
import com.takeya.animeongaku.data.remote.ApiTheme
import com.takeya.animeongaku.data.remote.ApiVideo
import com.takeya.animeongaku.data.remote.ApiConstants
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import okhttp3.HttpUrl.Companion.toHttpUrl

@Singleton
class AnimeRepositoryImpl @Inject constructor(
    @param:Named("base") private val okHttpClient: OkHttpClient,
    private val moshi: Moshi
) : AnimeRepository {
    override suspend fun mapKitsuThemes(
        kitsuEntries: List<KitsuAnimeEntry>,
        onProgress: (ThemeMappingProgress) -> Unit
    ): AnimeThemeSyncResult {
        val idToTitle = kitsuEntries.associate { entry -> entry.id to entry.title }
        val titleToId = kitsuEntries
            .filter { !it.title.isNullOrBlank() }
            .associate { entry -> entry.title!!.lowercase().trim() to entry.id }
        val ids = kitsuEntries.mapNotNull { entry ->
            val trimmed = entry.id.trim()
            if (trimmed.isBlank()) null else trimmed
        }
        if (ids.isEmpty()) return AnimeThemeSyncResult(emptyList(), emptyMap())

        val themes = mutableListOf<AnimeThemeEntry>()
        val mappings = mutableMapOf<String, Long>()
        val batches = ids.chunked(50)

        batches.forEachIndexed { index, batch ->
            val response = fetchAnimeByKitsuIds(batch)
            response.anime.forEach { anime ->
                val kitsuId = anime.kitsuExternalId()
                if (kitsuId != null && anime.id != null) {
                    mappings[kitsuId] = anime.id
                } else if (anime.id != null && anime.name != null) {
                    val fallbackId = titleToId[anime.name.lowercase().trim()]
                    if (fallbackId != null) {
                        mappings[fallbackId] = anime.id
                    }
                }
                themes += anime.toThemeEntries()
            }

            onProgress(
                ThemeMappingProgress(
                    batchIndex = index + 1,
                    totalBatches = batches.size,
                    themesCount = themes.size
                )
            )
        }

        Log.d(TAG, "mapKitsuThemes: ${kitsuEntries.size} entries, ${mappings.size} mapped, ${themes.size} themes")
        if (mappings.isEmpty() && kitsuEntries.isNotEmpty()) {
            Log.w(TAG, "WARNING: zero mappings. First API anime resources: ${batches.firstOrNull()?.let { fetchAnimeByKitsuIds(it).anime.firstOrNull()?.resources }}")
        }

        return AnimeThemeSyncResult(themes, mappings)
    }

    companion object {
        private const val TAG = "AnimeRepository"
        private const val TAG_FALLBACK = "AnimeThemesFallback"
    }

    private suspend fun fetchAnimeByKitsuIds(ids: List<String>): AnimeThemesApiResponse {
        val requestUrl = "https://api.animethemes.moe/anime".toHttpUrl()
            .newBuilder()
            .addQueryParameter("filter[has]", "resources")
            .addQueryParameter("filter[site]", "Kitsu")
            .addQueryParameter("filter[external_id]", ids.joinToString(","))
            .addQueryParameter(
                "include",
                "resources,animethemes,animethemes.animethemeentries.videos," +
                    "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"
            )
            .build()

        val request = Request.Builder()
            .url(requestUrl)
            .get()
            .build()

        val responseAdapter = moshi.adapter(AnimeThemesApiResponse::class.java)

        return withContext(Dispatchers.IO) {
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("AnimeThemes request failed: ${response.code}")
                }
                val responseBody = response.body?.string()
                    ?: throw IOException("Empty AnimeThemes response")
                responseAdapter.fromJson(responseBody)
                    ?: AnimeThemesApiResponse()
            }
        }
    }

    override suspend fun fallbackSearchByTitle(titles: List<String>): FallbackSearchResult {
        val uniqueTitles = titles.filter { it.isNotBlank() }.distinct()
        if (uniqueTitles.isEmpty()) return FallbackSearchResult(null, emptyList())

        val responseAdapter = moshi.adapter(AnimeThemesApiResponse::class.java)
        val includes = "animethemes,animethemes.animethemeentries.videos," +
            "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"

        // Pass 1: exact name filter for each title variant
        for ((index, title) in uniqueTitles.withIndex()) {
            Log.d(TAG_FALLBACK, "Exact search for: \"$title\" (${index + 1}/${uniqueTitles.size})")
            val result = searchAnimeThemesInternal(
                "filter[name]", title, includes, responseAdapter, title
            )
            if (result != null) return result
            if (index < uniqueTitles.size - 1) kotlinx.coroutines.delay(500)
        }

        // Pass 2: fuzzy full-text search for each title variant
        for ((index, title) in uniqueTitles.withIndex()) {
            Log.d(TAG_FALLBACK, "Fuzzy search for: \"$title\" (${index + 1}/${uniqueTitles.size})")
            val result = searchAnimeThemesInternal(
                "q", title, includes, responseAdapter, title
            )
            if (result != null) return result
            if (index < uniqueTitles.size - 1) kotlinx.coroutines.delay(500)
        }

        Log.w(TAG_FALLBACK, "No results for any title variant: $uniqueTitles")
        return FallbackSearchResult(null, emptyList())
    }

    private suspend fun searchAnimeThemesInternal(
        queryParam: String,
        queryValue: String,
        includes: String,
        adapter: com.squareup.moshi.JsonAdapter<AnimeThemesApiResponse>,
        displayTitle: String
    ): FallbackSearchResult? {
        val requestUrl = "https://api.animethemes.moe/anime".toHttpUrl()
            .newBuilder()
            .addQueryParameter(queryParam, queryValue)
            .addQueryParameter("include", includes)
            .addQueryParameter("page[size]", "5")
            .build()

        val request = Request.Builder()
            .url(requestUrl)
            .get()
            .build()

        return try {
            withContext(Dispatchers.IO) {
                okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        Log.w(TAG_FALLBACK, "Search failed for \"$displayTitle\": HTTP ${response.code}")
                        return@withContext null
                    }
                    val body = response.body?.string() ?: return@withContext null
                    val parsed = adapter.fromJson(body) ?: return@withContext null

                    // Prefer exact name match, then first result with themes
                    val match = parsed.anime.firstOrNull {
                        it.name.equals(displayTitle, ignoreCase = true)
                    } ?: parsed.anime.firstOrNull { it.animethemes.isNotEmpty() }
                    ?: parsed.anime.firstOrNull()

                    if (match == null || match.id == null) return@withContext null

                    val themes = match.toThemeEntries()
                    if (themes.isEmpty()) return@withContext null

                    Log.d(TAG_FALLBACK, "Found ${themes.size} themes for \"$displayTitle\" (animeThemesId=${match.id})")
                    FallbackSearchResult(match.id, themes)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG_FALLBACK, "Error searching for \"$displayTitle\"", e)
            null
        }
    }

    override suspend fun fetchAnimeByExternalIds(
        site: String,
        externalIds: List<String>
    ): AnimeThemeSyncResult {
        if (externalIds.isEmpty()) return AnimeThemeSyncResult(emptyList(), emptyMap())

        val themes = mutableListOf<AnimeThemeEntry>()
        val mappings = mutableMapOf<String, Long>() // externalId -> animeThemesId

        val batches = externalIds.chunked(50)
        batches.forEach { batch ->
            try {
                val requestUrl = "https://api.animethemes.moe/anime".toHttpUrl()
                    .newBuilder()
                    .addQueryParameter("filter[has]", "resources")
                    .addQueryParameter("filter[site]", site)
                    .addQueryParameter("filter[external_id]", batch.joinToString(","))
                    .addQueryParameter(
                        "include",
                        "resources,animethemes,animethemes.animethemeentries.videos," +
                            "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"
                    )
                    .build()

                val request = Request.Builder()
                    .url(requestUrl)
                    .get()
                    .build()

                val responseAdapter = moshi.adapter(AnimeThemesApiResponse::class.java)

                withContext(Dispatchers.IO) {
                    okHttpClient.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) {
                            Log.w(TAG_FALLBACK, "External ID lookup failed for $site: HTTP ${response.code}")
                            return@withContext
                        }
                        val body = response.body?.string() ?: return@withContext
                        val parsed = responseAdapter.fromJson(body) ?: return@withContext

                        parsed.anime.forEach { anime ->
                            if (anime.id != null) {
                                // Find which external ID matched this anime
                                val matchedExtId = anime.resources.firstOrNull {
                                    it.site.equals(site, ignoreCase = true)
                                }?.let { res ->
                                    when (val id = res.externalId) {
                                        is String -> id
                                        is Number -> id.toLong().toString()
                                        else -> null
                                    }
                                }
                                if (matchedExtId != null) {
                                    mappings[matchedExtId] = anime.id
                                }
                                themes += anime.toThemeEntries()
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG_FALLBACK, "Error fetching by $site IDs", e)
            }
        }

        Log.d(TAG_FALLBACK, "External ID lookup ($site): ${externalIds.size} IDs -> ${mappings.size} matched, ${themes.size} themes")
        return AnimeThemeSyncResult(themes, mappings)
    }

    override suspend fun searchAnimeThemes(query: String): List<AnimeThemeEntry> {
        if (query.isBlank()) return emptyList()

        val requestUrl = "https://api.animethemes.moe/anime".toHttpUrl()
            .newBuilder()
            .addQueryParameter("filter[name]", query)
            .addQueryParameter(
                "include",
                "animethemes,animethemes.animethemeentries.videos," +
                    "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"
            )
            .addQueryParameter("page[size]", "15")
            .build()

        val request = Request.Builder()
            .url(requestUrl)
            .get()
            .build()

        val responseAdapter = moshi.adapter(AnimeThemesApiResponse::class.java)

        return withContext(Dispatchers.IO) {
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string() ?: return@withContext emptyList()
                val parsed = responseAdapter.fromJson(body) ?: return@withContext emptyList()
                parsed.anime.flatMap { it.toThemeEntries() }
            }
        }
    }
}

private fun ApiAnime.kitsuExternalId(): String? {
    val resource = resources.firstOrNull {
        it.site?.equals("Kitsu", ignoreCase = true) == true
    } ?: return null
    return when (val id = resource.externalId) {
        is String -> id
        is Number -> id.toLong().toString()
        else -> null
    }
}

private fun ApiAnime.toThemeEntries(): List<AnimeThemeEntry> {
    val animeId = id?.toString() ?: return emptyList()
    val animeName = name
    return animethemes.mapNotNull { theme ->
        val themeId = theme.id?.toString() ?: return@mapNotNull null
        val video = theme.flattenedVideos().firstOrNull {
            !it.audio?.link.isNullOrBlank() || !it.audio?.path.isNullOrBlank() || !it.link.isNullOrBlank()
        } ?: return@mapNotNull null

        val audioLink = video.audio?.link
        val audioPath = video.audio?.path
        val resolvedAudio = when {
            !audioLink.isNullOrBlank() -> audioLink
            !audioPath.isNullOrBlank() -> {
                if (audioPath.startsWith("http", ignoreCase = true)) {
                    audioPath
                } else {
                    "https://a.animethemes.moe/$audioPath"
                }
            }
            !video.link.isNullOrBlank() -> video.link
            else -> null
        } ?: return@mapNotNull null

        val videoUrl = video.link ?: resolvedAudio

        val themeTypeTag = theme.type?.let { type ->
            val seq = theme.sequence?.toString() ?: ""
            "$type$seq"
        }

        AnimeThemeEntry(
            animeId = animeId,
            animeName = animeName,
            themeId = themeId,
            title = theme.title(),
            artist = theme.artistNames(),
            audioUrl = resolvedAudio,
            videoUrl = videoUrl,
            themeType = themeTypeTag
        )
    }
}

private fun ApiTheme.flattenedVideos(): List<ApiVideo> {
    return animethemeentries.flatMap { it.videos }
}

private fun ApiTheme.title(): String {
    val base = song?.title?.takeIf { it.isNotBlank() }
    if (base != null) return base
    val sequenceTitle = sequence?.let { "${type ?: "Theme"} $it" }
    return sequenceTitle ?: (type ?: "Theme")
}

private fun ApiTheme.artistNames(): String? {
    val names = song?.artists
        ?.mapNotNull { it.name }
        ?.distinct()
        ?.filter { it.isNotBlank() }
        .orEmpty()
    return if (names.isEmpty()) null else names.joinToString(", ")
}
