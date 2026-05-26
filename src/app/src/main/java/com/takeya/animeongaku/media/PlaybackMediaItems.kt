package com.takeya.animeongaku.media

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl

internal fun QueueEntry.toPlaybackMediaItem(animeMap: Map<Long, AnimeEntity>): MediaItem =
    theme.toPlaybackMediaItem(queueId.toString(), animeMap)

internal fun ThemeEntity.toPlaybackMediaItem(
    mediaId: String,
    animeMap: Map<Long, AnimeEntity>
): MediaItem {
    val anime = animeId?.let { animeMap[it] }
    val artworkUrl = anime?.primaryArtworkUrl()
    val animeName = anime?.title
    val typeTag = themeType

    val primaryLine = when {
        !animeName.isNullOrBlank() && !typeTag.isNullOrBlank() -> "$animeName - $typeTag"
        !animeName.isNullOrBlank() -> animeName
        !typeTag.isNullOrBlank() -> "$typeTag - $title"
        else -> title
    }
    val secondaryLine = when {
        !artistName.isNullOrBlank() -> "$title - $artistName"
        else -> title
    }

    return MediaItem.Builder()
        .setMediaId(mediaId)
        .setUri(playbackUri())
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(primaryLine)
                .setArtist(secondaryLine)
                .setAlbumTitle(animeName)
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                .setIsPlayable(true)
                .setIsBrowsable(false)
                .apply {
                    if (!artworkUrl.isNullOrBlank()) {
                        setArtworkUri(Uri.parse(artworkUrl))
                    }
                }
                .build()
        )
        .build()
}

internal fun ThemeEntity.playbackUri(): String =
    if (isDownloaded && !localFilePath.isNullOrBlank()) {
        if (localFilePath.startsWith("/")) "file://$localFilePath" else localFilePath
    } else {
        audioUrl
    }
