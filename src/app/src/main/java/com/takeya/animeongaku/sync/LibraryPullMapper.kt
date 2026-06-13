package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeGenreCrossRef
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.remote.OngakuAnimeDto
import com.takeya.animeongaku.data.remote.OngakuThemeDto
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

fun OngakuAnimeDto.toAnimeEntity(serverBaseUrl: String): AnimeEntity = AnimeEntity(
    kitsuId = kitsuId,
    animeThemesId = animeThemesId,
    title = title,
    titleEn = titleEn,
    titleRomaji = titleRomaji,
    titleJa = titleJa,
    thumbnailUrl = resolveServerUrl(serverBaseUrl, posterUrl),
    thumbnailUrlLarge = resolveServerUrl(serverBaseUrl, posterUrl),
    coverUrl = resolveServerUrl(serverBaseUrl, coverUrl),
    coverUrlLarge = resolveServerUrl(serverBaseUrl, coverUrl),
    syncedAt = updatedAt,
    isManuallyAdded = false,
    watchingStatus = watchingStatus,
    subtype = subtype,
    startDate = startDate,
    endDate = endDate,
    episodeCount = episodeCount,
    ageRating = ageRating,
    averageRating = averageRating,
    userRating = userRating,
    libraryUpdatedAt = libraryUpdatedAt,
    slug = slug
)

fun OngakuThemeDto.toThemeEntity(serverBaseUrl: String, existing: ThemeEntity?): ThemeEntity = ThemeEntity(
    id = id,
    animeId = animeThemesAnimeId,
    title = title,
    artistName = artists.joinToString(", ") { it.name }.ifBlank { null },
    audioUrl = resolveServerUrl(serverBaseUrl, audioUrl).orEmpty(),
    videoUrl = null,
    isDownloaded = existing?.isDownloaded ?: false,
    localFilePath = existing?.localFilePath,
    themeType = themeType,
    source = ThemeEntity.SOURCE_KITSU
)

fun OngakuThemeDto.toArtistCrossRefs(): List<ThemeArtistCrossRef> =
    artists.map { artist ->
        ThemeArtistCrossRef(
            themeId = id,
            artistName = artist.name,
            asCharacter = artist.asCharacter,
            alias = artist.alias
        )
    }

fun OngakuAnimeDto.toGenreRows(): Pair<List<GenreEntity>, List<AnimeGenreCrossRef>> {
    val genreEntities = genres
        .map { displayName ->
            GenreEntity(
                slug = displayName.toGenreSlug(),
                displayName = displayName,
                source = "server"
            )
        }
        .distinctBy { it.slug }
    val crossRefs = genreEntities.map { genre ->
        AnimeGenreCrossRef(kitsuId = kitsuId, slug = genre.slug)
    }
    return genreEntities to crossRefs
}

fun resolveServerUrl(serverBaseUrl: String, value: String?): String? {
    val trimmed = value?.trim().orEmpty()
    if (trimmed.isBlank()) return null
    if (trimmed.startsWith("http://", ignoreCase = true) || trimmed.startsWith("https://", ignoreCase = true)) {
        return trimmed
    }

    val base = serverBaseUrl.toHttpUrlOrNull() ?: return trimmed
    val path = trimmed.substringBefore("?").trimStart('/')
    val query = trimmed.substringAfter("?", missingDelimiterValue = "")
    val basePath = base.encodedPath.trim('/')
    val joinedPath = listOf(basePath, path)
        .filter { it.isNotBlank() }
        .joinToString(separator = "/", prefix = "/")

    return base.newBuilder()
        .encodedPath(joinedPath)
        .apply {
            if (query.isNotBlank()) encodedQuery(query)
        }
        .build()
        .toString()
}

private fun String.toGenreSlug(): String =
    lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
