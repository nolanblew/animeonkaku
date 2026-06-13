package com.takeya.animeongaku.data.remote

data class OngakuLoginRequest(
    val username: String,
    val password: String,
    val deviceName: String
)

data class OngakuLoginResponse(
    val token: String,
    val user: OngakuUserDto,
    val isNewUser: Boolean
)

data class OngakuUserDto(
    val kitsuUserId: String,
    val username: String
)

data class OngakuMeResponse(
    val user: OngakuUserDto,
    val kitsuAuthState: String,
    val lastSyncAt: Long?,
    val devices: List<OngakuDeviceDto>
)

data class OngakuDeviceDto(
    val id: Long,
    val deviceName: String,
    val createdAt: Long,
    val lastUsedAt: Long,
    val current: Boolean
)

data class OngakuLibraryResponse(
    val serverTime: Long,
    val anime: List<OngakuAnimeDto>,
    val themes: List<OngakuThemeDto>
)

data class OngakuAnimeDetailResponse(
    val anime: OngakuAnimeDto,
    val themes: List<OngakuThemeDto>
)

data class OngakuSearchResponse(
    val query: String,
    val animeThemes: AnimeThemesSearchResponse = AnimeThemesSearchResponse(),
    val kitsu: Any? = null
)

data class AnimeThemesSingleArtistResponse(
    val artist: ApiArtistProfileWithSongs? = null
)

data class ApiArtistProfileWithSongs(
    val id: Long? = null,
    val name: String? = null,
    val slug: String? = null,
    val images: List<ApiArtistImage> = emptyList(),
    val songs: List<ApiArtistSongWithThemes> = emptyList()
)

data class ApiArtistSongWithThemes(
    val title: String? = null,
    val artists: List<ApiArtist> = emptyList(),
    val animethemes: List<ApiThemeWithAnime> = emptyList()
)

data class ApiThemeWithAnime(
    val id: Long? = null,
    val type: String? = null,
    val sequence: Int? = null,
    val anime: ApiAnime? = null,
    val animethemeentries: List<ApiThemeEntry> = emptyList()
)

data class OngakuAnimeDto(
    val kitsuId: String,
    val animeThemesId: Long?,
    val title: String?,
    val titleEn: String?,
    val titleRomaji: String?,
    val titleJa: String?,
    val posterUrl: String?,
    val coverUrl: String?,
    val watchingStatus: String?,
    val subtype: String?,
    val startDate: String?,
    val endDate: String?,
    val episodeCount: Int?,
    val ageRating: String?,
    val averageRating: Double?,
    val userRating: Double?,
    val libraryUpdatedAt: Long?,
    val slug: String?,
    val genres: List<String>,
    val updatedAt: Long,
    val deleted: Boolean
)

data class OngakuThemeDto(
    val id: Long,
    val animeThemesAnimeId: Long,
    val kitsuAnimeIds: List<String>,
    val title: String,
    val themeType: String?,
    val artists: List<OngakuThemeArtistDto>,
    val audioUrl: String,
    val videoUrl: String?,
    val audioState: String,
    val durationSeconds: Int?,
    val fileSize: Long?,
    val updatedAt: Long,
    val deleted: Boolean
)

data class OngakuThemeArtistDto(
    val name: String,
    val asCharacter: String?,
    val alias: String?
)

data class OngakuThemePrefDto(
    val themeId: Long,
    val liked: Boolean,
    val disliked: Boolean,
    val playCount: Int,
    val lastPlayedAt: Long?
)

data class OngakuThemePrefPatch(
    val liked: Boolean? = null,
    val disliked: Boolean? = null
)

data class OngakuPlayEvent(
    val themeId: Long,
    val playedAt: Long
)

data class OngakuPlayAcceptedResponse(
    val accepted: Int
)

data class OngakuPlaylistDto(
    val id: Long,
    val name: String,
    val entries: List<Long>,
    val isAuto: Boolean,
    val updatedAt: Long,
    val dynamicSpecJson: Any?
)

data class OngakuPlaylistRequest(
    val name: String? = null,
    val entries: List<Long>? = null,
    val dynamicSpecJson: Any? = null
)

data class OngakuPlaylistResponse(
    val playlist: OngakuPlaylistDto
)

data class OngakuManualAnimeRequest(
    val kitsuId: String? = null,
    val animeThemesId: Long? = null
)

data class OngakuManualAnimeResponse(
    val accepted: Boolean,
    val queuedJobIds: List<Long>
)

data class OngakuSyncRequest(
    val full: Boolean = false
)

data class OngakuSyncQueuedResponse(
    val jobId: Long
)

data class OngakuSyncStatusResponse(
    val state: String,
    val phase: String?,
    val progress: Map<String, Any?>,
    val lastCompletedAt: Long?,
    val unmatched: List<String>
)

data class OngakuAudioRequestResponse(
    val themeId: Long,
    val audioState: String,
    val jobId: Long
)
