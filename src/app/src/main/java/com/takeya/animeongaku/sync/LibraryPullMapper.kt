package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeGenreCrossRef
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.ReleaseTrackEntity
import com.takeya.animeongaku.data.local.AnimeMusicReleaseEntity
import com.takeya.animeongaku.data.remote.OngakuAnimeDto
import com.takeya.animeongaku.data.remote.OngakuAnimeMusicDto
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

fun OngakuThemeDto.toThemeModeEntity(serverBaseUrl: String): ThemeModeEntity {
    val modes = mediaModes
    val tvSize = modes?.tvSize
    val fullSize = modes?.fullSize
    val video = modes?.video
    return ThemeModeEntity(
        themeId = id,
        tvSizeUrl = resolveServerUrl(serverBaseUrl, tvSize?.url ?: audioUrl).orEmpty(),
        tvSizeDurationSeconds = tvSize?.durationSeconds ?: durationSeconds,
        tvSizeFileSize = tvSize?.fileSize ?: fileSize,
        fullSizeSongId = fullSize?.songId,
        fullSizeUrl = resolveServerUrl(serverBaseUrl, fullSize?.url),
        fullSizeDurationSeconds = fullSize?.durationSeconds,
        fullSizeFileSize = fullSize?.fileSize,
        fullSizeSourceReleaseId = fullSize?.sourceReleaseId,
        // This descriptor is intentionally not rebased: AnimeThemes video is direct and
        // must never inherit Anime Ongaku authentication/cache routing.
        videoUrl = video?.url?.trim()?.takeIf { it.isNotBlank() },
        videoMimeType = video?.mimeType,
        videoSpoiler = video?.spoiler ?: false,
        videoNsfw = video?.nsfw ?: false,
        videoEntryVersion = video?.entryVersion
    )
}

data class MusicCatalogSnapshot(
    val songs: List<SongEntity>,
    val releases: List<MusicReleaseEntity>,
    val releaseTracks: List<ReleaseTrackEntity>,
    val animeReleases: List<AnimeMusicReleaseEntity>
)

fun List<OngakuAnimeMusicDto>.toMusicCatalogSnapshot(serverBaseUrl: String): MusicCatalogSnapshot {
    val songs = mutableListOf<SongEntity>()
    val releases = mutableListOf<MusicReleaseEntity>()
    val releaseTracks = mutableListOf<ReleaseTrackEntity>()
    val animeReleases = mutableListOf<AnimeMusicReleaseEntity>()

    for (animeMusic in this) {
        for (release in animeMusic.releases) {
            releases += MusicReleaseEntity(
                id = release.id,
                title = release.title,
                artistCredit = release.artistCredit,
                releaseDate = release.releaseDate,
                year = release.year,
                artworkUrl = resolveServerUrl(serverBaseUrl, release.artworkUrl)
            )
            animeReleases += AnimeMusicReleaseEntity(
                kitsuAnimeId = animeMusic.anime.kitsuId,
                releaseId = release.id,
                relationshipType = release.relationshipType
            )
            release.tracks.forEach { track ->
                songs += SongEntity(
                    id = track.id,
                    title = track.title,
                    artistCredit = track.artistCredit,
                    durationSeconds = track.durationSeconds,
                    audioUrl = resolveServerUrl(serverBaseUrl, track.audioUrl).orEmpty(),
                    fileSize = track.fileSize
                )
                releaseTracks += ReleaseTrackEntity(
                    releaseId = release.id,
                    songId = track.id,
                    discNumber = track.discNumber,
                    trackNumber = track.trackNumber,
                    displayOrder = track.displayOrder
                )
            }
        }
    }

    return MusicCatalogSnapshot(
        songs = songs.distinctBy { it.id },
        releases = releases.distinctBy { it.id },
        releaseTracks = releaseTracks.distinctBy { it.releaseId to it.songId },
        animeReleases = animeReleases.distinctBy { it.kitsuAnimeId to it.releaseId }
    )
}

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
