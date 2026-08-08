package com.takeya.animeongaku.updater

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppUpdateNotifierDeviceTest {
    private lateinit var context: Context
    private lateinit var notifier: AppUpdateNotifier

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
            context.packageName,
            Manifest.permission.POST_NOTIFICATIONS
        )
        notifier = AppUpdateNotifier(context)
    }

    @After
    fun tearDown() {
        notifier.cancelAvailableUpdate()
    }

    @Test
    fun availableRelease_postsActionableUpdateNotification() {
        val version = "99.0.${System.nanoTime()}"
        notifier.notifyIfNew(
            AvailableAppUpdate(
                versionName = version,
                versionTag = "v$version",
                downloadUrl = "https://github.com/nolanblew/animeonkaku/releases/download/v$version/anime-ongaku-v$version.apk",
                releasePageUrl = "https://github.com/nolanblew/animeonkaku/releases/tag/v$version"
            )
        )

        val notifications = context.getSystemService(NotificationManager::class.java).activeNotifications
        assertTrue(
            notifications.any { notification ->
                notification.notification.extras
                    .getCharSequence(Notification.EXTRA_TITLE)
                    ?.contains("update", ignoreCase = true) == true &&
                    notification.notification.actions?.any { it.title.toString() == "Download" } == true
            }
        )
    }
}
