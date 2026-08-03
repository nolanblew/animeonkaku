package com.takeya.animeongaku.media

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.LoudnessProfile
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.dbToLinearVolume
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal data class PlaybackMediaItems(
    val items: List<MediaItem>,
    val currentIndex: Int
)

object PlaybackMediaExtras {
    const val PLAYABLE_KIND = "anime_ongaku.playable_kind"
    const val PLAYABLE_ID = "anime_ongaku.playable_id"
    const val PREFERRED_MODE = "anime_ongaku.preferred_mode"
    const val ACTUAL_MODE = "anime_ongaku.actual_mode"
    const val PLAYBACK_SOURCE = "anime_ongaku.playback_source"
    const val ANIME_TITLE = "anime_ongaku.anime_title"
    const val LOUDNESS_GAIN_DB = "anime_ongaku.loudness_gain_db"
}

internal data class PlaybackMediaTag(
    val playableKey: PlayableKey,
    val preferredMode: PlaybackMode,
    val actualMode: PlaybackMode?,
    val source: PlaybackSource?,
    val loudness: LoudnessProfile? = null
)

internal data class PlaybackMediaDescriptor(
    val mediaId: String,
    val uri: String,
    val title: String,
    val artist: String?,
    val albumTitle: String?,
    val subtitle: String?,
    val description: String,
    val artworkUrl: String?,
    val values: Map<String, Any>,
    val tag: PlaybackMediaTag,
    val loudness: LoudnessProfile?
)

internal fun ResolvedPlaybackItem.toPlaybackMediaDescriptor(
    activeServerBaseUrl: String? = null
): PlaybackMediaDescriptor {
    val actualLabel = actualMode?.displayLabel()
    val values = buildMap<String, Any> {
        put(PlaybackMediaExtras.PLAYABLE_KIND, playableKey.kind.name)
        put(PlaybackMediaExtras.PLAYABLE_ID, playableKey.id)
        put(PlaybackMediaExtras.PREFERRED_MODE, preferredMode.name)
        actualMode?.let { put(PlaybackMediaExtras.ACTUAL_MODE, it.name) }
        source?.let { put(PlaybackMediaExtras.PLAYBACK_SOURCE, it.name) }
        animeTitle?.let { put(PlaybackMediaExtras.ANIME_TITLE, it) }
        loudness?.let { put(PlaybackMediaExtras.LOUDNESS_GAIN_DB, it.attenuationGainDb()) }
    }
    return PlaybackMediaDescriptor(
        mediaId = queueId.toString(),
        uri = rewriteServerMediaUrl(uri.orEmpty(), activeServerBaseUrl),
        title = title,
        artist = artist,
        albumTitle = albumTitle ?: animeTitle ?: animeOrRelease,
        subtitle = actualLabel,
        description = listOfNotNull(animeOrRelease, actualLabel).distinct().joinToString(" · "),
        artworkUrl = artworkUrl
            ?.let { rewriteServerMediaUrl(it, activeServerBaseUrl) }
            ?.takeIf(String::isAbsoluteUri),
        values = values,
        tag = PlaybackMediaTag(playableKey, preferredMode, actualMode, source, loudness),
        loudness = loudness
    )
}

internal fun ResolvedPlaybackItem.toPlaybackMediaItem(
    artworkData: ByteArray? = null,
    activeServerBaseUrl: String? = null,
    includePlatformExtras: Boolean = true
): MediaItem {
    val descriptor = toPlaybackMediaDescriptor(activeServerBaseUrl)
    val extras = if (includePlatformExtras) Bundle().apply {
        descriptor.values.forEach { (key, value) ->
            when (value) {
                is String -> putString(key, value)
                is Long -> putLong(key, value)
                is Double -> putDouble(key, value)
            }
        }
    } else null
    return MediaItem.Builder()
        .setMediaId(descriptor.mediaId)
        .setUri(descriptor.uri)
        .setTag(descriptor.tag)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(descriptor.title)
                .setArtist(descriptor.artist)
                .setAlbumTitle(descriptor.albumTitle)
                .setSubtitle(descriptor.subtitle)
                .setDescription(descriptor.description)
                .apply {
                    if (extras != null) setExtras(extras)
                    if (descriptor.artworkUrl != null) setArtworkUri(Uri.parse(descriptor.artworkUrl))
                    if (artworkData != null) {
                        setArtworkData(artworkData.copyOf(), MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                    }
                }
                .build()
        )
        .build()
}

private fun PlaybackMode.displayLabel(): String = when (this) {
    PlaybackMode.TV_SIZE -> "TV Size"
    PlaybackMode.FULL_SIZE -> "Full Size"
    PlaybackMode.VIDEO -> "Video"
    PlaybackMode.RELATED_AUDIO -> "Related Audio"
}

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

/** Safe across the MediaSession boundary because it reads the platform metadata bundle, not tag. */
internal fun MediaItem.loudnessPlayerVolume(): Float {
    val gainDb = mediaMetadata.extras
        ?.takeIf { it.containsKey(PlaybackMediaExtras.LOUDNESS_GAIN_DB) }
        ?.getDouble(PlaybackMediaExtras.LOUDNESS_GAIN_DB)
        ?: return 1f
    return dbToLinearVolume(gainDb)
}
