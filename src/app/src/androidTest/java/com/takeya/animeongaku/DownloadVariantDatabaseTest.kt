package com.takeya.animeongaku

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.takeya.animeongaku.data.local.AppDatabase
import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.DownloadGroupEntity
import com.takeya.animeongaku.data.local.DownloadGroupItemEntity
import com.takeya.animeongaku.download.shouldDeletePhysicalDownload
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DownloadVariantDatabaseTest {

    @Test
    fun reportedFileSurvivesCatalogReplacementAndPlaylistReconciliation() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(), AppDatabase::class.java
        ).allowMainThreadQueries().build()
        try {
            val items = database.downloadItemDao()
            val key = DownloadItemEntity.songMediaKey(90)
            database.themeDao().upsertAll(listOf(ThemeEntity(10, null, "Theme", "Artist", "/tv/10", null, false, null)))
            database.themeModeDao().upsertAll(listOf(ThemeModeEntity(10, "/tv/10", fullSizeSongId = 90, fullSizeUrl = "/songs/90")))
            items.upsert(DownloadItemEntity(
                mediaKey = key, itemType = "SONG", itemId = 90, mode = "AUDIO",
                status = DownloadItemEntity.STATUS_COMPLETED, filePath = "content://downloads/songs/90",
                createdAt = 1, updatedAt = 1
            ))
            val playlist = database.downloadDao().insertGroup(DownloadGroupEntity(
                groupType = DownloadGroupEntity.TYPE_PLAYLIST, groupId = "1", label = "Playlist"
            ))
            val reported = database.downloadDao().insertGroup(DownloadGroupEntity(
                groupType = DownloadGroupEntity.TYPE_SINGLE, groupId = "reported-song:90", label = "Reported: Theme"
            ))
            items.insertGroupItems(listOf(DownloadGroupItemEntity(playlist, key), DownloadGroupItemEntity(reported, key)))
            database.themeModeDao().upsertAll(listOf(ThemeModeEntity(10, "/tv/10", fullSizeSongId = 91, fullSizeUrl = "/songs/91")))
            items.deleteGroupItem(playlist, key)
            assertEquals(listOf(reported), items.getGroupIdsForMedia(key))
            assertFalse(shouldDeletePhysicalDownload(items.countGroupsForMedia(key), false))
            assertEquals("content://downloads/songs/90", items.get(key)?.filePath)
        } finally {
            database.close()
        }
    }

    @Test
    fun completedFullSizeSongMarksItsThemeDownloaded() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            AppDatabase::class.java
        ).allowMainThreadQueries().build()
        try {
            database.themeDao().upsertAll(
                listOf(ThemeEntity(10, null, "Theme", "Artist", "/tv/10", null, false, null))
            )
            database.themeModeDao().upsertAll(
                listOf(ThemeModeEntity(10, "/tv/10", fullSizeSongId = 90, fullSizeUrl = "/songs/90"))
            )
            database.downloadItemDao().upsert(
                DownloadItemEntity(
                    mediaKey = DownloadItemEntity.songMediaKey(90),
                    itemType = "SONG",
                    itemId = 90,
                    mode = "AUDIO",
                    status = DownloadItemEntity.STATUS_COMPLETED,
                    filePath = "content://downloads/songs/90",
                    createdAt = 1,
                    updatedAt = 1
                )
            )

            assertEquals(listOf(10L), database.themeDao().observeDownloadedThemeIds().first())
            assertEquals(listOf(10L), database.downloadItemDao().observeCompletedThemeIds().first())
        } finally {
            database.close()
        }
    }
}
