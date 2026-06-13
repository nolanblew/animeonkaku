package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.server.ServerSettingsStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerStoresTest {
    @Test
    fun `server settings normalize base urls and expose configured state`() {
        val store = ServerSettingsStore(FakeSharedPreferences())

        assertFalse(store.isConfigured)
        store.serverBaseUrl = " localhost:8080 "

        assertEquals("https://localhost:8080/", store.serverBaseUrl)
        assertTrue(store.isConfigured)

        store.serverBaseUrl = "http://192.168.1.5:8080/api"
        assertEquals("http://192.168.1.5:8080/api/", store.serverBaseUrl)
    }

    @Test
    fun `server settings persist pull cursor separately from room`() {
        val store = ServerSettingsStore(FakeSharedPreferences())

        assertEquals(0L, store.serverPullCursor)
        store.serverPullCursor = 1760000000000

        assertEquals(1760000000000, store.serverPullCursor)
    }

    @Test
    fun `server token store saves session metadata and clears it`() {
        val store = ServerTokenStore(FakeSharedPreferences())

        store.save(
            ServerSession(
                token = "opaque-token",
                kitsuUserId = "12345",
                username = "nblewtest"
            )
        )

        assertEquals("opaque-token", store.currentToken())
        assertEquals("12345", store.currentSession()?.kitsuUserId)
        assertEquals("nblewtest", store.currentSession()?.username)

        store.clear()

        assertNull(store.currentToken())
        assertNull(store.currentSession())
    }
}
