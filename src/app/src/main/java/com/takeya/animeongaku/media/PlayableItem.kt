package com.takeya.animeongaku.media

import androidx.compose.runtime.Immutable
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity

enum class PlayableKind { THEME, SONG }

@Immutable
data class PlayableKey(
    val kind: PlayableKind,
    val id: Long
)

/** Passive queue policy data. MC-A03 owns interpreting this value. */
@Immutable
data class BaseModePolicy(
    val entryPolicy: ThemeModePolicy = ThemeModePolicy.INHERIT,
    val playlistDefault: PlaybackMode? = null
) {
    init {
        require(playlistDefault == null || playlistDefault == PlaybackMode.TV_SIZE || playlistDefault == PlaybackMode.FULL_SIZE) {
            "Playlist default must be TV_SIZE or FULL_SIZE"
        }
    }

    constructor(requestedMode: String?) : this(
        entryPolicy = requestedMode?.let { value ->
            ThemeModePolicy.entries.firstOrNull { it.name == value }
        } ?: ThemeModePolicy.INHERIT
    )

    val requestedMode: String?
        get() = entryPolicy.takeUnless { it == ThemeModePolicy.INHERIT }?.name

    companion object {
        val Inherit = BaseModePolicy()
    }
}

@Immutable
data class PlayableDisplayMetadata(
    val title: String,
    val artist: String?,
    val album: String?,
    val animeTitle: String?,
    val artworkUrl: String?
)

sealed interface PlayableItem {
    val key: PlayableKey
    val anime: AnimeEntity?
    val display: PlayableDisplayMetadata
    val remoteAudioUrl: String
    val localFilePath: String?

    @Immutable
    data class Theme(
        val theme: ThemeEntity,
        override val anime: AnimeEntity? = null,
        val modeDescriptor: ThemeModeEntity? = null
    ) : PlayableItem {
        override val key = PlayableKey(PlayableKind.THEME, theme.id)
        override val display = PlayableDisplayMetadata(
            title = theme.title,
            artist = theme.artistName,
            album = anime?.title,
            animeTitle = anime?.title,
            artworkUrl = anime?.coverUrl ?: anime?.thumbnailUrl
        )
        override val remoteAudioUrl: String = theme.audioUrl
        override val localFilePath: String? = theme.localFilePath.takeIf { theme.isDownloaded }
    }

    @Immutable
    data class RelatedSong(
        val song: SongEntity,
        val release: MusicReleaseEntity? = null,
        override val anime: AnimeEntity? = null,
        val relationshipType: String? = null,
        override val localFilePath: String? = null
    ) : PlayableItem {
        override val key = PlayableKey(PlayableKind.SONG, song.id)
        override val display = PlayableDisplayMetadata(
            title = song.title,
            artist = song.artistCredit,
            album = release?.title,
            animeTitle = anime?.title,
            artworkUrl = release?.artworkUrl ?: anime?.coverUrl ?: anime?.thumbnailUrl
        )
        override val remoteAudioUrl: String = song.audioUrl
    }
}
