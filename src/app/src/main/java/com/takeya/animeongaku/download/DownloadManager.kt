package com.takeya.animeongaku.download

import android.content.Context
import android.net.Uri
import android.util.Log
import android.widget.Toast
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.DownloadGroupEntity
import com.takeya.animeongaku.data.local.DownloadGroupThemeEntity
import com.takeya.animeongaku.data.local.DownloadRequestEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.network.NetworkType as AppNetworkType
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Themes present in a downloaded playlist that are not yet tracked for download.
 * Pure so the "what changed" decision can be unit-tested independently of Room/WorkManager.
 */
internal fun newPlaylistDownloadThemeIds(
    playlistThemeIds: List<Long>,
    trackedThemeIds: Set<Long>
): List<Long> = playlistThemeIds.distinct().filter { it !in trackedThemeIds }

@Singleton
class DownloadManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val downloadDao: DownloadDao,
    private val themeDao: ThemeDao,
    private val animeDao: AnimeDao,
    private val playlistDao: PlaylistDao,
    private val downloadPreferences: DownloadPreferences,
    private val connectivityMonitor: ConnectivityMonitor
) {
    companion object {
        private const val TAG = "DownloadManager"
        private const val WORK_TAG_DOWNLOAD = "download"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val workManager = WorkManager.getInstance(context)
    private val playlistSyncStarted = AtomicBoolean(false)

    init {
        startPlaylistDownloadSync()
    }

    // --- Automatic playlist download sync ---

    /**
     * Keep downloaded playlists in sync with their contents: whenever a playlist that
     * is marked for download gains tracks (manual edits, server pull, or an auto-playlist
     * refresh such as "Currently Watching"), the new tracks are enqueued automatically.
     * Downloads still respect the Wi-Fi-only preference via [enqueueDownload]. Idempotent
     * and safe to call repeatedly; only the first call starts the collector.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun startPlaylistDownloadSync() {
        if (!playlistSyncStarted.compareAndSet(false, true)) return
        scope.launch {
            downloadDao.observeAllGroups()
                .map { groups -> groups.filter { it.groupType == DownloadGroupEntity.TYPE_PLAYLIST } }
                .distinctUntilChanged()
                .flatMapLatest { playlistGroups ->
                    if (playlistGroups.isEmpty()) {
                        flowOf(emptyList<Pair<DownloadGroupEntity, List<PlaylistTrack>>>())
                    } else {
                        combine(
                            playlistGroups.map { group ->
                                val playlistId = group.groupId.toLongOrNull() ?: -1L
                                playlistDao.observePlaylistTracks(playlistId)
                                    .map { tracks -> group to tracks }
                            }
                        ) { it.toList() }
                    }
                }
                .collect { snapshots ->
                    for ((group, tracks) in snapshots) {
                        try {
                            reconcilePlaylistGroupDownloads(group, tracks)
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to auto-download playlist '${group.label}'", e)
                        }
                    }
                }
        }
    }

    private suspend fun reconcilePlaylistGroupDownloads(
        group: DownloadGroupEntity,
        tracks: List<PlaylistTrack>
    ) {
        val tracked = downloadDao.getThemeIdsInGroup(group.id).toSet()
        val newThemeIds = newPlaylistDownloadThemeIds(tracks.map { it.theme.id }, tracked)
        if (newThemeIds.isEmpty()) return

        val newTracks = tracks.filter { it.theme.id in newThemeIds.toSet() }
            .distinctBy { it.theme.id }

        // Track the new themes under this group so later refreshes see them as already handled.
        downloadDao.insertGroupThemes(newTracks.map { DownloadGroupThemeEntity(group.id, it.theme.id) })

        // Pre-insert request rows then kick the single batch worker (it resolves cover art per track).
        prepareDownloads(newTracks.map { it.theme })
        triggerBatchWorker()
        Log.d(TAG, "Auto-queued ${newTracks.size} new track(s) for downloaded playlist '${group.label}'")
    }

    // --- Public observation APIs ---

    fun observeAllDownloads(): Flow<List<DownloadRequestEntity>> =
        downloadDao.observeAllDownloads()

    fun observeDownloadForTheme(themeId: Long): Flow<DownloadRequestEntity?> =
        downloadDao.observeDownloadForTheme(themeId)

    fun observeIsThemeDownloaded(themeId: Long): Flow<Boolean> =
        downloadDao.observeDownloadForTheme(themeId).map {
            it?.status == DownloadRequestEntity.STATUS_COMPLETED
        }

    fun observeAllGroups(): Flow<List<DownloadGroupEntity>> =
        downloadDao.observeAllGroups()

    fun observeTotalDownloadSize(): Flow<Long> =
        downloadDao.observeTotalDownloadSize()

    fun observeActiveCount(): Flow<Int> =
        downloadDao.observeActiveCount()

    fun observeCompletedCount(): Flow<Int> =
        downloadDao.observeCompletedCount()

    fun observeDownloadedThemes(): Flow<List<ThemeEntity>> =
        downloadDao.observeDownloadedThemes()

    fun observeAnimeIdsWithDownloads(): Flow<List<Long>> =
        downloadDao.observeAnimeIdsWithDownloads()

    fun observeArtistNamesWithDownloads(): Flow<List<String>> =
        downloadDao.observeArtistNamesWithDownloads()

    fun observePlaylistIdsWithDownloads(): Flow<List<Long>> =
        downloadDao.observePlaylistIdsWithDownloads()

    fun observeDownloadedThemeIdsForAnime(animeThemesId: Long): Flow<List<Long>> =
        downloadDao.observeDownloadedThemeIdsForAnime(animeThemesId)

    fun observeDownloadedThemeIdsForPlaylist(playlistId: Long): Flow<List<Long>> =
        downloadDao.observeDownloadedThemeIdsForPlaylist(playlistId)

    // --- Download actions ---

    fun downloadSong(theme: ThemeEntity, anime: AnimeEntity? = null) {
        scope.launch {
            // Create or find single group
            var group = downloadDao.findGroup(DownloadGroupEntity.TYPE_SINGLE, theme.id.toString())
            if (group == null) {
                val groupId = downloadDao.insertGroup(
                    DownloadGroupEntity(
                        groupType = DownloadGroupEntity.TYPE_SINGLE,
                        groupId = theme.id.toString(),
                        label = theme.title
                    )
                )
                group = downloadDao.findGroup(DownloadGroupEntity.TYPE_SINGLE, theme.id.toString())
                if (group != null) {
                    downloadDao.insertGroupTheme(DownloadGroupThemeEntity(group.id, theme.id))
                }
            }

            prepareDownloads(listOf(theme))
            triggerBatchWorker()
        }
    }

    fun downloadAnime(kitsuId: String) {
        scope.launch {
            val anime = animeDao.getByKitsuId(kitsuId)
            val animeThemesId = anime?.animeThemesId ?: return@launch
            val themes = themeDao.getByIds(
                themeDao.getThemeIdsByAnimeIds(listOf(animeThemesId))
            )
            if (themes.isEmpty()) return@launch

            val label = anime.title ?: anime.titleEn ?: "Anime"

            // Create anime group
            var group = downloadDao.findGroup(DownloadGroupEntity.TYPE_ANIME, kitsuId)
            if (group == null) {
                val groupId = downloadDao.insertGroup(
                    DownloadGroupEntity(
                        groupType = DownloadGroupEntity.TYPE_ANIME,
                        groupId = kitsuId,
                        label = label
                    )
                )
                group = DownloadGroupEntity(id = groupId, groupType = DownloadGroupEntity.TYPE_ANIME, groupId = kitsuId, label = label)
            }

            // Add all themes to group
            val groupThemes = themes.map { DownloadGroupThemeEntity(group.id, it.id) }
            downloadDao.insertGroupThemes(groupThemes)

            // Pre-insert all download requests so the total count is immediately known,
            // then kick the single batch worker that drains them.
            prepareDownloads(themes)
            triggerBatchWorker()
        }
    }

    fun downloadPlaylist(playlistId: Long, visibleThemeIds: List<Long>? = null) {
        scope.launch {
            val themeIds = visibleThemeIds ?: playlistDao.getThemeIdsInPlaylist(playlistId)
            if (themeIds.isEmpty()) return@launch

            val themes = themeDao.getByIds(themeIds)
            if (themes.isEmpty()) return@launch

            val playlistName = playlistDao.getPlaylistById(playlistId)?.name ?: "Playlist"

            // Create playlist group
            var group = downloadDao.findGroup(DownloadGroupEntity.TYPE_PLAYLIST, playlistId.toString())
            if (group == null) {
                val groupId = downloadDao.insertGroup(
                    DownloadGroupEntity(
                        groupType = DownloadGroupEntity.TYPE_PLAYLIST,
                        groupId = playlistId.toString(),
                        label = playlistName
                    )
                )
                group = DownloadGroupEntity(id = groupId, groupType = DownloadGroupEntity.TYPE_PLAYLIST, groupId = playlistId.toString(), label = playlistName)
            }

            // Add all themes to group
            val groupThemes = themes.map { DownloadGroupThemeEntity(group.id, it.id) }
            downloadDao.insertGroupThemes(groupThemes)

            // Pre-insert all download requests so the total count is immediately known,
            // then kick the single batch worker that drains them (it resolves cover art per track).
            prepareDownloads(themes)
            triggerBatchWorker()
        }
    }

    // --- Remove actions ---

    fun removeDownload(themeId: Long) {
        scope.launch {
            // Remove from single groups
            val singleGroup = downloadDao.findGroup(DownloadGroupEntity.TYPE_SINGLE, themeId.toString())
            if (singleGroup != null) {
                downloadDao.deleteGroupThemes(singleGroup.id)
                downloadDao.deleteGroup(singleGroup.id)
            }

            cleanupOrphanedTheme(themeId)
        }
    }

    fun removeAnimeDownload(kitsuId: String) {
        scope.launch {
            val group = downloadDao.findGroup(DownloadGroupEntity.TYPE_ANIME, kitsuId)
                ?: return@launch

            val themeIds = downloadDao.getThemeIdsInGroup(group.id)
            downloadDao.deleteGroupThemes(group.id)
            downloadDao.deleteGroup(group.id)

            for (id in themeIds) {
                cleanupOrphanedTheme(id)
            }
        }
    }

    fun removePlaylistDownload(playlistId: Long) {
        scope.launch {
            val group = downloadDao.findGroup(DownloadGroupEntity.TYPE_PLAYLIST, playlistId.toString())
                ?: return@launch

            val themeIds = downloadDao.getThemeIdsInGroup(group.id)
            downloadDao.deleteGroupThemes(group.id)
            downloadDao.deleteGroup(group.id)

            for (id in themeIds) {
                cleanupOrphanedTheme(id)
            }
        }
    }

    fun removeAllDownloads() {
        scope.launch {
            // Cancel all work
            workManager.cancelAllWorkByTag(WORK_TAG_DOWNLOAD)

            // Get all downloads to delete files
            val downloads = downloadDao.getDownloadsByStatuses(listOf(
                DownloadRequestEntity.STATUS_COMPLETED,
                DownloadRequestEntity.STATUS_DOWNLOADING,
                DownloadRequestEntity.STATUS_RETRYING,
                DownloadRequestEntity.STATUS_PENDING,
                DownloadRequestEntity.STATUS_PAUSED,
                DownloadRequestEntity.STATUS_FAILED,
                DownloadRequestEntity.STATUS_WAITING_FOR_WIFI
            ))

            for (dl in downloads) {
                deleteFiles(dl)
                resetThemeEntity(dl.themeId)
            }

            downloadDao.deleteAllGroupThemes()
            downloadDao.deleteAllGroups()
            downloadDao.deleteAllDownloads()

            Log.d(TAG, "All downloads removed")
        }
    }

    // --- Pause / Resume / Cancel ---

    fun pauseAllDownloads() {
        scope.launch {
            workManager.cancelAllWorkByTag(WORK_TAG_DOWNLOAD)
            downloadDao.pauseAllActive()
            Log.d(TAG, "All downloads paused")
        }
    }

    fun resumeAllDownloads() {
        scope.launch {
            val paused = downloadDao.getDownloadsByStatuses(
                listOf(DownloadRequestEntity.STATUS_PAUSED)
            )
            for (dl in paused) {
                downloadDao.updateStatus(dl.themeId, DownloadRequestEntity.STATUS_PENDING)
            }
            if (paused.isNotEmpty()) triggerBatchWorker()
            Log.d(TAG, "Resumed ${paused.size} downloads")
        }
    }

    fun cancelAllDownloads() {
        scope.launch {
            workManager.cancelAllWorkByTag(WORK_TAG_DOWNLOAD)

            val active = downloadDao.getDownloadsByStatuses(listOf(
                DownloadRequestEntity.STATUS_PENDING,
                DownloadRequestEntity.STATUS_DOWNLOADING,
                DownloadRequestEntity.STATUS_RETRYING,
                DownloadRequestEntity.STATUS_PAUSED,
                DownloadRequestEntity.STATUS_WAITING_FOR_WIFI
            ))

            for (dl in active) {
                deleteFiles(dl)
                resetThemeEntity(dl.themeId)
            }

            // Remove non-completed downloads and their group memberships
            for (dl in active) {
                val groupIds = downloadDao.getGroupIdsForTheme(dl.themeId)
                for (gId in groupIds) {
                    downloadDao.deleteGroupTheme(gId, dl.themeId)
                    // If group is now empty, remove it
                    val remaining = downloadDao.getThemeIdsInGroup(gId)
                    if (remaining.isEmpty()) {
                        downloadDao.deleteGroup(gId)
                    }
                }
                downloadDao.deleteDownload(dl.themeId)
            }

            Log.d(TAG, "Cancelled ${active.size} downloads")
        }
    }

    // --- Retry ---

    fun retryFailedDownloads() {
        scope.launch {
            val failed = downloadDao.getPendingAndFailedDownloads()
            if (failed.isEmpty()) return@launch

            Log.d(TAG, "Retrying ${failed.size} failed/pending downloads")
            for (dl in failed) {
                downloadDao.updateStatus(dl.themeId, DownloadRequestEntity.STATUS_PENDING)
            }
            triggerBatchWorker()
        }
    }

    // --- Helpers ---

    /**
     * Pre-insert download request rows for all themes so the total count
     * is immediately known in the UI and notification before work is enqueued.
     */
    private suspend fun prepareDownloads(themes: List<ThemeEntity>) {
        val isWifiOnly = downloadPreferences.wifiOnly
        val currentNetwork = connectivityMonitor.networkType.value
        val initialStatus = if (isWifiOnly && currentNetwork != AppNetworkType.WIFI) {
            DownloadRequestEntity.STATUS_WAITING_FOR_WIFI
        } else {
            DownloadRequestEntity.STATUS_PENDING
        }

        for (theme in themes) {
            val existing = downloadDao.getDownloadForTheme(theme.id)
            if (existing?.status == DownloadRequestEntity.STATUS_COMPLETED) continue
            if (existing?.status == DownloadRequestEntity.STATUS_DOWNLOADING) continue
            if (existing?.status == DownloadRequestEntity.STATUS_RETRYING) continue
            downloadDao.insertDownloadIfNotExists(
                DownloadRequestEntity(themeId = theme.id, status = initialStatus)
            )
            if (existing != null) {
                downloadDao.updateStatus(theme.id, initialStatus)
            }
        }
    }

    /**
     * Ensure the single batch [DownloadWorker] is scheduled. One unique foreground worker drains
     * every pending request, so adding tracks while it runs is picked up by its next DB poll and
     * does not spin up additional foreground services (which previously raced and crashed the app).
     * [ExistingWorkPolicy.KEEP] avoids piling up workers; a finished worker is replaced by a fresh
     * drain pass.
     */
    private suspend fun triggerBatchWorker() {
        val isWifiOnly = downloadPreferences.wifiOnly
        val currentNetwork = connectivityMonitor.networkType.value

        // Surface the Wi-Fi-only deferral once per kick rather than per track.
        if (isWifiOnly && currentNetwork != AppNetworkType.WIFI) {
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "Will download when on Wi-Fi", Toast.LENGTH_SHORT).show()
            }
        }

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(
                if (isWifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
            )
            .build()

        val workRequest = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(WORK_TAG_DOWNLOAD)
            .build()

        workManager.enqueueUniqueWork(
            DownloadWorker.UNIQUE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            workRequest
        )
    }

    private suspend fun cleanupOrphanedTheme(themeId: Long) {
        val remainingGroups = downloadDao.countGroupsForTheme(themeId)
        if (remainingGroups == 0) {
            // No groups reference this theme — delete the download. The running batch worker
            // re-checks the DB before each track and skips rows that have been removed.
            val dl = downloadDao.getDownloadForTheme(themeId) ?: return
            deleteFiles(dl)
            resetThemeEntity(themeId)
            downloadDao.deleteDownload(themeId)
            Log.d(TAG, "Cleaned up orphaned download for theme $themeId")
        }
    }

    private fun deleteFiles(download: DownloadRequestEntity) {
        download.filePath?.let { path ->
            val file = File(path)
            if (file.exists()) file.delete()
        }
        download.imagePath?.let { path ->
            val file = File(path)
            if (file.exists()) file.delete()
        }
    }

    private suspend fun resetThemeEntity(themeId: Long) {
        val theme = themeDao.getByIds(listOf(themeId)).firstOrNull() ?: return
        if (theme.isDownloaded) {
            themeDao.upsertAll(listOf(theme.copy(isDownloaded = false, localFilePath = null)))
        }
    }

}
