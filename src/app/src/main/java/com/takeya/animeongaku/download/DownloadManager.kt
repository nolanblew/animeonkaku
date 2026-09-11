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
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.local.UserPreferenceEntity
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
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal fun newPlaylistDownloadThemeIds(
    playlistThemeIds: List<Long>,
    trackedThemeIds: Set<Long>
): List<Long> = playlistThemeIds.distinct().filter { it !in trackedThemeIds }

private data class PlaylistDownloadRevision(
    val playlistId: Long,
    val defaultMode: String,
    val overrideUserPreference: Boolean,
    val entries: List<PlaylistEntryEntity>
)

internal fun playlistDownloadRefreshes(
    group: DownloadGroupEntity,
    playlist: Flow<PlaylistEntity?>,
    entries: Flow<List<PlaylistEntryEntity>>
): Flow<Long> = combine(playlist, entries) { currentPlaylist, currentEntries ->
    currentPlaylist?.let {
        PlaylistDownloadRevision(it.id, it.defaultMode, it.overrideUserPreference, currentEntries)
    }
}
    .filterNotNull()
    .distinctUntilChanged()
    .map { revision -> group.groupId.toLongOrNull() ?: revision.playlistId }

internal fun shouldDeletePhysicalDownload(remainingGroupCount: Int, forcePhysicalRemoval: Boolean): Boolean =
    forcePhysicalRemoval || remainingGroupCount == 0

internal fun downloadInitialStatus(wifiOnly: Boolean, networkIsWifi: Boolean): String =
    if (wifiOnly && !networkIsWifi) DownloadItemEntity.STATUS_WAITING_FOR_WIFI else DownloadItemEntity.STATUS_PENDING

internal fun resumedDownloadStatus(status: String): String =
    if (status == DownloadItemEntity.STATUS_PAUSED) DownloadItemEntity.STATUS_PENDING else status

private data class ThemeDownloadDirective(
    val disliked: Boolean,
    val preferredMode: String?,
    val tvSizeDisliked: Boolean,
    val fullSizeDisliked: Boolean
)

private fun UserPreferenceEntity.toDownloadDirective() = ThemeDownloadDirective(
    disliked = isDisliked,
    preferredMode = preferredMode,
    tvSizeDisliked = isDislikedTvSize,
    fullSizeDisliked = isDislikedFullSize
)

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
    private val userPreferenceDao: UserPreferenceDao,
    private val downloadPreferences: DownloadPreferences,
    private val connectivityMonitor: ConnectivityMonitor
) {
    companion object {
        private const val WORK_TAG_DOWNLOAD = "download"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val workManager = WorkManager.getInstance(context)
    private val groupIdentityMutex = Mutex()
    private val groupMutationMutex = Mutex()

    init {
        scope.launch {
            downloadDao.observeAllGroups()
                .map { groups -> groups.filter { it.groupType == DownloadGroupEntity.TYPE_PLAYLIST } }
                .distinctUntilChanged()
                .flatMapLatest { groups ->
                    if (groups.isEmpty()) flowOf(emptyList()) else combine(groups.map { group ->
                        val playlistId = group.groupId.toLongOrNull() ?: -1L
                        playlistDownloadRefreshes(
                            group,
                            playlistDao.observePlaylist(playlistId),
                            playlistDao.observePlaylistEntries(playlistId)
                        ).map { group }
                    }) { it.toList() }
                }
                .collect { groups ->
                    groups.forEach { group ->
                        group.groupId.toLongOrNull()?.let { downloadPlaylistInternal(it) }
                    }
                }
        }
        scope.launch {
            var previous: Map<Long, Pair<ThemeDownloadDirective, ThemeModeEntity?>>? = null
            userPreferenceDao.observeAllPreferences()
                .flatMapLatest { preferences ->
                    val modes = if (preferences.isEmpty()) flowOf(emptyList())
                        else themeModeDao.observeByThemeIds(preferences.map { it.themeId })
                    modes.map { descriptors ->
                        val byId = descriptors.associateBy { it.themeId }
                        preferences.associate { it.themeId to (it.toDownloadDirective() to byId[it.themeId]) }
                    }
                }
                .distinctUntilChanged()
                .collect { current ->
                    val changedThemeIds = previous?.let { before ->
                        (before.keys + current.keys).filter { before[it] != current[it] }
                    } ?: current.keys
                    previous = current
                    changedThemeIds.forEach { reconcileTrackedThemeDownload(it) }
                }
        }
    }

    fun observeAllDownloads(): Flow<List<DownloadItemEntity>> = downloadItemDao.observeAll()
    fun observeGroupedDownloads(): Flow<List<DownloadGroupItemRow>> = downloadItemDao.observeGroupedItems()
    fun observeDownloadForTheme(themeId: Long): Flow<DownloadItemEntity?> =
        downloadItemDao.observeForTheme(themeId).map(List<DownloadItemEntity>::firstOrNull)
    fun observeIsThemeDownloaded(themeId: Long): Flow<Boolean> = downloadItemDao.observeForTheme(themeId).map { items ->
        items.any { item ->
            item.status == DownloadItemEntity.STATUS_COMPLETED &&
                item.filePath?.let(::File)?.isFile == true
        }
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
        downloadItemDao.observeCompletedThemeIdsForPlaylist(playlistId)

    /** Theme downloads follow the persisted per-theme preference, with TV Size as the default. */
    fun downloadSong(theme: ThemeEntity, anime: AnimeEntity? = null) {
        scope.launch {
            val media = resolvePreferredThemeDownload(theme) ?: return@launch
            val label = listOfNotNull(anime?.title, theme.title).joinToString(" · ")
            val group = ensureGroup(DownloadGroupEntity.TYPE_SINGLE, theme.id.toString(), label)
            replaceAndPrepare(group, listOf(media))
        }
    }

    fun downloadRelatedSong(song: SongEntity, release: MusicReleaseEntity? = null) {
        scope.launch {
            val group = if (release == null) {
                ensureGroup(DownloadGroupEntity.TYPE_SINGLE, "song:${song.id}", song.title)
            } else {
                ensureGroup(DownloadGroupEntity.TYPE_ALBUM, release.id.toString(), release.title)
            }
            enqueue(listOf(DownloadMediaSpec.song(song.id, song.audioUrl, song.loudness)), group)
        }
    }

    fun downloadAlbum(release: MusicReleaseEntity, songs: List<SongEntity>) {
        scope.launch {
            val group = ensureGroup(DownloadGroupEntity.TYPE_ALBUM, release.id.toString(), release.title)
            enqueue(songs.map { DownloadMediaSpec.song(it.id, it.audioUrl, it.loudness) }, group)
        }
    }

    fun downloadAnime(kitsuId: String) {
        scope.launch { downloadAnimeInternal(kitsuId) }
    }

    fun downloadPlaylist(playlistId: Long, visibleThemeIds: List<Long>? = null) {
        scope.launch { downloadPlaylistInternal(playlistId, visibleThemeIds) }
    }

    fun removeDownload(themeId: Long) {
        removeGroupsByIdentity(
            DownloadGroupEntity.TYPE_SINGLE,
            setOf(themeId.toString(), "theme:$themeId:full")
        )
    }
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
        groupMutationMutex.withLock {
            downloadItemDao.insertGroupItems(
                specs.distinctBy { it.mediaKey }.map { DownloadGroupItemEntity(group.id, it.mediaKey) }
            )
            prepare(specs)
        }
        if (specs.isNotEmpty()) triggerBatchWorker()
    }

    private suspend fun replaceAndPrepare(group: DownloadGroupEntity, specs: List<DownloadMediaSpec>) {
        val uniqueSpecs = specs.distinctBy(DownloadMediaSpec::mediaKey)
        groupMutationMutex.withLock {
            val oldKeys = downloadItemDao.getMediaKeysInGroup(group.id)
            downloadItemDao.deleteGroupItems(group.id)
            downloadItemDao.insertGroupItems(uniqueSpecs.map { DownloadGroupItemEntity(group.id, it.mediaKey) })
            oldKeys.filterNot { old -> uniqueSpecs.any { it.mediaKey == old } }.forEach { cleanupIfOrphaned(it) }
            prepare(uniqueSpecs)
        }
        if (uniqueSpecs.isNotEmpty()) triggerBatchWorker()
    }

    private suspend fun resolvePreferredThemeDownload(
        theme: ThemeEntity,
        fallbackMode: String = "TV_SIZE"
    ): DownloadMediaSpec? {
        val descriptor = themeModeDao.getByThemeIds(listOf(theme.id)).firstOrNull()
        val canonicalSong = descriptor?.fullSizeSongId?.let { songId -> musicCatalogDao.getSong(songId) }
        return resolveThemeDownloadMedia(
            themeId = theme.id,
            fallbackTvUrl = theme.audioUrl,
            descriptor = descriptor,
            canonicalSongUrl = canonicalSong?.audioUrl,
            canonicalSongLoudness = canonicalSong?.loudness,
            preference = userPreferenceDao.getPreference(theme.id),
            fallbackMode = fallbackMode
        )
    }

    private suspend fun downloadAnimeInternal(kitsuId: String) {
        val anime = animeDao.getByKitsuId(kitsuId) ?: return
        val animeThemesId = anime.animeThemesId ?: return
        val themes = themeDao.getByIds(themeDao.getThemeIdsByAnimeIds(listOf(animeThemesId)))
        val themeIds = themes.map(ThemeEntity::id)
        val modes = themeModeDao.getByThemeIds(themeIds).associateBy { it.themeId }
        val preferences = activePreferences(themeIds)
        val songs = musicCatalogDao.getSongs(modes.values.mapNotNull { it.fullSizeSongId }.distinct())
            .associateBy(SongEntity::id)
        val specs = themes.mapNotNull { theme ->
            val descriptor = modes[theme.id]
            val canonicalSong = descriptor?.fullSizeSongId?.let(songs::get)
            resolveThemeDownloadMedia(
                themeId = theme.id,
                fallbackTvUrl = theme.audioUrl,
                descriptor = descriptor,
                canonicalSongUrl = canonicalSong?.audioUrl,
                canonicalSongLoudness = canonicalSong?.loudness,
                preference = preferences[theme.id]
            )
        }
        val group = ensureGroup(
            DownloadGroupEntity.TYPE_ANIME,
            kitsuId,
            anime.title ?: anime.titleEn ?: "Anime"
        )
        replaceAndPrepare(group, specs)
    }

    private suspend fun downloadPlaylistInternal(playlistId: Long, visibleThemeIds: List<Long>? = null) {
        val playlist = playlistDao.getPlaylistById(playlistId) ?: return
        val entries = playlistDao.getPlaylistEntries(playlistId).let { all ->
            if (visibleThemeIds == null) all else all.filter {
                it.itemType != "THEME" || it.itemId in visibleThemeIds
            }
        }
        val themeIds = entries.filter { it.itemType == "THEME" }.map { it.itemId }.distinct()
        val modes = themeModeDao.getByThemeIds(themeIds).associateBy { it.themeId }
        val songIds = buildSet {
            addAll(entries.filter { it.itemType == "SONG" }.map { it.itemId })
            modes.values.mapNotNullTo(this) { it.fullSizeSongId }
        }
        val songs = musicCatalogDao.getSongs(songIds.toList()).associateBy(SongEntity::id)
        val specs = resolvePlaylistDownloadMedia(
            entries = entries,
            playlistDefaultMode = playlist.defaultMode,
            overrideUserPreference = playlist.overrideUserPreference,
            themeModes = modes,
            songUrls = songs.mapValues { it.value.audioUrl },
            songLoudness = songs.mapValues { it.value.loudness },
            themePreferences = activePreferences(themeIds)
        )
        val group = ensureGroup(DownloadGroupEntity.TYPE_PLAYLIST, playlistId.toString(), playlist.name)
        replaceAndPrepare(group, specs)
    }

    private suspend fun activePreferences(themeIds: List<Long>): Map<Long, UserPreferenceEntity> =
        if (themeIds.isEmpty()) {
            emptyMap()
        } else {
            userPreferenceDao.getPreferencesByIdsIncludingDeleted(themeIds)
                .filter { it.deletedAt == null }
                .associateBy(UserPreferenceEntity::themeId)
        }

    private suspend fun reconcileTrackedThemeDownload(themeId: Long) {
        val theme = themeDao.getByIds(listOf(themeId)).firstOrNull() ?: return

        val groups = downloadDao.getAllGroups()
        val singleIds = setOf(themeId.toString(), "theme:$themeId:full")
        groups.filter {
            it.groupType == DownloadGroupEntity.TYPE_SINGLE && it.groupId in singleIds
        }.forEach { group ->
            val desired = resolvePreferredThemeDownload(theme)
            replaceAndPrepare(group, listOfNotNull(desired))
        }

        groups.filter { it.groupType == DownloadGroupEntity.TYPE_ANIME }
            .mapNotNull { group ->
                val anime = animeDao.getByKitsuId(group.groupId)
                group.groupId.takeIf { anime?.animeThemesId == theme.animeId }
            }
            .distinct()
            .forEach { downloadAnimeInternal(it) }

        groups.filter { it.groupType == DownloadGroupEntity.TYPE_PLAYLIST }
            .mapNotNull { group -> group.groupId.toLongOrNull() }
            .filter { playlistId ->
                playlistDao.getPlaylistEntries(playlistId).any {
                    it.itemType == "THEME" && it.itemId == themeId
                }
            }
            .distinct()
            .forEach { downloadPlaylistInternal(it) }
    }

    private suspend fun prepare(specs: List<DownloadMediaSpec>) {
        val status = initialStatus()
        specs.distinctBy { it.mediaKey }.forEach { spec ->
            val existing = downloadItemDao.get(spec.mediaKey)
            val existingFileReady = existing?.status == DownloadItemEntity.STATUS_COMPLETED &&
                existing.filePath?.let(::File)?.isFile == true
            if (existingFileReady) {
                if (existing.loudness != spec.loudness) downloadItemDao.upsert(existing.copy(loudness = spec.loudness))
                return@forEach
            }
            if (existing?.status in setOf(
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
                    legacyThemeId = spec.legacyThemeId,
                    loudness = spec.loudness
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
        removeGroupsByIdentity(type, setOf(externalId))
    }

    private fun removeGroupsByIdentity(type: String, externalIds: Set<String>) {
        scope.launch {
            groupMutationMutex.withLock {
                val groups = externalIds.flatMap { downloadDao.findGroups(type, it) }
                if (groups.isEmpty()) return@withLock
                val keys = groups.flatMap { downloadItemDao.getMediaKeysInGroup(it.id) }.distinct()
                groups.forEach { group ->
                    downloadItemDao.deleteGroupItems(group.id)
                    downloadDao.deleteGroup(group.id)
                }
                keys.forEach { cleanupIfOrphaned(it) }
            }
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
