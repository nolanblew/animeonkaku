package com.takeya.animeongaku.download

import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.LoudnessProfile
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
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
    val legacyThemeId: Long? = null,
    val loudness: LoudnessProfile? = null
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

        fun themeTv(themeId: Long, url: String, loudness: LoudnessProfile? = null) = DownloadMediaSpec(
            DownloadItemEntity.tvSizeMediaKey(themeId), TYPE_THEME, themeId, MODE_TV_SIZE, url, themeId, loudness
        )

        fun song(songId: Long, url: String, loudness: LoudnessProfile? = null) = DownloadMediaSpec(
            DownloadItemEntity.songMediaKey(songId), TYPE_SONG, songId, MODE_AUDIO, url, loudness = loudness
        )
    }
}

internal fun resolveThemeFullSizeDownload(
    descriptor: ThemeModeEntity?,
    canonicalSongUrl: String?,
    canonicalSongLoudness: LoudnessProfile? = null
): DownloadMediaSpec? {
    val songId = descriptor?.fullSizeSongId ?: return null
    val sourceUrl = canonicalSongUrl?.takeIf(String::isNotBlank)
        ?: descriptor.fullSizeUrl?.takeIf(String::isNotBlank)
        ?: return null
    return DownloadMediaSpec.song(songId, sourceUrl, canonicalSongLoudness ?: descriptor.fullSizeLoudness)
}

internal fun resolveThemeDownloadMedia(
    themeId: Long,
    fallbackTvUrl: String,
    descriptor: ThemeModeEntity?,
    canonicalSongUrl: String?,
    canonicalSongLoudness: LoudnessProfile? = null,
    preference: UserPreferenceEntity? = null,
    fallbackMode: String = "TV_SIZE",
    overrideUserPreference: Boolean = false
): DownloadMediaSpec? {
    val tvUrl = descriptor?.tvSizeUrl?.takeIf(String::isNotBlank)
        ?: fallbackTvUrl.takeIf(String::isNotBlank)
    val full = resolveThemeFullSizeDownload(descriptor, canonicalSongUrl, canonicalSongLoudness)
    val preferredMode = if (overrideUserPreference) fallbackMode else preference?.preferredMode ?: fallbackMode
    val tvAllowed = preference?.isDislikedTvSize != true
    val fullAllowed = preference?.isDislikedFullSize != true
    val hasThemeDirective = (!overrideUserPreference && preference?.preferredMode != null) || !tvAllowed || !fullAllowed

    val orderedModes = when (preferredMode) {
        "FULL_SIZE" -> if (hasThemeDirective) listOf("FULL_SIZE", "TV_SIZE") else listOf("FULL_SIZE")
        "TV_SIZE" -> if (hasThemeDirective) listOf("TV_SIZE", "FULL_SIZE") else listOf("TV_SIZE")
        else -> emptyList()
    }
    return orderedModes.firstNotNullOfOrNull { mode ->
        when (mode) {
            "TV_SIZE" -> tvUrl?.takeIf { tvAllowed }
                ?.let { DownloadMediaSpec.themeTv(themeId, it, descriptor?.tvSizeLoudness) }
            "FULL_SIZE" -> full?.takeIf { fullAllowed }
            else -> null
        }
    }
}

/** Resolves persisted playlist policy only; it never applies online playback fallbacks. */
internal fun resolvePlaylistDownloadMedia(
    entries: List<PlaylistEntryEntity>,
    playlistDefaultMode: String,
    themeModes: Map<Long, ThemeModeEntity>,
    songUrls: Map<Long, String>,
    songLoudness: Map<Long, LoudnessProfile?> = emptyMap(),
    themePreferences: Map<Long, UserPreferenceEntity> = emptyMap(),
    overrideUserPreference: Boolean = false
): List<DownloadMediaSpec> = entries.mapNotNull { entry ->
    when (entry.itemType) {
        PlaylistEntryEntity.ITEM_TYPE_SONG -> songUrls[entry.itemId]
            ?.takeIf(String::isNotBlank)
            ?.let { DownloadMediaSpec.song(entry.itemId, it, songLoudness[entry.itemId]) }

        PlaylistEntryEntity.ITEM_TYPE_THEME -> {
            val mode = entry.modeOverride ?: playlistDefaultMode
            val descriptor = themeModes[entry.itemId]
            resolveThemeDownloadMedia(
                themeId = entry.itemId,
                fallbackTvUrl = descriptor?.tvSizeUrl.orEmpty(),
                descriptor = descriptor,
                canonicalSongUrl = descriptor?.fullSizeSongId?.let(songUrls::get),
                canonicalSongLoudness = descriptor?.fullSizeSongId?.let(songLoudness::get),
                preference = themePreferences[entry.itemId],
                fallbackMode = mode,
                overrideUserPreference = overrideUserPreference
            )
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
