package com.takeya.animeongaku.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateDeliveryTest {

    @Test
    fun trustedReleaseApkUrl_acceptsOnlyOfficialRepositoryApks() {
        assertTrue(
            isTrustedReleaseApkUrl(
                "https://github.com/nolanblew/animeonkaku/releases/download/v1.3.0/anime-ongaku-v1.3.0.apk"
            )
        )
        assertFalse(isTrustedReleaseApkUrl("http://github.com/nolanblew/animeonkaku/releases/download/v1.3.0/app.apk"))
        assertFalse(isTrustedReleaseApkUrl("https://github.com/other/repo/releases/download/v1.3.0/app.apk"))
        assertFalse(isTrustedReleaseApkUrl("https://example.com/anime-ongaku-v1.3.0.apk"))
        assertFalse(isTrustedReleaseApkUrl("https://github.com/nolanblew/animeonkaku/releases/download/v1.3.0/app.aab"))
    }

    @Test
    fun notificationDecision_onlyNotifiesForANewReleaseTag() {
        assertTrue(shouldNotifyUpdate(lastNotifiedTag = null, candidateTag = "v1.3.0"))
        assertFalse(shouldNotifyUpdate(lastNotifiedTag = "v1.3.0", candidateTag = "v1.3.0"))
        assertTrue(shouldNotifyUpdate(lastNotifiedTag = "v1.3.0", candidateTag = "v1.3.1"))
    }

    @Test
    fun updateApkFileName_isStableAndFilesystemSafe() {
        assertEquals("anime-ongaku-v1.3.0.apk", updateApkFileName("v1.3.0"))
        assertEquals("anime-ongaku-1.3.0-beta-1.apk", updateApkFileName("1.3.0 beta/1"))
    }

    @Test
    fun downloadStatus_mapsDownloadManagerLifecycle() {
        assertEquals(AppUpdateDownloadStatus.Queued, appUpdateDownloadStatus(android.app.DownloadManager.STATUS_PENDING))
        assertEquals(AppUpdateDownloadStatus.Downloading, appUpdateDownloadStatus(android.app.DownloadManager.STATUS_RUNNING))
        assertEquals(AppUpdateDownloadStatus.Paused, appUpdateDownloadStatus(android.app.DownloadManager.STATUS_PAUSED))
        assertEquals(AppUpdateDownloadStatus.Downloaded, appUpdateDownloadStatus(android.app.DownloadManager.STATUS_SUCCESSFUL))
        assertEquals(AppUpdateDownloadStatus.Failed, appUpdateDownloadStatus(android.app.DownloadManager.STATUS_FAILED))
    }

    @Test
    fun downloadProgress_handlesUnknownSizeAndClamps() {
        assertEquals(0, updateDownloadProgress(10L, 0L))
        assertEquals(25, updateDownloadProgress(25L, 100L))
        assertEquals(100, updateDownloadProgress(200L, 100L))
    }

    @Test
    fun installResume_requiresPermissionAfterSettingsButDoesNotLoopWhileDenied() {
        assertFalse(
            shouldResumeInstall(
                status = AppUpdateDownloadStatus.AwaitingInstallPermission,
                canRequestPackageInstalls = false,
                installRequested = true,
                installAttempted = false
            )
        )
        assertTrue(
            shouldResumeInstall(
                status = AppUpdateDownloadStatus.AwaitingInstallPermission,
                canRequestPackageInstalls = true,
                installRequested = true,
                installAttempted = false
            )
        )
        assertFalse(
            shouldResumeInstall(
                status = AppUpdateDownloadStatus.Downloaded,
                canRequestPackageInstalls = true,
                installRequested = true,
                installAttempted = true
            )
        )
    }
}
