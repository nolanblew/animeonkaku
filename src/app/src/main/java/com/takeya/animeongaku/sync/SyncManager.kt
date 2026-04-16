package com.takeya.animeongaku.sync

import android.util.Log
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeGenreCrossRef
import com.takeya.animeongaku.data.local.ArtistDao
import com.takeya.animeongaku.data.local.GenreDao
import com.takeya.animeongaku.data.local.GenreEntity
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
    private val autoPlaylistManager: AutoPlaylistManager,
    private val genreDao: GenreDao,
    private val dynamicPlaylistManager: DynamicPlaylistManager
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

        // Self-heal: clear any duplicate animeThemesId mappings left by previous syncs
        val dupsCleaned = animeDao.clearDuplicateAnimeThemesIds()
        if (dupsCleaned > 0) {
            Log.w(TAG, "Cleared $dupsCleaned duplicate animeThemesId mappings from DB")
        }

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

        // Even when no new anime were found, statuses may have changed on
        // existing anime (e.g. current → completed).  Run a lightweight
        // status update and refresh auto-playlists so query-driven playlists
        // like "Currently Watching" stay accurate.
        if (!isFirstSync) {
            updateState { copy(status = "Checking for status changes…") }
            val lastStatusSync = tokenStore.getLastStatusSyncAt()
            val recentlyChanged = userRepository.getLibraryEntriesUpdatedSince(userId, lastStatusSync)
            if (recentlyChanged.isNotEmpty()) {
                var statusUpdated = 0
                recentlyChanged.forEach { entry ->
                    val existing = animeDao.getByKitsuId(entry.id)
                    if (existing != null && existing.watchingStatus != entry.watchingStatus) {
                        animeDao.upsertAll(listOf(existing.copy(watchingStatus = entry.watchingStatus)))
                        statusUpdated++
                    }
                }
                if (statusUpdated > 0) {
                    Log.d(TAG, "Updated $statusUpdated watching statuses during sync")
                }
            }
            tokenStore.saveLastStatusSyncAt(System.currentTimeMillis())
        }

        if (entries.isEmpty() && !isFirstSync) {
            autoPlaylistManager.refreshAutoPlaylistsSuspend()
            dynamicPlaylistManager.refreshAllAutoSuspend()
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
            // Preserve existing animeThemesId and isManuallyAdded if this anime is already in DB,
            // unless we are doing a force full sync, in which case we wipe the animeThemesId to force re-mapping
            val existing = animeDao.getByKitsuId(entry.id)
            AnimeEntity(
                kitsuId = entry.id,
                animeThemesId = if (forceFullSync) null else existing?.animeThemesId,
                title = entry.title ?: existing?.title,
                titleEn = entry.titleEn ?: existing?.titleEn,
                titleRomaji = entry.titleRomaji ?: existing?.titleRomaji,
                titleJa = entry.titleJa ?: existing?.titleJa,
                thumbnailUrl = entry.posterUrl ?: existing?.thumbnailUrl,
                thumbnailUrlLarge = entry.posterUrlLarge ?: existing?.thumbnailUrlLarge,
                coverUrl = entry.coverUrl ?: existing?.coverUrl,
                coverUrlLarge = entry.coverUrlLarge ?: existing?.coverUrlLarge,
                syncedAt = now,
                isManuallyAdded = existing?.isManuallyAdded ?: false,
                watchingStatus = entry.watchingStatus ?: existing?.watchingStatus,
                subtype = entry.subtype ?: existing?.subtype,
                startDate = entry.startDate ?: existing?.startDate,
                endDate = entry.endDate ?: existing?.endDate,
                episodeCount = entry.episodeCount ?: existing?.episodeCount,
                ageRating = entry.ageRating ?: existing?.ageRating,
                averageRating = entry.averageRating ?: existing?.averageRating,
                userRating = entry.userRating ?: existing?.userRating,
                libraryUpdatedAt = entry.libraryUpdatedAt ?: existing?.libraryUpdatedAt,
                slug = entry.slug ?: existing?.slug
            )
        }
        animeDao.upsertAll(animeEntities)

        // Fetch and persist genre cross-refs in background
        try {
            val kitsuIds = entries.map { it.id }
            val categoryData = userRepository.getAnimeCategoryData(kitsuIds)
            if (categoryData.isNotEmpty()) {
                val genres = categoryData.values.flatten().distinctBy { it.slug }.map { g ->
                    GenreEntity(slug = g.slug, displayName = g.displayName, source = g.source)
                }
                genreDao.upsertGenres(genres)
                val crossRefs = categoryData.flatMap { (kitsuId, genres) ->
                    genres.map { g -> AnimeGenreCrossRef(kitsuId = kitsuId, slug = g.slug) }
                }
                genreDao.upsertCrossRefs(crossRefs)
                Log.d(TAG, "Persisted ${genres.size} genres and ${crossRefs.size} cross-refs")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch/persist genre data", e)
        }

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
        // Preserve download state for existing themes
        val incomingThemeIds = syncResult.themes.mapNotNull { it.themeId.toLongOrNull() }
        val existingThemes = if (incomingThemeIds.isNotEmpty()) {
            themeDao.getByIds(incomingThemeIds).associateBy { it.id }
        } else emptyMap()

        val themeEntities = syncResult.themes.map { entry ->
            val existing = entry.themeId.toLongOrNull()?.let { existingThemes[it] }
            entry.toEntity(
                existingIsDownloaded = existing?.isDownloaded ?: false,
                existingLocalFilePath = existing?.localFilePath
            )
        }
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
        // Track animeThemesIds already confirmed by Kitsu ID match to prevent
        // fallback steps from assigning the same ID to a different anime
        val claimedAnimeThemesIds = mappedAnimeEntities
            .mapNotNull { it.animeThemesId }
            .toMutableSet()

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
                    // Guard: skip if this animeThemesId is already claimed by another anime
                    if (animeThemesId in claimedAnimeThemesIds) {
                        Log.w(TAG_FALLBACK, "MAL skip: animeThemesId=$animeThemesId already claimed, not assigning to kitsuId=$kitsuId")
                        return@forEach
                    }
                    val idx = finalAnimeEntities.indexOfFirst { it.kitsuId == kitsuId }
                    if (idx >= 0) {
                        val updated = finalAnimeEntities[idx].copy(animeThemesId = animeThemesId)
                        finalAnimeEntities[idx] = updated
                        claimedAnimeThemesIds.add(animeThemesId)
                        animeDao.upsertAll(listOf(updated))
                        Log.d(TAG_FALLBACK, "MAL matched: kitsuId=$kitsuId -> animeThemesId=$animeThemesId")
                    }
                }

                val malIncomingIds = malResult.themes.mapNotNull { it.themeId.toLongOrNull() }
                val malExisting = if (malIncomingIds.isNotEmpty()) themeDao.getByIds(malIncomingIds).associateBy { it.id } else emptyMap()
                val malThemes = malResult.themes.map { entry ->
                    val ex = entry.themeId.toLongOrNull()?.let { malExisting[it] }
                    entry.toEntity(ex?.isDownloaded ?: false, ex?.localFilePath)
                }
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

                val result = animeRepository.fallbackSearchByTitle(
                    titleVariants, anime.kitsuId, claimedAnimeThemesIds
                )

                if (result.animeThemesId != null && result.themes.isNotEmpty()) {
                    // Final guard: double-check the ID isn't claimed (belt-and-suspenders)
                    if (result.animeThemesId in claimedAnimeThemesIds) {
                        Log.w(TAG_FALLBACK, "Title search returned already-claimed animeThemesId=${result.animeThemesId} for \"$displayName\", skipping")
                        stillUnmatched.add(displayName)
                        updateState { copy(fallbackCurrent = index + 1) }
                        return@forEachIndexed
                    }
                    Log.d(TAG_FALLBACK, "Title matched \"$displayName\" -> animeThemesId=${result.animeThemesId}")
                    val updatedAnime = anime.copy(animeThemesId = result.animeThemesId)
                    claimedAnimeThemesIds.add(result.animeThemesId)
                    animeDao.upsertAll(listOf(updatedAnime))
                    val fbIncomingIds = result.themes.mapNotNull { it.themeId.toLongOrNull() }
                    val fbExisting = if (fbIncomingIds.isNotEmpty()) themeDao.getByIds(fbIncomingIds).associateBy { it.id } else emptyMap()
                    val newThemes = result.themes.map { entry ->
                        val ex = entry.themeId.toLongOrNull()?.let { fbExisting[it] }
                        entry.toEntity(ex?.isDownloaded ?: false, ex?.localFilePath)
                    }
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

        // --- Final deduplication safety check ---
        // If any animeThemesId is shared by multiple anime (should never happen with
        // the guards above, but belt-and-suspenders), null out the duplicates.
        val idCounts = finalAnimeEntities
            .mapNotNull { it.animeThemesId }
            .groupingBy { it }
            .eachCount()
        val duplicateIds = idCounts.filter { it.value > 1 }.keys
        if (duplicateIds.isNotEmpty()) {
            Log.w(TAG, "DEDUP: Found ${duplicateIds.size} duplicate animeThemesIds: $duplicateIds")
            // For each duplicate, keep only the anime whose title best matches the AnimeThemes entry.
            // Since we can't easily re-query here, keep the first one and null the rest.
            val seen = mutableSetOf<Long>()
            val deduped = finalAnimeEntities.map { anime ->
                val atId = anime.animeThemesId
                if (atId != null && atId in duplicateIds) {
                    if (seen.add(atId)) {
                        anime // first occurrence: keep
                    } else {
                        Log.w(TAG, "DEDUP: Clearing animeThemesId=$atId from kitsuId=${anime.kitsuId} (\"${anime.title}\")")
                        anime.copy(animeThemesId = null) // duplicate: clear
                    }
                } else anime
            }
            finalAnimeEntities = deduped.toMutableList()
            animeDao.upsertAll(finalAnimeEntities)
        }

        // --- Artist reconciliation ---
        // Ensure every saved theme has the necessary ThemeArtistCrossRef entries
        // Some APIs/endpoints (like fallback title search or delta sync) might not 
        // provide full artist list in AnimeThemeEntry, but they might have artistName string.
        val crossRefsToReconcile = mutableListOf<ThemeArtistCrossRef>()
        val existingThemeEntitiesForReconciliation = themeDao.getByIds(allThemeEntities.map { it.id }).associateBy { it.id }
        
        for (theme in allThemeEntities) {
            val names = theme.artistName?.split(",")?.map { it.substringBefore(" (as").trim() }?.filter { it.isNotBlank() }
            if (!names.isNullOrEmpty()) {
                for (name in names) {
                    crossRefsToReconcile.add(
                        ThemeArtistCrossRef(
                            themeId = theme.id,
                            artistName = name
                        )
                    )
                }
            }
        }
        
        if (crossRefsToReconcile.isNotEmpty()) {
            artistDao.upsertCrossRefs(crossRefsToReconcile)
            Log.d(TAG, "Reconciled ${crossRefsToReconcile.size} artist cross-refs")
        }

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
                        thumbnailUrlLarge = anime.thumbnailUrlLarge ?: detail.posterUrlLarge,
                        coverUrl = anime.coverUrl ?: detail.coverUrl,
                        coverUrlLarge = anime.coverUrlLarge ?: detail.coverUrlLarge
                    )
                }
                animeDao.upsertAll(updated)
            }
        }

        val mappedCount = finalAnimeEntities.count { it.animeThemesId != null }
        Log.d(TAG, "Sync: ${animeEntities.size} anime, $mappedCount mapped, ${allThemeEntities.size} themes")

        updateKitsuPlaylist()
        autoPlaylistManager.refreshAutoPlaylistsSuspend()
        dynamicPlaylistManager.refreshAllAutoSuspend()

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

    private fun AnimeThemeEntry.toEntity(
        existingIsDownloaded: Boolean = false,
        existingLocalFilePath: String? = null
    ): ThemeEntity {
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
            isDownloaded = existingIsDownloaded,
            localFilePath = existingLocalFilePath,
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
