package com.takeya.animeongaku

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportViewModelSyncSourceTest {
    @Test
    fun `linked and sign-in sync paths request full server reconciliation`() {
        val source = File("src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt").readText()

        assertTrue(source.contains("performSync(forceFullSync = true)"))
        assertTrue(source.contains("performServerSync(forceFullSync = true)"))
    }

    @Test
    fun `login and manual sync paths update and respect session state manager`() {
        val source = File("src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt").readText()

        assertTrue(source.contains("sessionStateManager.onLogin(session)"))
        assertTrue(source.contains("if (!sessionStateManager.isOnlineEnabled())"))
    }
}
