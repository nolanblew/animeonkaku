package com.takeya.animeongaku.sync

import android.util.Log
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.KitsuAnimeEntry
import com.takeya.animeongaku.data.auth.KitsuTokenStore
import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.LibrarySyncProgress
import com.takeya.animeongaku.data.repository.ThemeMappingProgress
import com.takeya.animeongaku.data.repository.UserRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.abs

@Singleton
class SyncManager @Inject constructor(
    private val userRepository: UserRepository,
    private val animeRepository: AnimeRepository,
    private val animeDao: AnimeDao,
    private val themeDao: ThemeDao,
    private val playlistDao: PlaylistDao,
    private val tokenStore: KitsuTokenStore
) {
    companion object {
        private const val TAG = "SyncManager"
        private const val TAG_FALLBACK = "AnimeThemesFallback"
        private const val KITSU_PLAYLIST_NAME = "Kitsu Library"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var syncJob: Job? = null

    private val _state = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = _state.asStateFlow()

    @Volatile
    private var pauseRequested = false

    val isRunning: Boolean get() = syncJob?.isActive == true

    fun startSync(userId: String, forceFullSync: Boolean) {
        if (isRunning) {
            Log.w(TAG, "Sync already running, ignoring start request")
            return
        }
        pauseRequested = false
        syncJob = scope.launch {
            try {
                _state.value = SyncState(phase = SyncPhase.SyncingLibrary, isRunning = true)
                doSync(userId, forceFullSync)
            } catch (e: CancellationException) {
                Log.d(TAG, "Sync cancelled")
                _state.value = _state.value.copy(
                    phase = SyncPhase.Idle,
                    isRunning = false,
                    status = "Sync cancelled"
                )
            } catch (e: Exception) {
                Log.e(TAG, "Sync failed", e)
                _state.value = _state.value.copy(
                    phase = SyncPhase.Error,
                    isRunning = false,
                    errorMessage = "Sync failed: ${e.message}"
                )
            }
        }
    }

    fun pause() {
        if (!isRunning) return
        pauseRequested = true
        _state.value = _state.value.copy(isPaused = true, status = "Paused")
    }

    fun resume() {
        pauseRequested = false
        _state.value = _state.value.copy(isPaused = false)
    }

    fun cancel() {
        syncJob?.cancel()
        syncJob = null
        pauseRequested = false
        _state.value = SyncState(
            phase = SyncPhase.Idle,
            isRunning = false,
            status = "Sync cancelled"
        )
    }

    private suspend fun checkPause() {
        while (pauseRequested) {
            delay(500)
        }
    }

    private suspend fun doSync(userId: String, forceFullSync: Boolean) {
        val isFirstSync = forceFullSync || tokenStore.getLastSyncedAt() == 0L

        updateState { copy(status = "Syncing Kitsu library…", phase = SyncPhase.SyncingLibrary) }

        val entries = if (isFirstSync) {
            userRepository.getLibraryEntries(userId) { progress ->
                updateState {
                    copy(
                        libraryProgress = progress,
                        status = progress.statusText(),
                        phase = SyncPhase.SyncingLibrary
                    )
                }
            }
        } else {
            val knownIds = animeDao.getAllKitsuIds().toSet()
            userRepository.getLibraryEntriesDelta(userId, knownIds) { progress ->
                updateState {
                    copy(
                        libraryProgress = progress,
                        status = progress.statusText(),
                        phase = SyncPhase.SyncingLibrary
                    )
                }
            }
        }

        if (entries.isEmpty() && !isFirstSync) {
            tokenStore.saveLastSyncedAt(System.currentTimeMillis())
            updateState {
                copy(
                    status = "Library is up to date — no new anime found",
                    phase = SyncPhase.Done,
                    isRunning = false,
                    lastSyncCount = 0,
                    lastThemeCount = 0
                )
            }
            return
        }

        checkPause()

        val now = System.currentTimeMillis()
        val entriesById = entries.associateBy { it.id }
        val animeEntities = entries.map {
            AnimeEntity(
                kitsuId = it.id,
                animeThemesId = null,
                title = it.title,
                titleEn = it.titleEn,
                titleRomaji = it.titleRomaji,
                titleJa = it.titleJa,
                thumbnailUrl = it.posterUrl,
                coverUrl = it.coverUrl,
                syncedAt = now
            )
        }
        animeDao.upsertAll(animeEntities)

        checkPause()

        // --- Map themes via Kitsu IDs ---
        updateState { copy(phase = SyncPhase.MappingThemes) }
        val syncResult = animeRepository.mapKitsuThemes(entries) { progress ->
            updateState {
                copy(
                    themeProgress = progress,
                    status = progress.statusText(),
                    phase = SyncPhase.MappingThemes
                )
            }
        }
        val themeEntities = syncResult.themes.map { it.toEntity() }
        val mappedAnimeEntities = animeEntities.map { anime ->
            val mappedId = syncResult.animeMappings[anime.kitsuId]
            if (mappedId != null) anime.copy(animeThemesId = mappedId) else anime
        }

        updateState { copy(phase = SyncPhase.Saving, status = "Saving…") }
        animeDao.upsertAll(mappedAnimeEntities)
        themeDao.upsertAll(themeEntities)

        checkPause()

        // --- Fallback: external ID lookup + title search ---
        var unmappedAnime = mappedAnimeEntities.filter { it.animeThemesId == null }
        val allThemeEntities = themeEntities.toMutableList()
        var finalAnimeEntities = mappedAnimeEntities.toMutableList()
        val stillUnmatched = mutableListOf<String>()

        if (unmappedAnime.isNotEmpty()) {
            Log.d(TAG_FALLBACK, "${unmappedAnime.size} anime unmapped after batch, trying external IDs")
            updateState {
                copy(
                    phase = SyncPhase.FallbackSearch,
                    status = "Fetching external IDs from Kitsu…",
                    fallbackTotal = unmappedAnime.size,
                    fallbackCurrent = 0
                )
            }

            // Step 1: Fetch Kitsu mappings (MAL, etc.)
            val unmappedKitsuIds = unmappedAnime.map { it.kitsuId }
            val kitsuMappings = userRepository.getAnimeMappings(unmappedKitsuIds)

            checkPause()

            // Step 2: Try MAL IDs on AnimeThemes
            val malIdToKitsuId = mutableMapOf<String, String>()
            unmappedAnime.forEach { anime ->
                val extIds = kitsuMappings[anime.kitsuId] ?: return@forEach
                val malId = extIds["myanimelist/anime"]
                if (malId != null) malIdToKitsuId[malId] = anime.kitsuId
            }

            if (malIdToKitsuId.isNotEmpty()) {
                Log.d(TAG_FALLBACK, "Trying ${malIdToKitsuId.size} MAL IDs on AnimeThemes")
                updateState { copy(status = "Looking up ${malIdToKitsuId.size} MAL IDs…") }

                val malResult = animeRepository.fetchAnimeByExternalIds(
                    "MyAnimeList", malIdToKitsuId.keys.toList()
                )

                malResult.animeMappings.forEach { (malId, animeThemesId) ->
                    val kitsuId = malIdToKitsuId[malId] ?: return@forEach
                    val idx = finalAnimeEntities.indexOfFirst { it.kitsuId == kitsuId }
                    if (idx >= 0) {
                        val updated = finalAnimeEntities[idx].copy(animeThemesId = animeThemesId)
                        finalAnimeEntities[idx] = updated
                        animeDao.upsertAll(listOf(updated))
                        Log.d(TAG_FALLBACK, "MAL matched: kitsuId=$kitsuId -> animeThemesId=$animeThemesId")
                    }
                }

                val malThemes = malResult.themes.map { it.toEntity() }
                if (malThemes.isNotEmpty()) {
                    themeDao.upsertAll(malThemes)
                    allThemeEntities.addAll(malThemes)
                }
            }

            checkPause()

            // Step 3: Title search for still-unmapped anime
            unmappedAnime = finalAnimeEntities.filter { it.animeThemesId == null }
            Log.d(TAG_FALLBACK, "${unmappedAnime.size} still unmapped, starting title search")

            updateState { copy(fallbackTotal = unmappedAnime.size, fallbackCurrent = 0) }

            unmappedAnime.forEachIndexed { index, anime ->
                checkPause()

                val entry = entriesById[anime.kitsuId]
                val titleVariants = (listOfNotNull(
                    anime.titleRomaji,
                    anime.titleEn,
                    anime.title,
                    anime.titleJa
                ) + (entry?.abbreviatedTitles ?: emptyList())
                ).filter { it.isNotBlank() }.distinct()

                if (titleVariants.isEmpty()) {
                    Log.w(TAG_FALLBACK, "Skipping kitsuId=${anime.kitsuId} — no titles")
                    stillUnmatched.add("Unknown (kitsuId=${anime.kitsuId})")
                    updateState { copy(fallbackCurrent = index + 1) }
                    return@forEachIndexed
                }

                val displayName = anime.title ?: titleVariants.first()
                updateState {
                    copy(
                        status = "Searching: $displayName (${index + 1}/${unmappedAnime.size})",
                        fallbackCurrent = index + 1
                    )
                }

                val result = animeRepository.fallbackSearchByTitle(titleVariants)

                if (result.animeThemesId != null && result.themes.isNotEmpty()) {
                    Log.d(TAG_FALLBACK, "Title matched \"$displayName\" -> animeThemesId=${result.animeThemesId}")
                    val updatedAnime = anime.copy(animeThemesId = result.animeThemesId)
                    animeDao.upsertAll(listOf(updatedAnime))
                    val newThemes = result.themes.map { it.toEntity() }
                    themeDao.upsertAll(newThemes)
                    allThemeEntities.addAll(newThemes)

                    val idx = finalAnimeEntities.indexOfFirst { it.kitsuId == anime.kitsuId }
                    if (idx >= 0) finalAnimeEntities[idx] = updatedAnime
                } else {
                    Log.w(TAG_FALLBACK, "Nothing found for \"$displayName\" (tried: $titleVariants)")
                    stillUnmatched.add(displayName)
                }

                if (index < unmappedAnime.size - 1) delay(1000)
            }

            if (stillUnmatched.isNotEmpty()) {
                Log.w(TAG_FALLBACK, "${stillUnmatched.size} still unmatched: $stillUnmatched")
            }
        }

        checkPause()

        // --- Fill missing artwork ---
        val missingArtwork = finalAnimeEntities.filter { anime ->
            anime.title.isNullOrBlank() || anime.thumbnailUrl.isNullOrBlank() || anime.coverUrl.isNullOrBlank()
        }
        if (missingArtwork.isNotEmpty()) {
            val details = userRepository.getAnimeDetails(missingArtwork.map { it.kitsuId })
            if (details.isNotEmpty()) {
                val detailsById = details.associateBy { it.id }
                val updated = finalAnimeEntities.map { anime ->
                    val detail = detailsById[anime.kitsuId] ?: return@map anime
                    anime.copy(
                        title = anime.title ?: detail.title,
                        titleEn = anime.titleEn ?: detail.titleEn,
                        titleRomaji = anime.titleRomaji ?: detail.titleRomaji,
                        titleJa = anime.titleJa ?: detail.titleJa,
                        thumbnailUrl = anime.thumbnailUrl ?: detail.posterUrl,
                        coverUrl = anime.coverUrl ?: detail.coverUrl
                    )
                }
                animeDao.upsertAll(updated)
            }
        }

        val mappedCount = finalAnimeEntities.count { it.animeThemesId != null }
        Log.d(TAG, "Sync: ${animeEntities.size} anime, $mappedCount mapped, ${allThemeEntities.size} themes")

        updateKitsuPlaylist()

        tokenStore.saveLastSyncedAt(now)
        val label = if (isFirstSync) "Imported" else "Added"
        updateState {
            copy(
                status = "$label ${animeEntities.size} anime, ${allThemeEntities.size} themes",
                phase = SyncPhase.Done,
                isRunning = false,
                lastSyncCount = animeEntities.size,
                lastThemeCount = allThemeEntities.size,
                unmatchedAnime = stillUnmatched
            )
        }
    }

    private suspend fun updateKitsuPlaylist() {
        try {
            val allThemes = themeDao.getAllThemes()
            if (allThemes.isEmpty()) return

            val existingPlaylistId = playlistDao.findPlaylistByName(KITSU_PLAYLIST_NAME)
            val playlistId = if (existingPlaylistId != null) {
                playlistDao.deletePlaylistEntries(existingPlaylistId)
                existingPlaylistId
            } else {
                playlistDao.insertPlaylist(
                    PlaylistEntity(name = KITSU_PLAYLIST_NAME, createdAt = System.currentTimeMillis())
                )
            }

            val playlistEntries = allThemes.mapIndexed { index, theme ->
                PlaylistEntryEntity(
                    playlistId = playlistId,
                    themeId = theme.id,
                    orderIndex = index
                )
            }
            playlistDao.insertEntries(playlistEntries)
            Log.d(TAG, "Updated '$KITSU_PLAYLIST_NAME' playlist with ${playlistEntries.size} tracks")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update Kitsu playlist", e)
        }
    }

    private inline fun updateState(transform: SyncState.() -> SyncState) {
        _state.value = _state.value.transform()
    }

    private fun AnimeThemeEntry.toEntity(): ThemeEntity {
        val themeId = themeId.toLongOrNull() ?: abs(themeId.hashCode()).toLong()
        val animeId = animeId.toLongOrNull()
        return ThemeEntity(
            id = themeId,
            animeId = animeId,
            title = title,
            artistName = artist,
            audioUrl = audioUrl,
            videoUrl = videoUrl,
            isDownloaded = false,
            localFilePath = null,
            themeType = themeType
        )
    }
}

data class SyncState(
    val phase: SyncPhase = SyncPhase.Idle,
    val status: String = "",
    val isRunning: Boolean = false,
    val isPaused: Boolean = false,
    val errorMessage: String? = null,
    val libraryProgress: LibrarySyncProgress? = null,
    val themeProgress: ThemeMappingProgress? = null,
    val fallbackCurrent: Int = 0,
    val fallbackTotal: Int = 0,
    val lastSyncCount: Int = 0,
    val lastThemeCount: Int = 0,
    val unmatchedAnime: List<String> = emptyList()
)

enum class SyncPhase {
    Idle,
    SyncingLibrary,
    MappingThemes,
    FallbackSearch,
    Saving,
    Done,
    Error
}

private fun LibrarySyncProgress.statusText(): String {
    return buildString {
        append("Syncing Kitsu library")
        append(" · page ")
        append(page)
        totalPages?.let { append("/$it") }
        totalCount?.let { append(" · $fetchedCount / $it") }
    }
}

private fun ThemeMappingProgress.statusText(): String {
    return "Mapping AnimeThemes · batch $batchIndex/$totalBatches · $themesCount themes"
}
