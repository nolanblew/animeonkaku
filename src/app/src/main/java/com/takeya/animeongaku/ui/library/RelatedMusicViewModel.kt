package com.takeya.animeongaku.ui.library

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.SongPreferenceDao
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.data.remote.OngakuMusicApi
import com.takeya.animeongaku.data.remote.OngakuSongPrefPatch
import com.takeya.animeongaku.data.repository.MusicCatalogRepository
import com.takeya.animeongaku.data.repository.MusicOwner
import com.takeya.animeongaku.data.repository.RelatedRelease
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.data.repository.ServerPlaylistWriter
import com.takeya.animeongaku.data.repository.PlaylistWriteItem
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PlayableItem
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class RelatedMusicViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: MusicCatalogRepository,
    animeDao: AnimeDao,
    private val playlistDao: PlaylistDao,
    private val preferenceDao: SongPreferenceDao,
    private val musicApi: OngakuMusicApi,
    private val playlistWriter: ServerPlaylistWriter,
    val nowPlayingManager: NowPlayingManager
) : ViewModel() {
    val kitsuId: String = savedStateHandle["kitsuId"] ?: ""
    val selectedReleaseId: Long? = savedStateHandle.get<Long>("releaseId")?.takeIf { it > 0 }
    val anime = animeDao.observeByKitsuId(kitsuId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    private val remoteReleases = MutableStateFlow<List<RelatedRelease>>(emptyList())
    private val remoteSelectedRelease = MutableStateFlow<RelatedRelease?>(null)
    private val cachedReleases = anime.flatMapLatest { owner ->
        repository.observeAnimeReleases(kitsuId, owner?.title, owner?.coverUrl ?: owner?.thumbnailUrl)
    }
    val releases: StateFlow<List<RelatedRelease>> = combine(cachedReleases, remoteReleases) { cached, remote ->
        if (remote.isNotEmpty()) remote else cached
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    private val cachedSelectedRelease = anime.flatMapLatest { owner ->
        selectedReleaseId?.let {
            repository.observeRelease(kitsuId, it, owner?.title, owner?.coverUrl ?: owner?.thumbnailUrl)
        } ?: flowOf(null)
    }
    val selectedRelease: StateFlow<RelatedRelease?> = combine(cachedSelectedRelease, remoteSelectedRelease) { cached, remote ->
        remote ?: cached
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val playlists: StateFlow<List<PlaylistWithCount>> = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _refreshError = MutableStateFlow<String?>(null)
    val refreshError: StateFlow<String?> = _refreshError.asStateFlow()
    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    init { refresh() }

    fun refresh() = viewModelScope.launch {
        _isRefreshing.value = true
        _refreshError.value = null
        runCatching {
            val owner = anime.value
            val fallback = MusicOwner(kitsuId, owner?.title, owner?.coverUrl ?: owner?.thumbnailUrl)
            selectedReleaseId?.let {
                repository.refreshRelease(kitsuId, it, fallback).also { release -> remoteSelectedRelease.value = release }
            } ?: repository.refreshAnime(kitsuId).also { remoteReleases.value = it }
        }.onFailure { _refreshError.value = "Couldn’t refresh. Showing saved music." }
        _isRefreshing.value = false
    }

    fun playRelease(release: RelatedRelease, startIndex: Int = 0) {
        val items = release.tracks.map(RelatedTrack::playable)
        if (items.isEmpty()) return
        nowPlayingManager.playItems(release.release.title, items, startIndex.coerceIn(items.indices))
    }

    fun play(track: RelatedTrack) = nowPlayingManager.playItems(track.release.title, listOf(track.playable()))
    fun playNext(track: RelatedTrack) = nowPlayingManager.playNextItems(listOf(track.playable()))
    fun addToQueue(track: RelatedTrack) = nowPlayingManager.addPlayableItems(listOf(track.playable()))

    fun observePreference(songId: Long): Flow<SongPreferenceEntity?> = preferenceDao.observe(songId)

    fun toggleLike(songId: Long) = viewModelScope.launch {
        val current = preferenceDao.getByIdsIncludingDeleted(listOf(songId)).firstOrNull()
        val next = current?.isLiked != true
        val opTs = System.currentTimeMillis()
        val optimistic = (current ?: SongPreferenceEntity(songId)).copy(
            isLiked = next, isDisliked = if (next) false else current?.isDisliked == true,
            updatedAt = opTs, deletedAt = null
        )
        preferenceDao.upsertAll(listOf(optimistic))
        runCatching { musicApi.updateSongPref(songId, OngakuSongPrefPatch(liked = next, disliked = optimistic.isDisliked, opTs = opTs)) }
    }

    fun addToPlaylist(playlistId: Long, songId: Long) = viewModelScope.launch {
        playlistWriter.addItems(playlistId, listOf(PlaylistWriteItem(
            itemType = PlaylistEntryEntity.ITEM_TYPE_SONG,
            itemId = songId
        )))
    }

    fun createPlaylist(name: String, songId: Long) = viewModelScope.launch {
        playlistWriter.createPlaylistWithItems(name, listOf(PlaylistWriteItem(
            itemType = PlaylistEntryEntity.ITEM_TYPE_SONG,
            itemId = songId
        )))
    }
}

private fun RelatedTrack.playable() = PlayableItem.RelatedSong(
    song = song,
    release = release,
    anime = asAnimeEntity(),
    relationshipType = relationshipType
)
