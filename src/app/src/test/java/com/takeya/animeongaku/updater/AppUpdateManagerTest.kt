package com.takeya.animeongaku.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateManagerTest {

    @Test
    fun compareVersions_handlesNumericSegments() {
        assertTrue(compareVersions("1.0.10", "1.0.9") > 0)
        assertEquals(0, compareVersions("1.2.0", "1.2"))
    }

    @Test
    fun compareVersions_treatsStableAsNewerThanPreRelease() {
        assertTrue(compareVersions("1.2.0", "1.2.0-beta1") > 0)
    }

    @Test
    fun extractVersionToken_readsTaggedReleaseNames() {
        assertEquals("1.4.2", extractVersionToken("Anime Ongaku v1.4.2"))
    }

    @Test
    fun selectPreferredApkAsset_prefersReleaseArtifact() {
        val selected = selectPreferredApkAsset(
            listOf(
                GitHubReleaseAssetDto(name = "anime-ongaku-debug.apk", browserDownloadUrl = "https://example.com/debug.apk"),
                GitHubReleaseAssetDto(name = "anime-ongaku-release.apk", browserDownloadUrl = "https://example.com/release.apk")
            )
        )

        assertNotNull(selected)
        assertEquals("anime-ongaku-release.apk", selected?.name)
    }

    @Test
    fun releaseMapping_fallsBackToReleasePageWhenNoApkExists() {
        val mapped = GitHubReleaseDto(
            tagName = "v1.5.0",
            htmlUrl = "https://github.com/nolanblew/animeonkaku/releases/tag/v1.5.0"
        ).toAvailableAppUpdate()

        assertNotNull(mapped)
        assertEquals(mapped?.releasePageUrl, mapped?.downloadUrl)
    }

    @Test
    fun selectPreferredApkAsset_returnsNullWhenNoApkExists() {
        val selected = selectPreferredApkAsset(
            listOf(
                GitHubReleaseAssetDto(name = "release-notes.txt", browserDownloadUrl = "https://example.com/notes.txt")
            )
        )

        assertNull(selected)
    }
}
