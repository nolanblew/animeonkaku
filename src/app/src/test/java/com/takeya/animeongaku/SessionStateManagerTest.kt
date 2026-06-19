package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionStateManagerTest {

    private fun store(session: ServerSession? = null): ServerTokenStore =
        ServerTokenStore(FakeSharedPreferences()).apply { session?.let { save(it) } }

    private val sampleSession = ServerSession("tok", "uid-1", "nblew")

    @Test
    fun `starts logged out when no token stored`() {
        val manager = SessionStateManager(store())
        assertEquals(SessionState.LoggedOut, manager.state.value)
    }

    @Test
    fun `starts active when a token is stored`() {
        val manager = SessionStateManager(store(sampleSession))
        assertEquals(SessionState.Active(sampleSession), manager.state.value)
    }

    @Test
    fun `markUnauthorized moves active to reauth required and keeps the token`() {
        val tokenStore = store(sampleSession)
        val manager = SessionStateManager(tokenStore)
        manager.markUnauthorized()
        assertEquals(SessionState.ReauthRequired(sampleSession), manager.state.value)
        assertEquals("tok", tokenStore.currentToken())
    }

    @Test
    fun `markAuthorized recovers reauth required back to active`() {
        val manager = SessionStateManager(store(sampleSession))
        manager.markUnauthorized()
        manager.markAuthorized()
        assertEquals(SessionState.Active(sampleSession), manager.state.value)
    }

    @Test
    fun `markUnauthorized is a no-op when logged out`() {
        val manager = SessionStateManager(store())
        manager.markUnauthorized()
        assertEquals(SessionState.LoggedOut, manager.state.value)
    }

    @Test
    fun `onLogin becomes active and onLogout clears token and becomes logged out`() {
        val tokenStore = store()
        val manager = SessionStateManager(tokenStore)
        tokenStore.save(sampleSession)
        manager.onLogin(sampleSession)
        assertEquals(SessionState.Active(sampleSession), manager.state.value)

        manager.onLogout()
        assertEquals(SessionState.LoggedOut, manager.state.value)
        assertNull(tokenStore.currentToken())
    }

    @Test
    fun `isOnlineEnabled only true when active`() {
        val manager = SessionStateManager(store(sampleSession))
        assert(manager.isOnlineEnabled())
        manager.markUnauthorized()
        assert(!manager.isOnlineEnabled())
    }
}
