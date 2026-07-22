package com.takeya.animeongaku.ui.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.data.repository.ServerPlaylistWriter
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.data.repository.MusicCatalogRepository
import com.takeya.animeongaku.media.MediaControllerManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.ExperimentalCoroutinesApi

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class PlayerViewModel @Inject constructor(
    val nowPlayingManager: NowPlayingManager,
    val mediaControllerManager: MediaControllerManager,
    private val playlistDao: PlaylistDao,
    private val themeDao: ThemeDao,
    private val themeModeDao: ThemeModeDao,
    private val animeDao: AnimeDao,
    private val serverPlaylistWriter: ServerPlaylistWriter,
    private val userPreferencesRepository: UserPreferencesRepository,
    musicCatalogRepository: MusicCatalogRepository,
    val connectivityMonitor: ConnectivityMonitor
) : ViewModel() {
    private val videoModeSessionTracker = VideoModeSessionTracker()
    val nowPlayingState: StateFlow<NowPlayingState> = nowPlayingManager.state
    val playbackState: StateFlow<PlaybackState> = mediaControllerManager.playbackState
    val modeUiState: StateFlow<PlayerModeUiState> = combine(nowPlayingState, playbackState) { nowPlaying, playback ->
        derivePlayerModeUiState(
            isTheme = nowPlaying.currentEntry?.themeOrNull != null,
            currentQueueId = nowPlaying.currentEntry?.queueId,
            playbackState = playback
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerModeUiState())

    val isOnline: StateFlow<Boolean> = connectivityMonitor.isOnline

    val hasRelatedMusic: StateFlow<Boolean> = nowPlayingState
        .map { it.currentEntry?.item?.anime?.kitsuId.orEmpty() }
        .flatMapLatest { kitsuId ->
            if (kitsuId.isBlank()) kotlinx.coroutines.flow.flowOf(false)
            else musicCatalogRepository.observeAnimeReleases(kitsuId).map { it.isNotEmpty() }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    val queuedThemeModesById: StateFlow<Map<Long, ThemeModeEntity>> = nowPlayingState
        .map { state -> state.nowPlayingEntries.mapNotNull { it.themeOrNull?.id }.distinct() }
        .flatMapLatest { ids ->
            if (ids.isEmpty()) kotlinx.coroutines.flow.flowOf(emptyList()) else themeModeDao.observeByThemeIds(ids)
        }
        .map { modes -> modes.associateBy { it.themeId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    fun requestQueuedThemeVideo(queueId: Long): BrowseVideoStartRequest? {
        val state = nowPlayingState.value
        val entry = state.nowPlayingEntries.firstOrNull { it.queueId == queueId } ?: return null
        val theme = entry.themeOrNull ?: return null
        val animeMap = entry.item.anime?.let { anime -> theme.animeId?.let { mapOf(it to anime) } }
            ?: theme.animeId?.let { id -> state.animeMap[id]?.let { mapOf(id to it) } }.orEmpty()
        return BrowseVideoActionPolicy.request(isOnline.value, "Theme", listOf(theme), queuedThemeModesById.value, animeMap)
    }

    fun startQueuedThemeVideo(queueId: Long, request: BrowseVideoStartRequest): Boolean {
        val state = nowPlayingState.value
        val entry = state.nowPlayingEntries.firstOrNull { it.queueId == queueId } ?: return false
        val theme = entry.themeOrNull ?: return false
        val animeMap = entry.item.anime?.let { anime -> theme.animeId?.let { mapOf(it to anime) } }
            ?: theme.animeId?.let { id -> state.animeMap[id]?.let { mapOf(id to it) } }.orEmpty()
        return request.startIfStillValid(
            nowPlayingManager, isOnline.value, listOf(theme), queuedThemeModesById.value, "Theme", animeMap
        )
    }

    val downloadedThemeIds: StateFlow<Set<Long>> = themeDao.observeDownloadedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val playlists: StateFlow<List<PlaylistWithCount>> = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val playlistCoverUrls: StateFlow<Map<Long, List<List<String>>>> = playlistDao.observeAllPlaylistCoverUrls()
        .map { rows ->
            rows.groupBy { it.playlistId }.mapValues { (_, list) ->
                list.take(4).map { row ->
                    listOfNotNull(
                        row.coverUrl?.takeIf { it.isNotBlank() },
                        row.thumbnailUrl?.takeIf { it.isNotBlank() }
                    )
                }
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    val dislikedThemeIds: StateFlow<Set<Long>> = userPreferencesRepository.observeDislikedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val currentPreference = nowPlayingState.flatMapLatest { state ->
        val themeId = state.currentTheme?.id
        if (themeId != null) userPreferencesRepository.observePreference(themeId) else kotlinx.coroutines.flow.flowOf(null)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val currentSongPreference: StateFlow<SongPreferenceEntity?> = nowPlayingState.flatMapLatest { state ->
        val songId = (state.currentItem as? PlayableItem.RelatedSong)?.song?.id
        if (songId != null) userPreferencesRepository.observeSongPreference(songId) else kotlinx.coroutines.flow.flowOf(null)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    suspend fun isInLibrary(themeId: Long): Boolean = themeDao.existsById(themeId)

    fun toggleLike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleLike(themeId) }
    }

    fun toggleDislike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleDislike(themeId) }
    }

    fun toggleModeDislike(themeId: Long, fullSize: Boolean) {
        viewModelScope.launch { userPreferencesRepository.toggleModeDislike(themeId, fullSize) }
    }

    fun toggleSongLike(songId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleSongLike(songId) }
    }

    fun toggleSongDislike(songId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleSongDislike(songId) }
    }

    /** UI entry point for the authoritative Theme playback-mode write boundary. */
    fun selectThemeMode(mode: PlaybackMode) {
        if (mode == PlaybackMode.RELATED_AUDIO) return
        if (mode == PlaybackMode.VIDEO) {
            val before = nowPlayingManager.state.value
            val queueId = before.currentEntry?.queueId ?: return
            val priorAudioMode = before.playbackIntent.rememberedAudioMode
            val wasAudioPlaying = mediaControllerManager.playbackState.value.isPlaying
            nowPlayingManager.selectThemeMode(mode)
            videoModeSessionTracker.begin(
                queueId = queueId,
                videoQueueVersion = nowPlayingManager.state.value.queueVersion,
                priorAudioMode = priorAudioMode,
                wasAudioPlaying = wasAudioPlaying
            )
            return
        }
        videoModeSessionTracker.clear()
        nowPlayingManager.selectThemeMode(mode)
    }

    fun exitVideoMode() {
        val nowPlaying = nowPlayingManager.state.value
        val exit = videoModeSessionTracker.consumeExit(
            currentQueueId = nowPlaying.currentEntry?.queueId,
            currentQueueVersion = nowPlaying.queueVersion,
            videoRequested = nowPlaying.playbackIntent.sessionOverride == PlaybackMode.VIDEO
        ) ?: return
        nowPlayingManager.selectThemeMode(exit.audioMode)
        if (exit.resumePlayback) mediaControllerManager.play() else mediaControllerManager.pause()
    }

    fun saveSongToLibrary(theme: ThemeEntity, animeEntity: AnimeEntity?) {
        viewModelScope.launch {
            themeDao.upsertAll(listOf(theme))
            if (animeEntity != null) {
                animeDao.upsertAll(listOf(animeEntity))
            }
        }
    }

    fun addToPlaylist(playlistId: Long, themeIds: List<Long>, modeOverride: String? = null) {
        viewModelScope.launch {
            serverPlaylistWriter.addThemeEntries(playlistId, themeIds, modeOverride)
        }
    }

    fun createAndAddToPlaylist(name: String, themeIds: List<Long>, modeOverride: String? = null) {
        viewModelScope.launch {
            serverPlaylistWriter.createPlaylistWithThemes(name, themeIds, modeOverride)
        }
    }
}
