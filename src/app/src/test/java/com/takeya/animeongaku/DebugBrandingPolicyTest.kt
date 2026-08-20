package com.takeya.animeongaku

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class DebugBrandingPolicyTest {
    @Test
    fun debugBuildCanCoexistWithReleaseBuild() {
        val buildScript = projectFile("build.gradle.kts").readText()

        assertTrue(
            "Debug builds need a distinct application ID so they can be installed beside release builds.",
            buildScript.contains("""applicationIdSuffix = ".debug"""")
        )
    }

    @Test
    fun debugBuildHasDistinctVisibleBranding() {
        val debugStrings = projectFile("src/debug/res/values/strings.xml").readText()
        val debugColors = projectFile("src/debug/res/values/colors.xml").readText()
        val launcherIcon = projectFile("src/main/res/mipmap-anydpi-v26/ic_launcher.xml").readText()
        val roundLauncherIcon = projectFile("src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml").readText()

        assertTrue(debugStrings.contains("""<string name="app_name">Anime Ongaku (debug)</string>"""))
        assertTrue(debugColors.contains("""<color name="ic_launcher_bg">#C62828</color>"""))

        listOf(launcherIcon, roundLauncherIcon).forEach { icon ->
            assertTrue(icon.contains("""<background android:drawable="@color/ic_launcher_bg" />"""))
            assertTrue(icon.contains("""<foreground android:drawable="@mipmap/ic_launcher_foreground" />"""))
        }
    }

    private fun projectFile(relativePath: String): File = listOf(
        File("app/$relativePath"),
        File(relativePath)
    ).first { it.exists() }
}
