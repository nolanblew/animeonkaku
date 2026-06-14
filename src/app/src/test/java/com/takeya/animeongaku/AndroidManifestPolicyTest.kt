package com.takeya.animeongaku

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AndroidManifestPolicyTest {
    @Test
    fun manifestAllowsCleartextForLanServerUrls() {
        val manifest = listOf(
            File("app/src/main/AndroidManifest.xml"),
            File("src/main/AndroidManifest.xml")
        ).first { it.exists() }.readText()

        assertTrue(
            "LAN server URLs are configured as http:// addresses, so Android must permit cleartext traffic.",
            manifest.contains("""android:usesCleartextTraffic="true"""")
        )
    }
}
