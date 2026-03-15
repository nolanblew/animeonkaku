package com.takeya.animeongaku.sync

import android.util.Log
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ArtistDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
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
    private val artistDao: ArtistDao,
    private val playlistDao: PlaylistDao,
    private val tokenStore: KitsuTokenStore,
    private val autoPlaylistManager: AutoPlaylistManager
) {
    companion object {
        private const val TAG = "SyncManager"
        private const val TAG_FALLBACK = "AnimeThemesFallback"
        private const val KITSU_PLAYLIST_NAME = "Kitsu Library"
        private const val DONE_DISPLAY_MS = 5_000L
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
        // Reset any stale state from a previous sync before starting
        _state.value = SyncState()
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
            delay(DONE_DISPLAY_MS)
            _state.value = SyncState()
            return
        }

        checkPause()

        // --- Stale anime cleanup on full re-sync ---
        var removedCount = 0
        if (forceFullSync) {
            removedCount = cleanupStaleAnime(entries)
        }

        val now = System.currentTimeMillis()
        val entriesById = entries.associateBy { it.id }
        val animeEntities = entries.map { entry ->
            // Preserve existing animeThemesId and isManuallyAdded if this anime is already in DB
            val existing = animeDao.getByKitsuId(entry.id)
            AnimeEntity(
                kitsuId = entry.id,
                animeThemesId = existing?.animeThemesId,
                title = entry.title ?: existing?.title,
                titleEn = entry.titleEn ?: existing?.titleEn,
                titleRomaji = entry.titleRomaji ?: existing?.titleRomaji,
                titleJa = entry.titleJa ?: existing?.titleJa,
                thumbnailUrl = entry.posterUrl ?: existing?.thumbnailUrl,
                coverUrl = entry.coverUrl ?: existing?.coverUrl,
                syncedAt = now,
                isManuallyAdded = existing?.isManuallyAdded ?: false
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
        val artistCrossRefs = syncResult.themes.flatMap { it.toCrossRefs() }
        val mappedAnimeEntities = animeEntities.map { anime ->
            val mappedId = syncResult.animeMappings[anime.kitsuId]
            if (mappedId != null) anime.copy(animeThemesId = mappedId) else anime
        }

        updateState { copy(phase = SyncPhase.Saving, status = "Saving…") }
        animeDao.upsertAll(mappedAnimeEntities)
        themeDao.upsertAll(themeEntities)
        if (artistCrossRefs.isNotEmpty()) {
            artistDao.upsertCrossRefs(artistCrossRefs)
        }

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
                val malCrossRefs = malResult.themes.flatMap { it.toCrossRefs() }
                if (malThemes.isNotEmpty()) {
                    themeDao.upsertAll(malThemes)
                    allThemeEntities.addAll(malThemes)
                    if (malCrossRefs.isNotEmpty()) artistDao.upsertCrossRefs(malCrossRefs)
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
                    val newCrossRefs = result.themes.flatMap { it.toCrossRefs() }
                    themeDao.upsertAll(newThemes)
                    if (newCrossRefs.isNotEmpty()) artistDao.upsertCrossRefs(newCrossRefs)
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
        autoPlaylistManager.refreshAutoPlaylists()

        tokenStore.saveLastSyncedAt(now)
        val label = if (isFirstSync) "Imported" else "Added"
        val removedSuffix = if (removedCount > 0) ", removed $removedCount" else ""
        updateState {
            copy(
                status = "$label ${animeEntities.size} anime, ${allThemeEntities.size} themes$removedSuffix",
                phase = SyncPhase.Done,
                isRunning = false,
                lastSyncCount = animeEntities.size,
                lastThemeCount = allThemeEntities.size,
                unmatchedAnime = stillUnmatched
            )
        }
        // Auto-reset to Idle after a delay so UI clears on next visit
        delay(DONE_DISPLAY_MS)
        _state.value = SyncState()
    }

    private suspend fun cleanupStaleAnime(freshEntries: List<KitsuAnimeEntry>): Int {
        val freshKitsuIds = freshEntries.map { it.id }.toSet()
        val allDbKitsuIds = animeDao.getAllKitsuIds().toSet()
        val staleKitsuIds = allDbKitsuIds - freshKitsuIds
        if (staleKitsuIds.isEmpty()) return 0

        // Protect anime that were manually added or exist in user playlists
        val inUserPlaylists = animeDao.getKitsuIdsInUserPlaylists().toSet()
        val toDelete = staleKitsuIds.filter { kitsuId ->
            val entity = animeDao.getByKitsuId(kitsuId)
            val isManual = entity?.isManuallyAdded == true
            val inPlaylist = kitsuId in inUserPlaylists
            if (isManual || inPlaylist) {
                Log.d(TAG, "Protecting stale anime kitsuId=$kitsuId (manual=$isManual, inPlaylist=$inPlaylist)")
            }
            !isManual && !inPlaylist
        }

        if (toDelete.isEmpty()) return 0

        Log.d(TAG, "Removing ${toDelete.size} stale anime no longer on Kitsu")
        updateState { copy(status = "Removing ${toDelete.size} stale anime…") }

        // Cascade delete: get animeThemesIds -> themeIds -> delete cross-refs -> delete themes -> delete anime
        // Process in batches to avoid SQLite variable limit
        toDelete.chunked(100).forEach { batch ->
            val animeThemesIds = animeDao.getAnimeThemesIdsByKitsuIds(batch)
            if (animeThemesIds.isNotEmpty()) {
                val themeIds = themeDao.getThemeIdsByAnimeIds(animeThemesIds)
                if (themeIds.isNotEmpty()) {
                    artistDao.deleteCrossRefsForThemes(themeIds)
                }
                themeDao.deleteByAnimeIds(animeThemesIds)
            }
            animeDao.deleteByKitsuIds(batch)
        }

        return toDelete.size
    }

    private suspend fun updateKitsuPlaylist() {
        try {
            val allThemes = themeDao.getAllThemes()
            if (allThemes.isEmpty()) return

            val existingPlaylistId = playlistDao.findPlaylistByName(KITSU_PLAYLIST_NAME)
            val playlistId = if (existingPlaylistId != null) {
                playlistDao.deletePlaylistEntries(existingPlaylistId)
                playlistDao.markPlaylistAsAuto(existingPlaylistId)
                existingPlaylistId
            } else {
                playlistDao.insertPlaylist(
                    PlaylistEntity(
                        name = KITSU_PLAYLIST_NAME,
                        createdAt = System.currentTimeMillis(),
                        isAuto = true,
                        gradientSeed = kotlin.random.Random.nextInt()
                    )
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
        // Build display artist string from structured data if available
        val displayArtist = if (artists.isNotEmpty()) {
            artists.joinToString(", ") { credit ->
                if (credit.asCharacter != null) {
                    "${credit.name} (as ${credit.asCharacter})"
                } else {
                    credit.name
                }
            }
        } else {
            artist
        }
        return ThemeEntity(
            id = themeId,
            animeId = animeId,
            title = title,
            artistName = displayArtist,
            audioUrl = audioUrl,
            videoUrl = videoUrl,
            isDownloaded = false,
            localFilePath = null,
            themeType = themeType
        )
    }

    private fun AnimeThemeEntry.toCrossRefs(): List<ThemeArtistCrossRef> {
        val themeIdLong = themeId.toLongOrNull() ?: abs(themeId.hashCode()).toLong()
        return artists.map { credit ->
            ThemeArtistCrossRef(
                themeId = themeIdLong,
                artistName = credit.name,
                asCharacter = credit.asCharacter,
                alias = credit.alias
            )
        }
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
