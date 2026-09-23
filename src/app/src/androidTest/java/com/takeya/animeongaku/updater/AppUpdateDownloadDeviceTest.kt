package com.takeya.animeongaku.updater

import android.Manifest
import android.app.DownloadManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.takeya.animeongaku.MainActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opt-in smoke test for the real release APK delivery path.
 *
 * Run with `-e real_update_download true` on an emulator. The test deliberately
 * stops after handing the APK to Android's package installer; it never accepts
 * the install, and is skipped for ordinary connected-test runs.
 */
@RunWith(AndroidJUnit4::class)
class AppUpdateDownloadDeviceTest {
    private lateinit var context: Context
    private var installer: AppUpdateInstaller? = null

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        assumeTrue(
            "Pass -e $REAL_DOWNLOAD_ARGUMENT true to run the live GitHub download smoke test.",
            isRealDownloadOptedIn()
        )
        assertTrue(
            "Grant POST_NOTIFICATIONS before running: adb shell pm grant ${context.packageName} " +
                "android.permission.POST_NOTIFICATIONS",
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        )
        assertTrue(
            "Start with REQUEST_INSTALL_PACKAGES denied: adb shell appops set ${context.packageName} " +
                "REQUEST_INSTALL_PACKAGES deny",
            !context.packageManager.canRequestPackageInstalls()
        )
        installer = AppUpdateInstaller(context)
        context.getSystemService(NotificationManager::class.java).cancel(UPDATE_NOTIFICATION_ID)
        clearPreviousDownload()
    }

    @After
    fun tearDown() {
        if (installer == null) return
        clearPreviousDownload()
        context.getSystemService(NotificationManager::class.java).cancel(UPDATE_NOTIFICATION_ID)
    }

    @Test
    fun officialRelease_downloads_thenHandsOffToPackageInstaller() {
        val update = AvailableAppUpdate(
            versionName = "1.2.8",
            versionTag = "v1.2.8",
            downloadUrl = OFFICIAL_APK_URL,
            releasePageUrl = "https://github.com/nolanblew/animeonkaku/releases/tag/v1.2.8"
        )
        val appUpdateInstaller = requireNotNull(installer)

        val downloadId = when (val result = appUpdateInstaller.enqueue(update)) {
            is UpdateDownloadResult.Started -> result.downloadId
            UpdateDownloadResult.AlreadyQueued,
            UpdateDownloadResult.AlreadyDownloaded -> appUpdateInstaller.refreshState().downloadId
            UpdateDownloadResult.InvalidRelease -> error("Official release URL was rejected")
            is UpdateDownloadResult.Failed -> error("Could not enqueue update: ${result.message}")
        }
        assertTrue("DownloadManager returned an invalid ID", downloadId > 0L)

        val downloaded = awaitDownloaded(appUpdateInstaller)
        assertEquals(downloadId, downloaded.downloadId)
        assertEquals(AppUpdateDownloadStatus.Downloaded, downloaded.status)
        awaitBackgroundCompletion(appUpdateInstaller)

        // Request unknown-source permission while the app is backgrounded, then let the
        // Activity lifecycle resume the install after the external app-op grant. This proves
        // the same pause/settings/resume path used by a user, without invoking resume twice.
        assertEquals(
            UpdateInstallResult.RequiresInstallPermission,
            appUpdateInstaller.installDownloadedUpdate()
        )
        assertUnknownSourcesSettingsUi()
        setInstallAppOp("allow")

        ActivityScenario.launch(MainActivity::class.java).use {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            assertInstallerUi()
            // Give PackageInstaller time to parse the content URI before @After removes it.
            SystemClock.sleep(INSTALLER_PARSE_SETTLE_MS)
        }
    }

    private fun awaitDownloaded(installer: AppUpdateInstaller): AppUpdateDownloadState {
        val deadline = SystemClock.elapsedRealtime() + DOWNLOAD_TIMEOUT_MS
        var state = installer.refreshState()
        while (SystemClock.elapsedRealtime() < deadline) {
            when (state.status) {
                AppUpdateDownloadStatus.Downloaded -> return state
                AppUpdateDownloadStatus.Failed ->
                    error(state.message ?: "DownloadManager reported a failed update download")
                else -> {
                    SystemClock.sleep(POLL_INTERVAL_MS)
                    state = installer.refreshState()
                }
            }
        }
        error("Timed out waiting for APK download; last state=$state")
    }

    private fun awaitBackgroundCompletion(installer: AppUpdateInstaller) {
        val notificationManager = context.getSystemService(NotificationManager::class.java)
        val deadline = SystemClock.elapsedRealtime() + RECEIVER_TIMEOUT_MS
        while (SystemClock.elapsedRealtime() < deadline) {
            val state = installer.refreshState()
            if (state.status == AppUpdateDownloadStatus.AwaitingInstallPermission) {
                error("Download completion receiver attempted installation before ActivityScenario")
            }
            val notification = notificationManager.activeNotifications
                .firstOrNull { it.id == UPDATE_NOTIFICATION_ID }
                ?.notification
            val title = notification?.extras
                ?.getCharSequence(Notification.EXTRA_TITLE)
                ?.toString()
                .orEmpty()
            if (title.contains("update downloaded", ignoreCase = true)) {
                assertTrue(
                    "Downloaded notification did not expose an Install action",
                    notification?.actions?.any { it.title?.toString() == "Install" } == true
                )
                return
            }
            SystemClock.sleep(POLL_INTERVAL_MS)
        }
        error("Download completion receiver did not post the downloaded notification")
    }

    private fun clearPreviousDownload() {
        val prefs = context.getSharedPreferences(DOWNLOAD_PREFS_NAME, Context.MODE_PRIVATE)
        val downloadId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        if (downloadId >= 0L) {
            context.getSystemService(DownloadManager::class.java).remove(downloadId)
        }
        prefs.edit().clear().commit()
    }

    private fun isRealDownloadOptedIn(): Boolean =
        InstrumentationRegistry.getArguments().getString(REAL_DOWNLOAD_ARGUMENT) == "true"

    private fun setInstallAppOp(mode: String) {
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand(
                "cmd appops set ${context.packageName} REQUEST_INSTALL_PACKAGES $mode"
            )
            .close()
        SystemClock.sleep(APP_OP_SETTLE_MS)
    }

    private fun assertInstallerUi() {
        val uiAutomation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val deadline = SystemClock.elapsedRealtime() + INSTALLER_UI_TIMEOUT_MS
        var packageName = ""
        var labels = emptyList<String>()
        while (SystemClock.elapsedRealtime() < deadline) {
            val root = uiAutomation.rootInActiveWindow
            packageName = root?.packageName?.toString().orEmpty()
            labels = root?.let(::accessibilityLabels).orEmpty()
            val hasInstallQuestion = labels.any {
                it.contains("Do you want to install this app", ignoreCase = true)
            }
            val hasInstallButton = labels.any {
                it.trim().equals("Install", ignoreCase = true)
            }
            if ((packageName == GOOGLE_PACKAGE_INSTALLER || packageName == AOSP_PACKAGE_INSTALLER) &&
                hasInstallQuestion && hasInstallButton
            ) {
                return
            }
            SystemClock.sleep(POLL_INTERVAL_MS)
        }
        error("PackageInstaller confirmation UI did not become ready; root package=$packageName labels=$labels")
    }

    private fun accessibilityLabels(root: AccessibilityNodeInfo): List<String> {
        val labels = mutableListOf<String>()
        fun visit(node: AccessibilityNodeInfo) {
            node.text?.toString()?.takeIf(String::isNotBlank)?.let(labels::add)
            node.contentDescription?.toString()?.takeIf(String::isNotBlank)?.let(labels::add)
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(::visit)
            }
        }
        visit(root)
        return labels
    }

    private fun assertUnknownSourcesSettingsUi() {
        val uiAutomation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val deadline = SystemClock.elapsedRealtime() + SETTINGS_UI_TIMEOUT_MS
        var packageName = ""
        while (SystemClock.elapsedRealtime() < deadline) {
            packageName = uiAutomation.rootInActiveWindow?.packageName?.toString().orEmpty()
            if (packageName == SETTINGS_PACKAGE) return
            SystemClock.sleep(POLL_INTERVAL_MS)
        }
        error("Unknown-source settings UI did not become foreground; root package=$packageName")
    }

    private companion object {
        const val REAL_DOWNLOAD_ARGUMENT = "real_update_download"
        const val OFFICIAL_APK_URL =
            "https://github.com/nolanblew/animeonkaku/releases/download/v1.2.8/anime-ongaku-v1.2.8.apk"
        const val DOWNLOAD_TIMEOUT_MS = 180_000L
        const val RECEIVER_TIMEOUT_MS = 15_000L
        const val POLL_INTERVAL_MS = 500L
        const val APP_OP_SETTLE_MS = 250L
        const val INSTALLER_UI_TIMEOUT_MS = 15_000L
        const val SETTINGS_UI_TIMEOUT_MS = 10_000L
        const val INSTALLER_PARSE_SETTLE_MS = 1_000L
        const val SETTINGS_PACKAGE = "com.android.settings"
        const val GOOGLE_PACKAGE_INSTALLER = "com.google.android.packageinstaller"
        const val AOSP_PACKAGE_INSTALLER = "com.android.packageinstaller"
        const val UPDATE_NOTIFICATION_ID = 2042
        const val DOWNLOAD_PREFS_NAME = "app_update_downloads"
        const val KEY_DOWNLOAD_ID = "download_id"
    }
}
