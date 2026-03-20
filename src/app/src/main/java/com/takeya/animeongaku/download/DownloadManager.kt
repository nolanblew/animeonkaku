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
import androidx.work.workDataOf
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.DownloadGroupEntity
import com.takeya.animeongaku.data.local.DownloadGroupThemeEntity
import com.takeya.animeongaku.data.local.DownloadRequestEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.network.NetworkType as AppNetworkType
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

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
        private const val BATCH_DELAY_MS = 500L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val workManager = WorkManager.getInstance(context)

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
            val imageUrl = anime?.primaryArtworkUrl()

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

            enqueueDownload(theme, imageUrl)
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
            val imageUrl = anime.primaryArtworkUrl()

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

            // Enqueue each theme with rate limiting
            for ((i, theme) in themes.withIndex()) {
                enqueueDownload(theme, imageUrl)
                if (i < themes.lastIndex) delay(BATCH_DELAY_MS)
            }
        }
    }

    fun downloadPlaylist(playlistId: Long) {
        scope.launch {
            val themeIds = playlistDao.getThemeIdsInPlaylist(playlistId)
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

            // Enqueue each theme, resolving cover art per anime
            val animeIds = themes.mapNotNull { it.animeId }.distinct()
            val animeMap = if (animeIds.isNotEmpty()) {
                animeDao.getByAnimeThemesIds(animeIds).associateBy { it.animeThemesId }
            } else emptyMap()

            for ((i, theme) in themes.withIndex()) {
                val anime = theme.animeId?.let { animeMap[it] }
                val imageUrl = anime?.primaryArtworkUrl()
                enqueueDownload(theme, imageUrl)
                if (i < themes.lastIndex) delay(BATCH_DELAY_MS)
            }
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
                val theme = themeDao.getByIds(listOf(dl.themeId)).firstOrNull() ?: continue
                enqueueDownload(theme, null)
            }
            Log.d(TAG, "Resumed ${paused.size} downloads")
        }
    }

    fun cancelAllDownloads() {
        scope.launch {
            workManager.cancelAllWorkByTag(WORK_TAG_DOWNLOAD)

            val active = downloadDao.getDownloadsByStatuses(listOf(
                DownloadRequestEntity.STATUS_PENDING,
                DownloadRequestEntity.STATUS_DOWNLOADING,
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
                val theme = themeDao.getByIds(listOf(dl.themeId)).firstOrNull() ?: continue
                enqueueDownload(theme, null)
            }
        }
    }

    // --- Helpers ---

    private suspend fun enqueueDownload(theme: ThemeEntity, imageUrl: String?) {
        // Check if already completed
        val existing = downloadDao.getDownloadForTheme(theme.id)
        if (existing?.status == DownloadRequestEntity.STATUS_COMPLETED) {
            Log.d(TAG, "Theme ${theme.id} already downloaded, skipping")
            return
        }
        if (existing?.status == DownloadRequestEntity.STATUS_DOWNLOADING) {
            Log.d(TAG, "Theme ${theme.id} already downloading, skipping")
            return
        }

        val isWifiOnly = downloadPreferences.wifiOnly
        val currentNetwork = connectivityMonitor.networkType.value

        // Determine initial status
        val initialStatus = if (isWifiOnly && currentNetwork != AppNetworkType.WIFI) {
            DownloadRequestEntity.STATUS_WAITING_FOR_WIFI
        } else {
            DownloadRequestEntity.STATUS_PENDING
        }

        // Show toast if waiting for wifi
        if (initialStatus == DownloadRequestEntity.STATUS_WAITING_FOR_WIFI) {
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "Will download when on Wi-Fi", Toast.LENGTH_SHORT).show()
            }
        }

        // Insert or update download request
        downloadDao.insertDownloadIfNotExists(
            DownloadRequestEntity(
                themeId = theme.id,
                status = initialStatus
            )
        )
        // If it already existed but was failed/paused, update status
        if (existing != null) {
            downloadDao.updateStatus(theme.id, initialStatus)
        }

        // Build constraints
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(
                if (isWifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
            )
            .build()

        val workRequest = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setInputData(
                workDataOf(
                    DownloadWorker.KEY_THEME_ID to theme.id,
                    DownloadWorker.KEY_AUDIO_URL to theme.audioUrl,
                    DownloadWorker.KEY_IMAGE_URL to (imageUrl ?: "")
                )
            )
            .setConstraints(constraints)
            .addTag(WORK_TAG_DOWNLOAD)
            .addTag("download_${theme.id}")
            .build()

        workManager.enqueueUniqueWork(
            "download_${theme.id}",
            ExistingWorkPolicy.KEEP,
            workRequest
        )

        // Store workManager ID
        downloadDao.updateDownload(
            (downloadDao.getDownloadForTheme(theme.id) ?: return).copy(
                workManagerId = workRequest.id.toString()
            )
        )
    }

    private suspend fun cleanupOrphanedTheme(themeId: Long) {
        val remainingGroups = downloadDao.countGroupsForTheme(themeId)
        if (remainingGroups == 0) {
            // No groups reference this theme — delete the download
            workManager.cancelUniqueWork("download_$themeId")
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
