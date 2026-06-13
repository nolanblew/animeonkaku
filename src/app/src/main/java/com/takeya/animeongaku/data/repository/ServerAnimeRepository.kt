package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.ArtistCredit
import com.takeya.animeongaku.data.model.OnlineAnimeResult
import com.takeya.animeongaku.data.model.OnlineArtistResult
import com.takeya.animeongaku.data.model.OnlineSearchResult
import com.takeya.animeongaku.data.remote.ApiAnime
import com.takeya.animeongaku.data.remote.ApiArtist
import com.takeya.animeongaku.data.remote.ApiArtistSongWithThemes
import com.takeya.animeongaku.data.remote.ApiResource
import com.takeya.animeongaku.data.remote.ApiSearchArtist
import com.takeya.animeongaku.data.remote.ApiSong
import com.takeya.animeongaku.data.remote.ApiTheme
import com.takeya.animeongaku.data.remote.ApiThemeWithAnime
import com.takeya.animeongaku.data.remote.ApiVideo
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuAnimeDetailResponse
import com.takeya.animeongaku.data.remote.OngakuAnimeDto
import com.takeya.animeongaku.data.remote.OngakuThemeDto
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.resolveServerUrl
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ServerAnimeRepository @Inject constructor(
    private val ongakuApi: OngakuApi,
    private val serverSettingsStore: ServerSettingsStore
) : AnimeRepository {
    override suspend fun searchAnimeThemes(query: String): OnlineSearchResult {
        if (query.isBlank()) return OnlineSearchResult(emptyList(), emptyList(), emptyList())

        val response = ongakuApi.search(query)
        val themes = response.animeThemes.search.anime.flatMap { anime ->
            anime.toThemeEntries(serverBaseUrl = serverBaseUrl())
        }.distinctBy { it.themeId }
        val anime = themes
            .groupBy { it.animeId }
            .map { (animeId, entries) ->
                val first = entries.first()
                OnlineAnimeResult(
                    animeThemesId = animeId,
                    name = first.animeNameEn ?: first.animeName ?: "Unknown",
                    nameEn = first.animeNameEn,
                    coverUrl = first.coverUrl,
                    kitsuId = first.kitsuId,
                    themeCount = entries.size
                )
            }
        val artists = response.animeThemes.search.artists.mapNotNull { it.toOnlineArtist() }

        return OnlineSearchResult(
            themes = themes,
            anime = anime,
            artists = artists
        )
    }

    override suspend fun fetchAnimeByKitsuId(kitsuId: String): AnimeThemeSyncResult {
        return ongakuApi.anime(kitsuId).toSyncResult(serverBaseUrl())
    }

    override suspend fun fetchArtistSongs(artistSlug: String): List<AnimeThemeEntry> {
        val response = ongakuApi.artist(artistSlug)
        val serverBaseUrl = serverBaseUrl()
        return response.artist?.songs.orEmpty().flatMap { song ->
            song.toThemeEntries(serverBaseUrl)
        }.distinctBy { it.themeId }
    }

    override suspend fun fetchArtistSlug(artistName: String): String? {
        if (artistName.isBlank()) return null
        val artists = ongakuApi.search(artistName).animeThemes.search.artists
        return artists
            .firstOrNull { it.name.equals(artistName, ignoreCase = true) }
            ?.slug
            ?: artists.firstOrNull()?.slug
    }

    private fun serverBaseUrl(): String = serverSettingsStore.serverBaseUrl.orEmpty()
}

private fun OngakuAnimeDetailResponse.toSyncResult(serverBaseUrl: String): AnimeThemeSyncResult {
    val themes = themes
        .filterNot { it.deleted }
        .map { theme -> theme.toThemeEntry(anime, serverBaseUrl) }
    val mappings = anime.animeThemesId?.let { mapOf(anime.kitsuId to it) }.orEmpty()
    return AnimeThemeSyncResult(themes = themes, animeMappings = mappings)
}

private fun OngakuThemeDto.toThemeEntry(
    anime: OngakuAnimeDto,
    serverBaseUrl: String
): AnimeThemeEntry {
    return AnimeThemeEntry(
        animeId = anime.animeThemesId?.toString() ?: animeThemesAnimeId.toString(),
        animeName = anime.title,
        animeNameEn = anime.titleEn,
        kitsuId = anime.kitsuId,
        coverUrl = resolveServerUrl(serverBaseUrl, anime.coverUrl)
            ?: resolveServerUrl(serverBaseUrl, anime.posterUrl),
        themeId = id.toString(),
        title = title,
        artist = artists.joinToString(", ") { it.name }.ifBlank { null },
        audioUrl = resolveServerUrl(serverBaseUrl, audioUrl).orEmpty(),
        videoUrl = videoUrl,
        themeType = themeType,
        artists = artists.map { ArtistCredit(it.name, it.asCharacter, it.alias) }
    )
}

private fun ApiAnime.toThemeEntries(serverBaseUrl: String): List<AnimeThemeEntry> {
    val animeId = id?.toString() ?: return emptyList()
    val animeName = name
    val kitsuId = kitsuExternalId()
    val coverUrl = kitsuId?.let {
        resolveServerUrl(serverBaseUrl, "/v1/media/images/anime/$it/cover")
    } ?: coverImageUrl()

    return animethemes.mapNotNull { theme ->
        theme.toThemeEntry(
            animeId = animeId,
            animeName = animeName,
            animeNameEn = englishTitle(),
            kitsuId = kitsuId,
            coverUrl = coverUrl,
            serverBaseUrl = serverBaseUrl
        )
    }
}

private fun ApiTheme.toThemeEntry(
    animeId: String,
    animeName: String?,
    animeNameEn: String?,
    kitsuId: String?,
    coverUrl: String?,
    serverBaseUrl: String
): AnimeThemeEntry? {
    val themeId = id ?: return null
    val video = flattenedVideos().firstOrNull {
        !it.audio?.link.isNullOrBlank() || !it.audio?.path.isNullOrBlank() || !it.link.isNullOrBlank()
    } ?: return null

    val themeTypeTag = type?.let { value ->
        val seq = sequence?.toString().orEmpty()
        "$value$seq"
    }
    val artists = song.artistCredits()

    return AnimeThemeEntry(
        animeId = animeId,
        animeName = animeName,
        animeNameEn = animeNameEn,
        kitsuId = kitsuId,
        coverUrl = coverUrl,
        themeId = themeId.toString(),
        title = song?.title?.takeIf { it.isNotBlank() } ?: themeTypeTag ?: type ?: "Theme",
        artist = artists.joinToString(", ") { it.name }.ifBlank { null },
        audioUrl = serverAudioUrl(serverBaseUrl, themeId),
        videoUrl = video.link,
        themeType = themeTypeTag,
        artists = artists
    )
}

private fun ApiArtistSongWithThemes.toThemeEntries(serverBaseUrl: String): List<AnimeThemeEntry> {
    val artists = artists.mapNotNull { it.toCredit() }
    return animethemes.mapNotNull { theme ->
        theme.toThemeEntry(
            songTitle = title,
            songArtists = artists,
            serverBaseUrl = serverBaseUrl
        )
    }
}

private fun ApiThemeWithAnime.toThemeEntry(
    songTitle: String?,
    songArtists: List<ArtistCredit>,
    serverBaseUrl: String
): AnimeThemeEntry? {
    val themeId = id ?: return null
    val anime = anime ?: return null
    val animeId = anime.id?.toString() ?: return null
    val video = animethemeentries.flatMap { it.videos }.firstOrNull()
    val themeTypeTag = type?.let { value ->
        val seq = sequence?.toString().orEmpty()
        "$value$seq"
    }
    val kitsuId = anime.kitsuExternalId()

    return AnimeThemeEntry(
        animeId = animeId,
        animeName = anime.name,
        animeNameEn = anime.englishTitle(),
        kitsuId = kitsuId,
        coverUrl = kitsuId?.let {
            resolveServerUrl(serverBaseUrl, "/v1/media/images/anime/$it/cover")
        } ?: anime.coverImageUrl(),
        themeId = themeId.toString(),
        title = songTitle?.takeIf { it.isNotBlank() } ?: themeTypeTag ?: type ?: "Theme",
        artist = songArtists.joinToString(", ") { it.name }.ifBlank { null },
        audioUrl = serverAudioUrl(serverBaseUrl, themeId),
        videoUrl = video?.link,
        themeType = themeTypeTag,
        artists = songArtists
    )
}

private fun ApiTheme.flattenedVideos(): List<ApiVideo> =
    animethemeentries.flatMap { it.videos }

private fun ApiAnime.kitsuExternalId(): String? {
    val resource: ApiResource = resources.firstOrNull {
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
        !path.isNullOrBlank() -> if (path.startsWith("http", ignoreCase = true)) {
            path
        } else {
            "https://i.animethemes.moe/$path"
        }
        else -> null
    }
}

private fun ApiAnime.englishTitle(): String? =
    synonyms.firstOrNull {
        it.type?.equals("English", ignoreCase = true) == true && !it.text.isNullOrBlank()
    }?.text

private fun ApiSong?.artistCredits(): List<ArtistCredit> =
    this?.artists.orEmpty().mapNotNull { it.toCredit() }

private fun ApiArtist.toCredit(): ArtistCredit? {
    val name = name?.trim()?.takeIf { it.isNotBlank() } ?: return null
    return ArtistCredit(
        name = name,
        asCharacter = artistsong?.asCharacter?.trim()?.takeIf { it.isNotBlank() },
        alias = artistsong?.alias?.trim()?.takeIf { it.isNotBlank() }
    )
}

private fun ApiSearchArtist.toOnlineArtist(): OnlineArtistResult? {
    val id = id ?: return null
    val name = name?.takeIf { it.isNotBlank() } ?: return null
    val slug = slug?.takeIf { it.isNotBlank() } ?: return null
    val imageUrl = images.firstOrNull {
        it.facet?.contains("Large", ignoreCase = true) == true
    } ?: images.firstOrNull {
        it.facet?.contains("Small", ignoreCase = true) == true
    } ?: images.firstOrNull()
    return OnlineArtistResult(
        id = id,
        name = name,
        slug = slug,
        imageUrl = imageUrl?.link ?: imageUrl?.path
    )
}

private fun serverAudioUrl(serverBaseUrl: String, themeId: Long): String =
    resolveServerUrl(serverBaseUrl, "/v1/media/audio/$themeId").orEmpty()
