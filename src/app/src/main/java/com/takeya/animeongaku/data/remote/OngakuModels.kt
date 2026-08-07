package com.takeya.animeongaku.data.remote

data class OngakuLoginRequest(
    val username: String,
    val password: String,
    val deviceName: String,
    val legacyLibraryImport: OngakuLegacyLibraryImport? = null
)

data class OngakuLoginResponse(
    val token: String,
    val user: OngakuUserDto,
    val isNewUser: Boolean,
    /** "FULL" or "DELTA" — which first-sync the server queued. Null on older servers. */
    val syncMode: String? = null,
    val legacyLibraryImport: OngakuLegacyLibraryImportSummary? = null
)

data class OngakuUserDto(
    val kitsuUserId: String,
    val username: String
)

data class OngakuLegacyLibraryImport(
    val entries: List<OngakuLegacyLibraryImportEntry>
)

data class OngakuLegacyLibraryImportEntry(
    val themeId: Long,
    val liked: Boolean = false,
    val disliked: Boolean = false,
    val playCount: Int = 0,
    val lastPlayedAt: Long? = null
)

data class OngakuLegacyLibraryImportSummary(
    val requestedEntries: Int,
    val importedEntries: Int,
    val skippedEntries: Int,
    val importedLikes: Int,
    val importedDislikes: Int,
    val importedPlayCounts: Int
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

/** Unified delta feed: library + theme prefs + playlists changed since the client's cursor. */
data class OngakuChangesResponse(
    val serverTime: Long,
    val anime: List<OngakuAnimeDto>,
    /** Null means the server's theme/mode snapshot is unchanged for this delta. */
    val themes: List<OngakuThemeDto>? = null,
    val prefs: List<OngakuThemePrefDto>,
    val playlists: List<OngakuPlaylistDto>,
    val songPrefs: List<OngakuSongPrefDto>? = null,
    val musicCatalog: List<OngakuAnimeMusicDto>? = null
)

data class OngakuAnimeDetailResponse(
    val anime: OngakuAnimeDto,
    val themes: List<OngakuThemeDto>
)

data class OngakuSearchResponse(
    val query: String,
    val animeThemes: AnimeThemesSearchResponse = AnimeThemesSearchResponse(),
    val kitsu: Any? = null,
    val music: OngakuMusicSearchDto = OngakuMusicSearchDto()
)

data class OngakuMusicSearchDto(
    val releases: List<OngakuMusicReleaseSearchResultDto> = emptyList(),
    val tracks: List<OngakuMusicTrackSearchResultDto> = emptyList()
)

data class OngakuMusicReleaseSearchResultDto(
    val anime: List<OngakuMusicAnimeSummaryDto> = emptyList(),
    val release: OngakuMusicReleaseDto
)

data class OngakuMusicTrackSearchResultDto(
    val anime: OngakuMusicAnimeSummaryDto,
    val relationshipType: String? = null,
    val releaseId: Long,
    val releaseTitle: String,
    val track: OngakuMusicTrackDto
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
    val mediaModes: OngakuThemeMediaModesDto? = null,
    val updatedAt: Long,
    val deleted: Boolean
)

data class OngakuThemeMediaModesDto(
    val tvSize: OngakuTvSizeModeDto,
    val fullSize: OngakuFullSizeModeDto? = null,
    val video: OngakuVideoModeDto? = null
)

data class OngakuLoudnessDto(
    val integratedLufs: Double? = null,
    val truePeakDbtp: Double? = null,
    val loudnessRangeLu: Double? = null,
    val gainDb: Double? = null,
    val policyVersion: Int? = null,
    val state: String? = null
)

data class OngakuTvSizeModeDto(
    val url: String,
    val durationSeconds: Int? = null,
    val fileSize: Long? = null,
    val loudness: OngakuLoudnessDto? = null
)

data class OngakuFullSizeModeDto(
    val songId: Long,
    val url: String,
    val durationSeconds: Int? = null,
    val fileSize: Long? = null,
    val sourceReleaseId: Long? = null,
    val loudness: OngakuLoudnessDto? = null
)

data class OngakuVideoModeDto(
    val url: String,
    val mimeType: String? = null,
    val spoiler: Boolean = false,
    val nsfw: Boolean = false,
    val entryVersion: Int? = null
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
    val dislikedTvSize: Boolean = false,
    val dislikedFullSize: Boolean = false,
    val preferredMode: String? = null,
    val playCount: Int,
    val lastPlayedAt: Long?,
    val updatedAt: Long = 0L,
    val deleted: Boolean = false
)

data class OngakuThemePrefPatch(
    val liked: Boolean? = null,
    val disliked: Boolean? = null,
    val dislikedTvSize: Boolean? = null,
    val dislikedFullSize: Boolean? = null,
    val preferredMode: String? = null,
    // Client op-timestamp (epoch ms) of when the user toggled; drives server last-write-wins.
    val opTs: Long? = null
)

data class OngakuPlayEvent(
    val themeId: Long,
    val playedAt: Long
)

data class OngakuActualPlayEvent(
    val clientEventId: String,
    val itemType: String,
    val itemId: Long,
    val actualMode: String,
    val playedAt: Long
)

data class OngakuPlayAcceptedResponse(
    val accepted: Int
)

data class OngakuPlaylistDto(
    val id: Long,
    val name: String,
    val entries: List<Long> = emptyList(),
    val defaultMode: String = "TV_SIZE",
    val items: List<OngakuPlaylistItemDto> = emptyList(),
    val isAuto: Boolean,
    val updatedAt: Long,
    val dynamicSpecJson: Any?,
    val isDynamic: Boolean = false,
    val autoUpdate: Boolean = true,
    val deleted: Boolean = false,
    val dynamicSortJson: Any? = null
)

data class OngakuPlaylistItemDto(
    val entryId: Long,
    val itemType: String,
    val itemId: Long,
    val modeOverride: String? = null
)

data class OngakuPlaylistRequest(
    val name: String? = null,
    val entries: List<Long>? = null,
    val defaultMode: String? = null,
    val items: List<OngakuPlaylistItemRequest>? = null,
    val dynamicSpecJson: Any? = null,
    val dynamicSortJson: Any? = null,
    val autoUpdate: Boolean? = null,
    val opTs: Long? = null
)

data class OngakuPlaylistItemRequest(
    val entryId: Long? = null,
    val itemType: String,
    val itemId: Long,
    val modeOverride: String? = null
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
    val full: Boolean = true
)

data class OngakuSyncQueuedResponse(
    val jobId: Long
)

data class OngakuSyncMappingStatusDto(
    val state: String,
    val lastError: String? = null
)

data class OngakuSyncStatusResponse(
    val state: String,
    val phase: String?,
    val progress: Map<String, Any?>,
    val lastCompletedAt: Long?,
    val unmatched: List<String>,
    val mapping: OngakuSyncMappingStatusDto? = null,
    val upstreamBlocked: Boolean = false
)

data class OngakuAudioRequestResponse(
    val themeId: Long,
    val audioState: String,
    val jobId: Long
)

data class OngakuSongPrefDto(
    val songId: Long,
    val liked: Boolean,
    val disliked: Boolean,
    val playCount: Int,
    val lastPlayedAt: Long?,
    val updatedAt: Long = 0L,
    val deleted: Boolean = false
)

data class OngakuSongPrefPatch(
    val liked: Boolean? = null,
    val disliked: Boolean? = null,
    val opTs: Long? = null
)

data class OngakuMusicAnimeSummaryDto(
    val kitsuId: String,
    val title: String? = null,
    val titleEn: String? = null,
    val posterUrl: String? = null,
    val relationshipType: String? = null
)

data class OngakuAnimeMusicDto(
    val anime: OngakuMusicAnimeSummaryDto,
    val releases: List<OngakuMusicReleaseDto> = emptyList()
)

data class OngakuMusicReleaseDto(
    val id: Long,
    val title: String,
    val titleEnglish: String? = null,
    val titleRomaji: String? = null,
    val titleJapanese: String? = null,
    val artistCredit: String,
    val artistNames: List<OngakuLocalizedNameDto> = emptyList(),
    val relationshipType: String,
    val releaseDate: String? = null,
    val year: Int? = null,
    val artworkUrl: String? = null,
    val tracks: List<OngakuMusicTrackDto> = emptyList(),
    val anime: List<OngakuMusicAnimeSummaryDto> = emptyList()
)

data class OngakuMusicTrackDto(
    val id: Long,
    val title: String,
    val titleEnglish: String? = null,
    val titleRomaji: String? = null,
    val titleJapanese: String? = null,
    val artistCredit: String,
    val artistNames: List<OngakuLocalizedNameDto> = emptyList(),
    val durationSeconds: Int? = null,
    val audioUrl: String,
    val fileSize: Long? = null,
    val discNumber: Int = 1,
    val trackNumber: Int? = null,
    val displayOrder: Int = 0,
    val loudness: OngakuLoudnessDto? = null
)

data class OngakuLocalizedNameDto(
    val english: String? = null,
    val romaji: String? = null,
    val japanese: String? = null
)
