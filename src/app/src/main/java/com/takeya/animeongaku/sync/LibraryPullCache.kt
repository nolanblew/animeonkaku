package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeGenreCrossRef
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.SongPreferenceEntity

interface LibraryPullCache {
    suspend fun existingThemes(themeIds: List<Long>): Map<Long, ThemeEntity>

    suspend fun applyLibraryPull(
        deletedKitsuIds: List<String>,
        deletedThemeIds: List<Long>,
        anime: List<AnimeEntity>,
        themes: List<ThemeEntity>,
        themeModes: List<ThemeModeEntity>,
        artistRefs: List<ThemeArtistCrossRef>,
        genres: List<GenreEntity>,
        genreRefs: List<AnimeGenreCrossRef>
    )

    suspend fun applyThemePrefs(
        preferences: List<UserPreferenceEntity>,
        playCounts: List<PlayCountEntity>
    )

    suspend fun applySongPrefs(preferences: List<SongPreferenceEntity>)

    suspend fun replaceMusicCatalog(snapshot: MusicCatalogSnapshot)

    suspend fun applyAutoPlaylists(
        deletedPlaylistIds: List<Long>,
        deletedPlaylists: List<PlaylistEntity>,
        pruneMissingAutoPlaylists: Boolean,
        playlists: List<PlaylistEntity>,
        entries: List<PlaylistEntryEntity>,
        dynamicSpecs: List<DynamicPlaylistSpecEntity>
    )
}

data class LibraryPullResult(
    val applied: Boolean,
    val animeCount: Int = 0,
    val themeCount: Int = 0,
    val serverTime: Long? = null
)
