package com.takeya.animeongaku

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AndroidManifestPolicyTest {
    @Test
    fun releaseManifestBlocksCleartextWhileDebugAllowsLanServers() {
        val mainManifest = listOf(
            File("app/src/main/AndroidManifest.xml"),
            File("src/main/AndroidManifest.xml")
        ).first { it.exists() }.readText()
        val debugManifest = listOf(
            File("app/src/debug/AndroidManifest.xml"),
            File("src/debug/AndroidManifest.xml")
        ).first { it.exists() }.readText()

        assertTrue(
            "Release builds send credentials and bearer tokens, so they must reject cleartext traffic.",
            mainManifest.contains("""android:usesCleartextTraffic="false"""")
        )
        assertTrue(
            "Debug builds still need opt-in LAN http:// server overrides.",
            debugManifest.contains("""android:usesCleartextTraffic="true"""")
        )
    }

    @Test
    fun sessionTokenPreferencesAreExcludedFromBackupAndDeviceTransfer() {
        val backupRules = listOf(
            File("app/src/main/res/xml/backup_rules.xml"),
            File("src/main/res/xml/backup_rules.xml")
        ).first { it.exists() }.readText()
        val extractionRules = listOf(
            File("app/src/main/res/xml/data_extraction_rules.xml"),
            File("src/main/res/xml/data_extraction_rules.xml")
        ).first { it.exists() }.readText()
        val sessionExclusion = """<exclude domain="sharedpref" path="ongaku_session_prefs.xml""""

        assertTrue(backupRules.contains(sessionExclusion))
        assertTrue(extractionRules.substringAfter("<cloud-backup>").substringBefore("</cloud-backup>").contains(sessionExclusion))
        assertTrue(extractionRules.substringAfter("<device-transfer>").substringBefore("</device-transfer>").contains(sessionExclusion))
    }
}
