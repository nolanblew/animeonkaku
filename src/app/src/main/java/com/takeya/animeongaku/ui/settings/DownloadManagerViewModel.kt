package com.takeya.animeongaku.ui.settings

import android.os.StatFs
import android.os.Environment
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.DownloadGroupEntity
import com.takeya.animeongaku.data.local.DownloadRequestEntity
import com.takeya.animeongaku.download.DownloadManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DownloadManagerUiState(
    val totalSize: Long = 0L,
    val freeSpace: Long = 0L,
    val totalSpace: Long = 0L,
    val groups: List<DownloadGroupEntity> = emptyList(),
    val downloads: List<DownloadRequestEntity> = emptyList(),
    val activeCount: Int = 0,
    val completedCount: Int = 0,
    val batchTotalCount: Int = 0,
    val batchCompletedCount: Int = 0
)

@HiltViewModel
class DownloadManagerViewModel @Inject constructor(
    private val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao
) : ViewModel() {

    private val _freeSpace = MutableStateFlow(getDeviceFreeSpace())
    private val _totalSpace = MutableStateFlow(getDeviceTotalSpace())

    val uiState: StateFlow<DownloadManagerUiState> = combine(
        downloadDao.observeTotalDownloadSize(),
        downloadDao.observeAllGroups(),
        downloadDao.observeAllDownloads(),
        downloadDao.observeActiveCount(),
        downloadDao.observeCompletedCount(),
        downloadDao.observeActiveBatchTotalCount(),
        downloadDao.observeActiveBatchCompletedCount()
    ) { values ->
        @Suppress("UNCHECKED_CAST")
        DownloadManagerUiState(
            totalSize = values[0] as Long,
            freeSpace = _freeSpace.value,
            totalSpace = _totalSpace.value,
            groups = values[1] as List<DownloadGroupEntity>,
            downloads = values[2] as List<DownloadRequestEntity>,
            activeCount = values[3] as Int,
            completedCount = values[4] as Int,
            batchTotalCount = values[5] as Int,
            batchCompletedCount = values[6] as Int
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DownloadManagerUiState())

    fun removeGroup(group: DownloadGroupEntity) {
        when (group.groupType) {
            DownloadGroupEntity.TYPE_ANIME -> downloadManager.removeAnimeDownload(group.groupId)
            DownloadGroupEntity.TYPE_PLAYLIST -> downloadManager.removePlaylistDownload(group.groupId.toLongOrNull() ?: return)
            DownloadGroupEntity.TYPE_SINGLE -> {
                val themeId = group.groupId.toLongOrNull() ?: return
                downloadManager.removeDownload(themeId)
            }
        }
    }

    fun removeAllDownloads() {
        downloadManager.removeAllDownloads()
        refreshFreeSpace()
    }

    fun pauseAll() {
        downloadManager.pauseAllDownloads()
    }

    fun resumeAll() {
        downloadManager.resumeAllDownloads()
    }

    fun cancelAll() {
        downloadManager.cancelAllDownloads()
    }

    fun retryFailed() {
        downloadManager.retryFailedDownloads()
    }

    private fun refreshFreeSpace() {
        _freeSpace.value = getDeviceFreeSpace()
    }

    private fun getDeviceFreeSpace(): Long {
        return try {
            val stat = StatFs(Environment.getDataDirectory().path)
            stat.availableBlocksLong * stat.blockSizeLong
        } catch (e: Exception) {
            0L
        }
    }

    private fun getDeviceTotalSpace(): Long {
        return try {
            val stat = StatFs(Environment.getDataDirectory().path)
            stat.blockCountLong * stat.blockSizeLong
        } catch (e: Exception) {
            0L
        }
    }
}
