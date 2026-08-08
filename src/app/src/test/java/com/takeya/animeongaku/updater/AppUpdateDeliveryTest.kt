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
}
