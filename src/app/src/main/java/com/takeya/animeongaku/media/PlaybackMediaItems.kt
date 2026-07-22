package com.takeya.animeongaku.media

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal data class PlaybackMediaItems(
    val items: List<MediaItem>,
    val currentIndex: Int
)

internal fun NowPlayingState.toPlaybackMediaItems(
    shouldIncludeInPlayer: (Int, ThemeEntity) -> Boolean = { _, _ -> true },
    artworkDataForAnime: (AnimeEntity) -> ByteArray? = { null },
    activeServerBaseUrl: String? = null
): PlaybackMediaItems {
    val items = ArrayList<MediaItem>(nowPlayingEntries.size)
    var playbackCurrentIndex = 0

    nowPlayingEntries.forEachIndexed { idx, entry ->
        val theme = entry.themeOrNull
        if (theme == null || shouldIncludeInPlayer(idx, theme)) {
            if (idx < currentIndex) playbackCurrentIndex++
            items.add(entry.toPlaybackMediaItem(animeMap, artworkDataForAnime, activeServerBaseUrl))
        }
    }

    return PlaybackMediaItems(
        items = items,
        currentIndex = playbackCurrentIndex.coerceAtMost((items.size - 1).coerceAtLeast(0))
    )
}

internal fun QueueEntry.toPlaybackMediaItem(
    animeMap: Map<Long, AnimeEntity>,
    artworkDataForAnime: (AnimeEntity) -> ByteArray? = { null },
    activeServerBaseUrl: String? = null
): MediaItem = when (val playable = item) {
    is PlayableItem.Theme -> playable.theme.toPlaybackMediaItem(
        queueId.toString(),
        animeMap,
        artworkDataForAnime,
        activeServerBaseUrl
    )
    is PlayableItem.RelatedSong -> playable.toPlaybackMediaItem(queueId.toString(), artworkDataForAnime, activeServerBaseUrl)
}

private fun PlayableItem.RelatedSong.toPlaybackMediaItem(
    mediaId: String,
    artworkDataForAnime: (AnimeEntity) -> ByteArray?,
    activeServerBaseUrl: String?
): MediaItem {
    val artworkUrl = display.artworkUrl
        ?.let { rewriteServerMediaUrl(it, activeServerBaseUrl) }
        ?.takeIf { it.isAbsoluteUri() }
    val artworkData = anime?.let(artworkDataForAnime)?.copyOf()
    val uri = playbackUriString(activeServerBaseUrl)
    return MediaItem.Builder()
        .setMediaId(mediaId)
        .setUri(uri)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(display.title)
                .setArtist(display.artist)
                .setAlbumTitle(display.album ?: display.animeTitle)
                .apply {
                    if (!artworkUrl.isNullOrBlank()) setArtworkUri(Uri.parse(artworkUrl))
                    if (artworkData != null) {
                        setArtworkData(artworkData, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                    }
                }
                .build()
        )
        .build()
}

internal fun PlayableItem.playbackUriString(activeServerBaseUrl: String? = null): String = when (this) {
    is PlayableItem.Theme -> theme.playbackUriString(activeServerBaseUrl)
    is PlayableItem.RelatedSong -> localFilePath?.takeIf { it.isNotBlank() }?.let { path ->
        if (path.startsWith("/")) "file://$path" else path
    } ?: rewriteServerMediaUrl(song.audioUrl, activeServerBaseUrl)
}

internal fun ThemeEntity.toPlaybackMediaItem(
    mediaId: String,
    animeMap: Map<Long, AnimeEntity>,
    artworkDataForAnime: (AnimeEntity) -> ByteArray? = { null },
    activeServerBaseUrl: String? = null
): MediaItem {
    val anime = animeId?.let { animeMap[it] }
    val artworkUrl = anime?.primaryArtworkUrl()
        ?.let { rewriteServerMediaUrl(it, activeServerBaseUrl) }
        ?.takeIf { it.isAbsoluteUri() }
    val artworkData = anime?.let(artworkDataForAnime)?.copyOf()
    val animeName = anime?.title
    val typeTag = themeType

    val primaryLine = when {
        !animeName.isNullOrBlank() && !typeTag.isNullOrBlank() -> "$animeName · $typeTag"
        !animeName.isNullOrBlank() -> animeName
        !typeTag.isNullOrBlank() -> "$typeTag · $title"
        else -> title
    }
    val secondaryLine = when {
        !artistName.isNullOrBlank() -> "$title · $artistName"
        else -> title
    }

    val uri = playbackUriString(activeServerBaseUrl)

    return MediaItem.Builder()
        .setMediaId(mediaId)
        .setUri(uri)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(primaryLine)
                .setArtist(secondaryLine)
                .setAlbumTitle(animeName)
                .apply {
                    if (!artworkUrl.isNullOrBlank()) {
                        setArtworkUri(Uri.parse(artworkUrl))
                    }
                    if (artworkData != null) {
                        setArtworkData(artworkData, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                    }
                }
                .build()
        )
        .build()
}

internal fun ThemeEntity.playbackUriString(activeServerBaseUrl: String? = null): String =
    if (isDownloaded && !localFilePath.isNullOrBlank()) {
        if (localFilePath.startsWith("/")) "file://$localFilePath" else localFilePath
    } else {
        rewriteServerMediaUrl(audioUrl, activeServerBaseUrl)
    }

internal fun rewriteServerMediaUrl(url: String, activeServerBaseUrl: String?): String {
    val trimmed = url.trim()
    val activeBase = activeServerBaseUrl?.toHttpUrlOrNull() ?: return trimmed
    val source = trimmed.toHttpUrlOrNull()
    val rawPath = source?.encodedPath ?: trimmed.substringBefore("?")
    val query = source?.encodedQuery ?: trimmed.substringAfter("?", missingDelimiterValue = "")
    val mediaPath = rawPath.mediaRoutePathOrNull() ?: return trimmed
    return activeBase.withJoinedPath(mediaPath, query)
}

internal fun String.isAbsoluteUri(): Boolean {
    val schemeSeparator = indexOf(':')
    if (schemeSeparator <= 0) return false
    return take(schemeSeparator).withIndex().all { (index, char) ->
        when {
            index == 0 -> char.isLetter()
            else -> char.isLetterOrDigit() || char == '+' || char == '-' || char == '.'
        }
    }
}

private fun String.mediaRoutePathOrNull(): String? {
    val marker = "/v1/media/"
    val index = indexOf(marker)
    if (index < 0) return null
    return substring(index).trimStart('/')
}

private fun HttpUrl.withJoinedPath(path: String, query: String): String {
    val basePath = encodedPath.trim('/')
    val joinedPath = listOf(basePath, path.trimStart('/'))
        .filter { it.isNotBlank() }
        .joinToString(separator = "/", prefix = "/")
    return newBuilder()
        .encodedPath(joinedPath)
        .apply {
            if (query.isNotBlank()) encodedQuery(query)
        }
        .build()
        .toString()
}

internal fun MediaItem.withArtworkData(artworkData: ByteArray): MediaItem {
    val updatedMetadata = mediaMetadata.buildUpon()
        .setArtworkData(artworkData.copyOf(), MediaMetadata.PICTURE_TYPE_FRONT_COVER)
        .build()

    return buildUpon()
        .setMediaMetadata(updatedMetadata)
        .build()
}
