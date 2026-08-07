package com.takeya.animeongaku

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportViewModelSyncSourceTest {
    @Test
    fun `linked sync path requests full server reconciliation`() {
        val source = File("src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt").readText()

        assertTrue(source.contains("performSync(forceFullSync = true)"))
    }

    @Test
    fun `sign-in sync path follows server sync mode`() {
        val source = File("src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt").readText()

        assertTrue(source.contains("val login = ongakuAuthRepository.login("))
        assertTrue(source.contains("performServerSync(forceFullSync = login.syncMode == ServerSyncMode.FULL)"))
    }

    @Test
    fun `login and manual sync paths update and respect session state manager`() {
        val source = File("src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt").readText()

        assertTrue(source.contains("sessionStateManager.onLogin(session)"))
        assertTrue(source.contains("if (!sessionStateManager.isOnlineEnabled())"))
    }
}
