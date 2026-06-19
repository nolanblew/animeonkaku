package com.takeya.animeongaku

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class TetherSourceContractTest {
    @Test
    fun `reconnect overlay has an explicit dismiss path`() {
        val source = File("src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt").readText()

        assertTrue(source.contains("BackHandler(enabled = showReconnect)"))
        assertTrue(source.contains("contentDescription = \"Dismiss reconnect\""))
        assertTrue(source.contains("showReconnect = false"))
    }

    @Test
    fun `download worker defers server warmup while session is not active`() {
        val source = File("src/main/java/com/takeya/animeongaku/download/DownloadWorker.kt").readText()

        assertTrue(source.contains("SessionStateManager"))
        assertTrue(source.contains("!sessionStateManager.isOnlineEnabled()"))
        assertTrue(source.contains("return ServerAudioReadiness.RETRY_LATER"))
    }
}
