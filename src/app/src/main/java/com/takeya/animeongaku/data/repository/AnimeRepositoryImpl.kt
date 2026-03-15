package com.takeya.animeongaku.data.repository

import android.util.Log
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.ArtistCredit
import com.takeya.animeongaku.data.model.KitsuAnimeEntry
import com.takeya.animeongaku.data.model.OnlineAnimeResult
import com.takeya.animeongaku.data.model.OnlineArtistResult
import com.takeya.animeongaku.data.model.OnlineSearchResult
import com.takeya.animeongaku.data.remote.AnimeThemesApiResponse
import com.takeya.animeongaku.data.remote.AnimeThemesSearchResponse
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
        val initialUrl = "https://api.animethemes.moe/anime".toHttpUrl()
            .newBuilder()
            .addQueryParameter("filter[has]", "resources")
            .addQueryParameter("filter[site]", "Kitsu")
            .addQueryParameter("filter[external_id]", ids.joinToString(","))
            .addQueryParameter(
                "include",
                "resources,animethemes,animethemes.animethemeentries.videos," +
                    "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"
            )
            .addQueryParameter("page[size]", "100")
            .build()

        return fetchAllPages(initialUrl)
    }

    private suspend fun fetchAllPages(initialUrl: okhttp3.HttpUrl): AnimeThemesApiResponse {
        val responseAdapter = moshi.adapter(AnimeThemesApiResponse::class.java)
        val allAnime = mutableListOf<ApiAnime>()
        var nextUrl: String? = initialUrl.toString()

        while (nextUrl != null) {
            val request = Request.Builder()
                .url(nextUrl)
                .get()
                .build()

            val page = withContext(Dispatchers.IO) {
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

            allAnime.addAll(page.anime)
            nextUrl = page.links?.next

            if (nextUrl != null) {
                Log.d(TAG, "Fetching next page, accumulated ${allAnime.size} anime so far")
                kotlinx.coroutines.delay(300)
            }
        }

        return AnimeThemesApiResponse(anime = allAnime)
    }

    override suspend fun fallbackSearchByTitle(titles: List<String>): FallbackSearchResult {
        val uniqueTitles = titles.filter { it.isNotBlank() }.distinct()
        if (uniqueTitles.isEmpty()) return FallbackSearchResult(null, emptyList())

        val responseAdapter = moshi.adapter(AnimeThemesApiResponse::class.java)
        val includes = "animethemes,animethemes.animethemeentries.videos," +
            "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"

        // Search each title variant using full-text search (q=).
        // Note: filter[name] does NOT return nested song.artists from the API,
        // so we use q= which returns complete data including artists.
        // The result matching still prefers exact name matches.
        for ((index, title) in uniqueTitles.withIndex()) {
            Log.d(TAG_FALLBACK, "Searching for: \"$title\" (${index + 1}/${uniqueTitles.size})")
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
                val initialUrl = "https://api.animethemes.moe/anime".toHttpUrl()
                    .newBuilder()
                    .addQueryParameter("filter[has]", "resources")
                    .addQueryParameter("filter[site]", site)
                    .addQueryParameter("filter[external_id]", batch.joinToString(","))
                    .addQueryParameter(
                        "include",
                        "resources,animethemes,animethemes.animethemeentries.videos," +
                            "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"
                    )
                    .addQueryParameter("page[size]", "100")
                    .build()

                val parsed = fetchAllPages(initialUrl)

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
            } catch (e: Exception) {
                Log.e(TAG_FALLBACK, "Error fetching by $site IDs", e)
            }
        }

        Log.d(TAG_FALLBACK, "External ID lookup ($site): ${externalIds.size} IDs -> ${mappings.size} matched, ${themes.size} themes")
        return AnimeThemeSyncResult(themes, mappings)
    }

    override suspend fun searchAnimeThemes(query: String): OnlineSearchResult {
        if (query.isBlank()) return OnlineSearchResult(emptyList(), emptyList(), emptyList())

        val includes = "resources,images,animesynonyms,animethemes,animethemes.animethemeentries.videos," +
            "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"

        val requestUrl = "https://api.animethemes.moe/anime".toHttpUrl()
            .newBuilder()
            .addQueryParameter("q", query)
            .addQueryParameter("include", includes)
            .addQueryParameter("page[size]", "15")
            .build()

        val request = Request.Builder()
            .url(requestUrl)
            .get()
            .build()

        val responseAdapter = moshi.adapter(AnimeThemesApiResponse::class.java)

        return withContext(Dispatchers.IO) {
            val results = mutableListOf<AnimeThemeEntry>()
            val seenThemeIds = mutableSetOf<String>()
            var searchArtists = listOf<OnlineArtistResult>()

            // 1) Search by anime name
            try {
                okHttpClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string()
                        if (body != null) {
                            val parsed = responseAdapter.fromJson(body)
                            parsed?.anime?.flatMap { it.toThemeEntries() }?.forEach { entry ->
                                if (seenThemeIds.add(entry.themeId)) results.add(entry)
                            }
                        }
                    } else {
                        Log.w(TAG, "searchAnimeThemes anime query failed: HTTP ${response.code}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "searchAnimeThemes anime query exception", e)
            }

            // 2) Also search by song title / artist name via /search endpoint
            try {
                val searchUrl = "https://api.animethemes.moe/search".toHttpUrl()
                    .newBuilder()
                    .addQueryParameter("q", query)
                    .addQueryParameter("include[anime]", includes)
                    .addQueryParameter("include[artist]", "images")
                    .addQueryParameter("fields[search]", "anime,artists")
                    .addQueryParameter("page[limit]", "10")
                    .build()

                val searchRequest = Request.Builder().url(searchUrl).get().build()
                val searchAdapter = moshi.adapter(AnimeThemesSearchResponse::class.java)

                okHttpClient.newCall(searchRequest).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string()
                        if (body != null) {
                            val parsed = searchAdapter.fromJson(body)
                            parsed?.search?.anime?.flatMap { it.toThemeEntries() }?.forEach { entry ->
                                if (seenThemeIds.add(entry.themeId)) results.add(entry)
                            }
                            // Parse artists from search response
                            searchArtists = parsed?.search?.artists
                                ?.filter { it.id != null && !it.name.isNullOrBlank() && !it.slug.isNullOrBlank() }
                                ?.map { artist ->
                                    val imgLink = artist.images.firstOrNull {
                                        it.facet?.contains("Large", ignoreCase = true) == true
                                    } ?: artist.images.firstOrNull {
                                        it.facet?.contains("Small", ignoreCase = true) == true
                                    } ?: artist.images.firstOrNull()
                                    val imageUrl = imgLink?.link ?: imgLink?.path?.let { path ->
                                        if (path.startsWith("http", ignoreCase = true)) path
                                        else "https://i.animethemes.moe/$path"
                                    }
                                    OnlineArtistResult(
                                        id = artist.id!!,
                                        name = artist.name!!,
                                        slug = artist.slug!!,
                                        imageUrl = imageUrl
                                    )
                                }
                                .orEmpty()
                        }
                    } else {
                        Log.w(TAG, "searchAnimeThemes /search query failed: HTTP ${response.code}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "searchAnimeThemes /search query exception", e)
            }

            // 3) Extract distinct anime from theme results
            val onlineAnime = results
                .groupBy { it.animeId }
                .map { (animeId, entries) ->
                    val first = entries.first()
                    OnlineAnimeResult(
                        animeThemesId = animeId,
                        name = first.animeName ?: "Unknown",
                        nameEn = first.animeNameEn,
                        coverUrl = first.coverUrl,
                        kitsuId = first.kitsuId,
                        themeCount = entries.size
                    )
                }

            OnlineSearchResult(
                themes = results,
                anime = onlineAnime,
                artists = searchArtists
            )
        }
    }

    override suspend fun fetchAnimeById(animeThemesId: Long): List<AnimeThemeEntry> {
        val includes = "resources,images,animesynonyms,animethemes,animethemes.animethemeentries.videos," +
            "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists"

        val requestUrl = "https://api.animethemes.moe/anime/$animeThemesId".toHttpUrl()
            .newBuilder()
            .addQueryParameter("include", includes)
            .build()

        val request = Request.Builder().url(requestUrl).get().build()

        return withContext(Dispatchers.IO) {
            try {
                okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        Log.w(TAG, "fetchAnimeById failed: HTTP ${response.code}")
                        return@withContext emptyList()
                    }
                    val body = response.body?.string() ?: return@withContext emptyList()
                    // Response is { "anime": { ... } } (single object, not array)
                    val type = Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
                    val mapAdapter = moshi.adapter<Map<String, Any>>(type)
                    val raw = mapAdapter.fromJson(body) ?: return@withContext emptyList()
                    val animeJson = raw["anime"] ?: return@withContext emptyList()
                    val animeAdapter = moshi.adapter(ApiAnime::class.java)
                    val anime = animeAdapter.fromJsonValue(animeJson) ?: return@withContext emptyList()
                    anime.toThemeEntries()
                }
            } catch (e: Exception) {
                Log.e(TAG, "fetchAnimeById exception", e)
                emptyList()
            }
        }
    }

    override suspend fun fetchArtistSlug(artistName: String): String? {
        val requestUrl = "https://api.animethemes.moe/search".toHttpUrl()
            .newBuilder()
            .addQueryParameter("q", artistName)
            .addQueryParameter("fields[search]", "artists")
            .addQueryParameter("page[limit]", "5")
            .build()

        val request = Request.Builder().url(requestUrl).get().build()
        val searchAdapter = moshi.adapter(AnimeThemesSearchResponse::class.java)

        return withContext(Dispatchers.IO) {
            try {
                okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@withContext null
                    val body = response.body?.string() ?: return@withContext null
                    val parsed = searchAdapter.fromJson(body)
                    // Find exact name match first, then closest match
                    val artists = parsed?.search?.artists.orEmpty()
                    val exact = artists.firstOrNull {
                        it.name.equals(artistName, ignoreCase = true)
                    }
                    val best = exact ?: artists.firstOrNull()
                    best?.slug
                }
            } catch (e: Exception) {
                Log.e(TAG, "fetchArtistSlug exception", e)
                null
            }
        }
    }

    override suspend fun fetchArtistSongs(artistSlug: String): List<AnimeThemeEntry> {
        val includes = "songs.animethemes.anime.resources,songs.animethemes.anime.images," +
            "songs.animethemes.anime.animesynonyms," +
            "songs.animethemes.animethemeentries.videos,songs.animethemes.animethemeentries.videos.audio," +
            "songs.animethemes.song.artists"

        val requestUrl = "https://api.animethemes.moe/artist/$artistSlug".toHttpUrl()
            .newBuilder()
            .addQueryParameter("include", includes)
            .build()

        val request = Request.Builder().url(requestUrl).get().build()

        return withContext(Dispatchers.IO) {
            try {
                okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        Log.w(TAG, "fetchArtistSongs failed: HTTP ${response.code}")
                        return@withContext emptyList()
                    }
                    val body = response.body?.string() ?: return@withContext emptyList()
                    val type = Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
                    val mapAdapter = moshi.adapter<Map<String, Any>>(type)
                    val raw = mapAdapter.fromJson(body) ?: return@withContext emptyList()
                    val artistJson = raw["artist"] ?: return@withContext emptyList()
                    // Parse songs from artist response — each song has animethemes
                    val artistMap = artistJson as? Map<*, *> ?: return@withContext emptyList()
                    val songsRaw = artistMap["songs"] as? List<*> ?: return@withContext emptyList()

                    val results = mutableListOf<AnimeThemeEntry>()
                    val animeAdapter = moshi.adapter(ApiAnime::class.java)

                    for (songRaw in songsRaw) {
                        val songMap = songRaw as? Map<*, *> ?: continue
                        val themesRaw = songMap["animethemes"] as? List<*> ?: continue
                        for (themeRaw in themesRaw) {
                            val themeMap = themeRaw as? Map<*, *> ?: continue
                            val animeRaw = themeMap["anime"] ?: continue
                            // Reconstruct anime with this single theme
                            val anime = animeAdapter.fromJsonValue(animeRaw) ?: continue
                            results += anime.toThemeEntries()
                        }
                    }
                    results
                }
            } catch (e: Exception) {
                Log.e(TAG, "fetchArtistSongs exception", e)
                emptyList()
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

private fun ApiAnime.coverImageUrl(): String? {
    val preferred = images.firstOrNull {
        it.facet?.contains("Large Cover", ignoreCase = true) == true
    } ?: images.firstOrNull {
        it.facet?.contains("Small Cover", ignoreCase = true) == true
    } ?: images.firstOrNull()
    val link = preferred?.link
    val path = preferred?.path
    return when {
        !link.isNullOrBlank() -> link
        !path.isNullOrBlank() -> if (path.startsWith("http", ignoreCase = true)) path
                                 else "https://i.animethemes.moe/$path"
        else -> null
    }
}

private fun ApiAnime.englishTitle(): String? {
    return synonyms.firstOrNull {
        it.type?.equals("English", ignoreCase = true) == true && !it.text.isNullOrBlank()
    }?.text
}

private fun ApiAnime.toThemeEntries(): List<AnimeThemeEntry> {
    val animeId = id?.toString() ?: return emptyList()
    val animeName = name
    val animeNameEn = englishTitle()
    val kitsuId = kitsuExternalId()
    val coverUrl = coverImageUrl()
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

        val artistCredits = theme.song?.artists
            ?.filter { !it.name.isNullOrBlank() }
            ?.map { apiArtist ->
                ArtistCredit(
                    name = apiArtist.name!!.trim(),
                    asCharacter = apiArtist.artistsong?.asCharacter?.trim()?.takeIf { it.isNotBlank() },
                    alias = apiArtist.artistsong?.alias?.trim()?.takeIf { it.isNotBlank() }
                )
            }
            .orEmpty()

        AnimeThemeEntry(
            animeId = animeId,
            animeName = animeName,
            animeNameEn = animeNameEn,
            kitsuId = kitsuId,
            coverUrl = coverUrl,
            themeId = themeId,
            title = theme.title(),
            artist = theme.artistNames(),
            audioUrl = resolvedAudio,
            videoUrl = videoUrl,
            themeType = themeTypeTag,
            artists = artistCredits
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
