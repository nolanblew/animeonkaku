package com.takeya.animeongaku.download

import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import java.io.File

internal fun canonicalDownloadItemDirectory(
    filesDir: File,
    itemType: String,
    itemId: Long
): File? = when (itemType) {
    DownloadMediaSpec.TYPE_THEME -> File(filesDir, "downloads/themes/$itemId")
    DownloadMediaSpec.TYPE_SONG -> File(filesDir, "downloads/songs/$itemId")
    else -> null
}

/** Exact downloadable audio. Video is deliberately not representable. */
data class DownloadMediaSpec(
    val mediaKey: String,
    val itemType: String,
    val itemId: Long,
    val mode: String,
    val sourceUrl: String,
    val legacyThemeId: Long? = null
) {
    init {
        require(itemType == TYPE_THEME || itemType == TYPE_SONG)
        require(mode == MODE_TV_SIZE || mode == MODE_AUDIO)
        val expectedKey = if (itemType == TYPE_THEME) {
            DownloadItemEntity.tvSizeMediaKey(itemId)
        } else {
            DownloadItemEntity.songMediaKey(itemId)
        }
        require(mediaKey == expectedKey) { "MediaKey must match the typed audio item" }
    }

    companion object {
        const val TYPE_THEME = "THEME"
        const val TYPE_SONG = "SONG"
        const val MODE_TV_SIZE = "TV_SIZE"
        const val MODE_AUDIO = "AUDIO"

        fun themeTv(themeId: Long, url: String) = DownloadMediaSpec(
            DownloadItemEntity.tvSizeMediaKey(themeId), TYPE_THEME, themeId, MODE_TV_SIZE, url, themeId
        )

        fun song(songId: Long, url: String) = DownloadMediaSpec(
            DownloadItemEntity.songMediaKey(songId), TYPE_SONG, songId, MODE_AUDIO, url
        )
    }
}

internal fun resolveThemeFullSizeDownload(
    descriptor: ThemeModeEntity?,
    canonicalSongUrl: String?
): DownloadMediaSpec? {
    val songId = descriptor?.fullSizeSongId ?: return null
    val sourceUrl = canonicalSongUrl?.takeIf(String::isNotBlank)
        ?: descriptor.fullSizeUrl?.takeIf(String::isNotBlank)
        ?: return null
    return DownloadMediaSpec.song(songId, sourceUrl)
}

/** Resolves persisted playlist policy only; it never applies online playback fallbacks. */
internal fun resolvePlaylistDownloadMedia(
    entries: List<PlaylistEntryEntity>,
    playlistDefaultMode: String,
    themeModes: Map<Long, ThemeModeEntity>,
    songUrls: Map<Long, String>
): List<DownloadMediaSpec> = entries.mapNotNull { entry ->
    when (entry.itemType) {
        PlaylistEntryEntity.ITEM_TYPE_SONG -> songUrls[entry.itemId]
            ?.takeIf(String::isNotBlank)
            ?.let { DownloadMediaSpec.song(entry.itemId, it) }

        PlaylistEntryEntity.ITEM_TYPE_THEME -> {
            val mode = entry.modeOverride ?: playlistDefaultMode
            val descriptor = themeModes[entry.itemId]
            when (mode) {
                "TV_SIZE" -> descriptor?.tvSizeUrl?.takeIf(String::isNotBlank)
                    ?.let { DownloadMediaSpec.themeTv(entry.itemId, it) }
                "FULL_SIZE" -> resolveThemeFullSizeDownload(
                    descriptor,
                    descriptor?.fullSizeSongId?.let(songUrls::get)
                )
                else -> null
            }
        }
        else -> null
    }
}.distinctBy(DownloadMediaSpec::mediaKey)

private val SAFE_AUDIO_EXTENSIONS = setOf("aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav")

internal fun safeDownloadFileName(contentDisposition: String?): String? {
    val raw = contentDisposition
        ?.substringAfter("filename=", missingDelimiterValue = "")
        ?.trim()
        ?.trim('"')
        ?.substringBefore(';')
        ?.trim()
        ?.takeIf(String::isNotBlank)
        ?: return null
    if (raw.contains('/') || raw.contains('\\') || raw == "." || raw == "..") return null
    val extension = raw.substringAfterLast('.', "").lowercase()
    return raw.takeIf { extension in SAFE_AUDIO_EXTENSIONS }
}
