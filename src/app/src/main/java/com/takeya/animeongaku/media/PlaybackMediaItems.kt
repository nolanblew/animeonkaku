package com.takeya.animeongaku.media

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl

internal data class PlaybackMediaItems(
    val items: List<MediaItem>,
    val currentIndex: Int
)

internal fun NowPlayingState.toPlaybackMediaItems(
    shouldIncludeInPlayer: (Int, ThemeEntity) -> Boolean = { _, _ -> true },
    artworkDataForAnime: (AnimeEntity) -> ByteArray? = { null }
): PlaybackMediaItems {
    val items = ArrayList<MediaItem>(nowPlayingEntries.size)
    var playbackCurrentIndex = 0

    nowPlayingEntries.forEachIndexed { idx, entry ->
        if (shouldIncludeInPlayer(idx, entry.theme)) {
            if (idx < currentIndex) playbackCurrentIndex++
            items.add(entry.toPlaybackMediaItem(animeMap, artworkDataForAnime))
        }
    }

    return PlaybackMediaItems(
        items = items,
        currentIndex = playbackCurrentIndex.coerceAtMost((items.size - 1).coerceAtLeast(0))
    )
}

internal fun QueueEntry.toPlaybackMediaItem(
    animeMap: Map<Long, AnimeEntity>,
    artworkDataForAnime: (AnimeEntity) -> ByteArray? = { null }
): MediaItem = theme.toPlaybackMediaItem(queueId.toString(), animeMap, artworkDataForAnime)

internal fun ThemeEntity.toPlaybackMediaItem(
    mediaId: String,
    animeMap: Map<Long, AnimeEntity>,
    artworkDataForAnime: (AnimeEntity) -> ByteArray? = { null }
): MediaItem {
    val anime = animeId?.let { animeMap[it] }
    val artworkUrl = anime?.primaryArtworkUrl()
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

    val uri = playbackUriString()

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

internal fun ThemeEntity.playbackUriString(): String =
    if (isDownloaded && !localFilePath.isNullOrBlank()) {
        if (localFilePath.startsWith("/")) "file://$localFilePath" else localFilePath
    } else {
        audioUrl
    }

internal fun MediaItem.withArtworkData(artworkData: ByteArray): MediaItem {
    val updatedMetadata = mediaMetadata.buildUpon()
        .setArtworkData(artworkData.copyOf(), MediaMetadata.PICTURE_TYPE_FRONT_COVER)
        .build()

    return buildUpon()
        .setMediaMetadata(updatedMetadata)
        .build()
}
