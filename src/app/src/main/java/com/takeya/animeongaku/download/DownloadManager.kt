package com.takeya.animeongaku.download

import android.content.Context
import android.net.Uri
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
import com.takeya.animeongaku.data.local.DownloadGroupItemEntity
import com.takeya.animeongaku.data.local.DownloadGroupItemRow
import com.takeya.animeongaku.data.local.DownloadItemDao
import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.MusicCatalogDao
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.network.NetworkType as AppNetworkType
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal fun newPlaylistDownloadThemeIds(
    playlistThemeIds: List<Long>,
    trackedThemeIds: Set<Long>
): List<Long> = playlistThemeIds.distinct().filter { it !in trackedThemeIds }

internal fun shouldDeletePhysicalDownload(remainingGroupCount: Int, forcePhysicalRemoval: Boolean): Boolean =
    forcePhysicalRemoval || remainingGroupCount == 0

internal fun downloadInitialStatus(wifiOnly: Boolean, networkIsWifi: Boolean): String =
    if (wifiOnly && !networkIsWifi) DownloadItemEntity.STATUS_WAITING_FOR_WIFI else DownloadItemEntity.STATUS_PENDING

internal fun resumedDownloadStatus(status: String): String =
    if (status == DownloadItemEntity.STATUS_PAUSED) DownloadItemEntity.STATUS_PENDING else status

@OptIn(ExperimentalCoroutinesApi::class)
@Singleton
class DownloadManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val downloadDao: DownloadDao,
    private val downloadItemDao: DownloadItemDao,
    private val themeDao: ThemeDao,
    private val themeModeDao: ThemeModeDao,
    private val musicCatalogDao: MusicCatalogDao,
    private val animeDao: AnimeDao,
    private val playlistDao: PlaylistDao,
    private val downloadPreferences: DownloadPreferences,
    private val connectivityMonitor: ConnectivityMonitor
) {
    companion object {
        private const val WORK_TAG_DOWNLOAD = "download"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val workManager = WorkManager.getInstance(context)
    private val groupIdentityMutex = Mutex()

    init {
        scope.launch {
            downloadDao.observeAllGroups()
                .map { groups -> groups.filter { it.groupType == DownloadGroupEntity.TYPE_PLAYLIST } }
                .distinctUntilChanged()
                .flatMapLatest { groups ->
                    if (groups.isEmpty()) flowOf(emptyList()) else combine(groups.map { group ->
                        playlistDao.observePlaylistEntries(group.groupId.toLongOrNull() ?: -1L).map { group }
                    }) { it.toList() }
                }
                .collect { groups ->
                    groups.forEach { group -> group.groupId.toLongOrNull()?.let(::downloadPlaylist) }
                }
        }
    }

    fun observeAllDownloads(): Flow<List<DownloadItemEntity>> = downloadItemDao.observeAll()
    fun observeGroupedDownloads(): Flow<List<DownloadGroupItemRow>> = downloadItemDao.observeGroupedItems()
    fun observeDownloadForTheme(themeId: Long): Flow<DownloadItemEntity?> =
        downloadItemDao.observe(DownloadItemEntity.tvSizeMediaKey(themeId))
    fun observeIsThemeDownloaded(themeId: Long): Flow<Boolean> = observeDownloadForTheme(themeId).map {
        it?.status == DownloadItemEntity.STATUS_COMPLETED && it.filePath?.let(::File)?.isFile == true
    }
    fun observeAllGroups(): Flow<List<DownloadGroupEntity>> = downloadDao.observeAllGroups()
    fun observeTotalDownloadSize(): Flow<Long> = downloadItemDao.observeTotalSize()
    fun observeActiveCount(): Flow<Int> = downloadItemDao.observeActiveCount()
    fun observeCompletedCount(): Flow<Int> = downloadItemDao.observeCompletedCount()
    fun observeDownloadedThemes(): Flow<List<ThemeEntity>> =
        downloadItemDao.observeCompletedThemeIds().flatMapLatest { ids ->
            if (ids.isEmpty()) flowOf(emptyList()) else themeDao.observeByIds(ids)
        }
    fun observeAnimeIdsWithDownloads(): Flow<List<Long>> = downloadItemDao.observeAnimeIdsWithDownloads()
    fun observeArtistNamesWithDownloads(): Flow<List<String>> = downloadItemDao.observeArtistNamesWithDownloads()
    fun observePlaylistIdsWithDownloads(): Flow<List<Long>> = downloadItemDao.observePlaylistIdsWithDownloads()
    fun observeDownloadedThemeIdsForAnime(animeThemesId: Long): Flow<List<Long>> =
        observeDownloadedThemes().map { themes -> themes.filter { it.animeId == animeThemesId }.map { it.id } }
    fun observeDownloadedThemeIdsForPlaylist(playlistId: Long): Flow<List<Long>> =
        downloadItemDao.observeGroupedItems().map { rows ->
            rows.filter { it.groupType == DownloadGroupEntity.TYPE_PLAYLIST && it.externalGroupId == playlistId.toString() }
                .mapNotNull { it.item.legacyThemeId }.distinct()
        }

    /** Existing Download buttons retain their TV Size meaning. */
    fun downloadSong(theme: ThemeEntity, anime: AnimeEntity? = null) {
        scope.launch {
            val group = ensureGroup(DownloadGroupEntity.TYPE_SINGLE, theme.id.toString(), theme.title)
            enqueue(listOf(DownloadMediaSpec.themeTv(theme.id, theme.audioUrl)), group)
        }
    }

    fun downloadThemeFullSize(theme: ThemeEntity, anime: AnimeEntity? = null) {
        scope.launch {
            val descriptor = themeModeDao.getByThemeIds(listOf(theme.id)).firstOrNull() ?: return@launch
            val canonicalSongUrl = descriptor.fullSizeSongId
                ?.let { songId -> musicCatalogDao.getSong(songId)?.audioUrl }
            val media = resolveThemeFullSizeDownload(descriptor, canonicalSongUrl) ?: return@launch
            val label = listOfNotNull(anime?.title, theme.title).joinToString(" · ")
            val group = if (anime?.kitsuId != null) {
                ensureGroup(DownloadGroupEntity.TYPE_ANIME, anime.kitsuId, anime.title ?: theme.title)
            } else {
                ensureGroup(DownloadGroupEntity.TYPE_SINGLE, "theme:${theme.id}:full", "$label · Full Size")
            }
            enqueue(listOf(media), group)
        }
    }

    fun downloadRelatedSong(song: SongEntity, release: MusicReleaseEntity? = null) {
        scope.launch {
            val group = if (release == null) {
                ensureGroup(DownloadGroupEntity.TYPE_SINGLE, "song:${song.id}", song.title)
            } else {
                ensureGroup(DownloadGroupEntity.TYPE_ALBUM, release.id.toString(), release.title)
            }
            enqueue(listOf(DownloadMediaSpec.song(song.id, song.audioUrl)), group)
        }
    }

    fun downloadAlbum(release: MusicReleaseEntity, songs: List<SongEntity>) {
        scope.launch {
            val group = ensureGroup(DownloadGroupEntity.TYPE_ALBUM, release.id.toString(), release.title)
            enqueue(songs.map { DownloadMediaSpec.song(it.id, it.audioUrl) }, group)
        }
    }

    fun downloadAnime(kitsuId: String) {
        scope.launch {
            val anime = animeDao.getByKitsuId(kitsuId) ?: return@launch
            val animeThemesId = anime.animeThemesId ?: return@launch
            val themes = themeDao.getByIds(themeDao.getThemeIdsByAnimeIds(listOf(animeThemesId)))
            val group = ensureGroup(
                DownloadGroupEntity.TYPE_ANIME,
                kitsuId,
                anime.title ?: anime.titleEn ?: "Anime"
            )
            enqueue(themes.map { DownloadMediaSpec.themeTv(it.id, it.audioUrl) }, group)
        }
    }

    fun downloadPlaylist(playlistId: Long, visibleThemeIds: List<Long>? = null) {
        scope.launch {
            val playlist = playlistDao.getPlaylistById(playlistId) ?: return@launch
            val entries = playlistDao.getPlaylistEntries(playlistId).let { all ->
                if (visibleThemeIds == null) all else all.filter {
                    it.itemType != "THEME" || it.itemId in visibleThemeIds
                }
            }
            val themeIds = entries.filter { it.itemType == "THEME" }.map { it.itemId }.distinct()
            val songIds = buildSet {
                addAll(entries.filter { it.itemType == "SONG" }.map { it.itemId })
                themeModeDao.getByThemeIds(themeIds).mapNotNullTo(this) { it.fullSizeSongId }
            }
            val modes = themeModeDao.getByThemeIds(themeIds).associateBy { it.themeId }
            val songUrls = musicCatalogDao.getSongs(songIds.toList()).associate { it.id to it.audioUrl }
            val specs = resolvePlaylistDownloadMedia(entries, playlist.defaultMode, modes, songUrls)
            val group = ensureGroup(DownloadGroupEntity.TYPE_PLAYLIST, playlistId.toString(), playlist.name)
            replaceGroupMembership(group, specs)
            prepare(specs)
            if (specs.isNotEmpty()) triggerBatchWorker()
        }
    }

    fun removeDownload(themeId: Long) = removeGroupByIdentity(DownloadGroupEntity.TYPE_SINGLE, themeId.toString())
    fun removeAnimeDownload(kitsuId: String) = removeGroupByIdentity(DownloadGroupEntity.TYPE_ANIME, kitsuId)
    fun removePlaylistDownload(playlistId: Long) = removeGroupByIdentity(DownloadGroupEntity.TYPE_PLAYLIST, playlistId.toString())
    fun removeAlbumDownload(releaseId: Long) = removeGroupByIdentity(DownloadGroupEntity.TYPE_ALBUM, releaseId.toString())
    fun removeGroup(group: DownloadGroupEntity) = removeGroupByIdentity(group.groupType, group.groupId)

    fun removeGroupItem(groupId: Long, mediaKey: String) {
        scope.launch {
            downloadItemDao.deleteGroupItem(groupId, mediaKey)
            cleanupIfOrphaned(mediaKey)
            if (downloadItemDao.getMediaKeysInGroup(groupId).isEmpty()) downloadDao.deleteGroup(groupId)
        }
    }

    /** Explicit physical removal ignores group references and removes every membership. */
    fun removePhysicalDownload(mediaKey: String) {
        scope.launch { deletePhysical(mediaKey, force = true) }
    }

    fun removeAllDownloads() {
        scope.launch {
            awaitDownloadCancellation()
            val items = downloadItemDao.getAll()
            items.forEach { deleteFiles(it) }
            canonicalDownloadRoots().forEach { it.takeIf(File::exists)?.deleteRecursively() }
            downloadItemDao.deleteAllGroupItems()
            downloadDao.deleteAllGroups()
            downloadItemDao.deleteAll()
            items.filter { it.itemType == DownloadMediaSpec.TYPE_THEME }.map { it.itemId }.distinct().forEach { resetLegacyTv(it) }
        }
    }

    fun pauseAllDownloads() {
        scope.launch {
            workManager.cancelAllWorkByTag(WORK_TAG_DOWNLOAD)
            downloadItemDao.pauseAllActive()
        }
    }

    fun resumeAllDownloads() {
        scope.launch {
            val paused = downloadItemDao.getByStatuses(listOf(DownloadItemEntity.STATUS_PAUSED))
            paused.forEach { downloadItemDao.updateStatus(it.mediaKey, resumedDownloadStatus(it.status)) }
            if (paused.isNotEmpty()) triggerBatchWorker()
        }
    }

    fun cancelAllDownloads() {
        scope.launch {
            awaitDownloadCancellation()
            val active = downloadItemDao.getByStatuses(listOf(
                DownloadItemEntity.STATUS_PENDING, DownloadItemEntity.STATUS_DOWNLOADING,
                DownloadItemEntity.STATUS_RETRYING, DownloadItemEntity.STATUS_PAUSED,
                DownloadItemEntity.STATUS_WAITING_FOR_WIFI
            ))
            active.forEach { deletePhysical(it.mediaKey, force = true) }
        }
    }

    fun retryFailedDownloads() {
        scope.launch {
            val retry = downloadItemDao.getByStatuses(listOf(
                DownloadItemEntity.STATUS_FAILED, DownloadItemEntity.STATUS_RETRYING,
                DownloadItemEntity.STATUS_WAITING_FOR_WIFI
            ))
            retry.forEach { downloadItemDao.updateStatus(it.mediaKey, initialStatus()) }
            if (retry.isNotEmpty()) triggerBatchWorker()
        }
    }

    private suspend fun enqueue(specs: List<DownloadMediaSpec>, group: DownloadGroupEntity) {
        downloadItemDao.insertGroupItems(specs.distinctBy { it.mediaKey }.map { DownloadGroupItemEntity(group.id, it.mediaKey) })
        prepare(specs)
        if (specs.isNotEmpty()) triggerBatchWorker()
    }

    private suspend fun replaceGroupMembership(group: DownloadGroupEntity, specs: List<DownloadMediaSpec>) {
        val oldKeys = downloadItemDao.getMediaKeysInGroup(group.id)
        downloadItemDao.deleteGroupItems(group.id)
        downloadItemDao.insertGroupItems(specs.map { DownloadGroupItemEntity(group.id, it.mediaKey) })
        oldKeys.filter { old -> specs.none { it.mediaKey == old } }.forEach { cleanupIfOrphaned(it) }
    }

    private suspend fun prepare(specs: List<DownloadMediaSpec>) {
        val status = initialStatus()
        specs.distinctBy { it.mediaKey }.forEach { spec ->
            val existing = downloadItemDao.get(spec.mediaKey)
            val existingFileReady = existing?.status == DownloadItemEntity.STATUS_COMPLETED &&
                existing.filePath?.let(::File)?.isFile == true
            if (existingFileReady || existing?.status in setOf(
                    DownloadItemEntity.STATUS_PENDING, DownloadItemEntity.STATUS_DOWNLOADING,
                    DownloadItemEntity.STATUS_RETRYING, DownloadItemEntity.STATUS_PAUSED,
                    DownloadItemEntity.STATUS_WAITING_FOR_WIFI
                )) return@forEach
            val replacement =
                DownloadItemEntity(
                    mediaKey = spec.mediaKey,
                    itemType = spec.itemType,
                    itemId = spec.itemId,
                    mode = spec.mode,
                    status = status,
                    progress = 0,
                    filePath = null,
                    imagePath = existing?.imagePath,
                    createdAt = existing?.createdAt ?: System.currentTimeMillis(),
                    updatedAt = System.currentTimeMillis(),
                    legacyThemeId = spec.legacyThemeId
                )
            if (existing == null) downloadItemDao.insertIfAbsent(replacement) else downloadItemDao.upsert(replacement)
        }
    }

    private fun initialStatus(): String = downloadInitialStatus(
        wifiOnly = downloadPreferences.wifiOnly,
        networkIsWifi = connectivityMonitor.networkType.value == AppNetworkType.WIFI
    )

    private suspend fun ensureGroup(type: String, externalId: String, label: String): DownloadGroupEntity =
        groupIdentityMutex.withLock {
            downloadDao.findGroup(type, externalId)?.let { return@withLock it }
            val id = downloadDao.insertGroup(DownloadGroupEntity(groupType = type, groupId = externalId, label = label))
            downloadDao.findGroup(type, externalId) ?: DownloadGroupEntity(id, type, externalId, label)
        }

    private fun removeGroupByIdentity(type: String, externalId: String) {
        scope.launch {
            val groups = downloadDao.findGroups(type, externalId)
            if (groups.isEmpty()) return@launch
            val keys = groups.flatMap { downloadItemDao.getMediaKeysInGroup(it.id) }.distinct()
            groups.forEach { group ->
                downloadItemDao.deleteGroupItems(group.id)
                downloadDao.deleteGroup(group.id)
            }
            keys.forEach { cleanupIfOrphaned(it) }
        }
    }

    private suspend fun cleanupIfOrphaned(mediaKey: String) = deletePhysical(mediaKey, force = false)

    private suspend fun deletePhysical(mediaKey: String, force: Boolean) {
        val remaining = downloadItemDao.countGroupsForMedia(mediaKey)
        if (!shouldDeletePhysicalDownload(remaining, force)) return
        val item = downloadItemDao.get(mediaKey) ?: return
        val wasActive = item.status in setOf(
            DownloadItemEntity.STATUS_PENDING,
            DownloadItemEntity.STATUS_DOWNLOADING,
            DownloadItemEntity.STATUS_RETRYING,
            DownloadItemEntity.STATUS_WAITING_FOR_WIFI
        )
        if (wasActive) {
            awaitDownloadCancellation()
            downloadItemDao.getByStatuses(listOf(DownloadItemEntity.STATUS_DOWNLOADING))
                .filterNot { it.mediaKey == mediaKey }
                .forEach { downloadItemDao.updateStatus(it.mediaKey, DownloadItemEntity.STATUS_PENDING) }
        }
        val refreshedItem = downloadItemDao.get(mediaKey) ?: item
        if (force) downloadItemDao.getGroupIdsForMedia(mediaKey).forEach { downloadItemDao.deleteGroupItem(it, mediaKey) }
        deleteFiles(refreshedItem)
        canonicalDownloadItemDirectory(context.filesDir, refreshedItem.itemType, refreshedItem.itemId)
            ?.takeIf(File::exists)
            ?.deleteRecursively()
        if (item.itemType == DownloadMediaSpec.TYPE_THEME) resetLegacyTv(item.itemId)
        downloadItemDao.delete(mediaKey)
        if (wasActive && downloadItemDao.getActiveCount() > 0) triggerBatchWorker()
    }

    private fun deleteFiles(item: DownloadItemEntity) {
        item.filePath?.let(::File)?.takeIf(File::exists)?.delete()
        item.imagePath?.let(::File)?.takeIf(File::exists)?.delete()
    }

    private suspend fun awaitDownloadCancellation() = withContext(Dispatchers.IO) {
        workManager.cancelUniqueWork(DownloadWorker.UNIQUE_WORK_NAME).result.get()
        workManager.cancelAllWorkByTag(WORK_TAG_DOWNLOAD).result.get()
    }

    private fun canonicalDownloadRoots(): List<File> = listOf(
        File(context.filesDir, "downloads/themes"),
        File(context.filesDir, "downloads/songs"),
        File(context.filesDir, "downloads/images")
    )

    private suspend fun resetLegacyTv(themeId: Long) {
        val theme = themeDao.getByIds(listOf(themeId)).firstOrNull() ?: return
        if (theme.isDownloaded || theme.localFilePath != null) {
            themeDao.upsertAll(listOf(theme.copy(isDownloaded = false, localFilePath = null)))
        }
    }

    private suspend fun triggerBatchWorker() {
        if (downloadPreferences.wifiOnly && connectivityMonitor.networkType.value != AppNetworkType.WIFI) {
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "Will download when on Wi-Fi", Toast.LENGTH_SHORT).show()
            }
        }
        val constraints = Constraints.Builder().setRequiredNetworkType(
            if (downloadPreferences.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
        ).build()
        val work = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(WORK_TAG_DOWNLOAD)
            .build()
        workManager.enqueueUniqueWork(DownloadWorker.UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, work)
    }

    fun openDownloadsFolder() {
        val intent = android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
            putExtra("android.provider.extra.INITIAL_URI", Uri.fromFile(File(context.filesDir, "downloads")))
        }
        context.startActivity(intent)
    }
}
