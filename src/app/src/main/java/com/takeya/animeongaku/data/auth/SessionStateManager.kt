package com.takeya.animeongaku.data.auth

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Single source of truth for authentication state. The interceptor reports 401/2xx
 * outcomes here (it never clears the token directly), and the root UI observes [state]
 * to switch between onboarding, the full app, and degraded downloaded-only mode.
 */
@Singleton
class SessionStateManager @Inject constructor(
    private val tokenStore: ServerTokenStore
) {
    private val _state = MutableStateFlow(initialState())
    val state: StateFlow<SessionState> = _state.asStateFlow()

    private fun initialState(): SessionState {
        val session = tokenStore.currentSession()
        return if (session != null) SessionState.Active(session) else SessionState.LoggedOut
    }

    fun onLogin(session: ServerSession) {
        _state.value = SessionState.Active(session)
    }

    fun onLogout() {
        tokenStore.clear()
        _state.value = SessionState.LoggedOut
    }

    /** A 401 on a request that carried a bearer token. Keeps the token. */
    fun markUnauthorized() {
        _state.update { current ->
            when (current) {
                is SessionState.Active -> SessionState.ReauthRequired(current.session)
                else -> current
            }
        }
    }

    /** A successful authenticated response — recovers from a transient 401. */
    fun markAuthorized() {
        _state.update { current ->
            when (current) {
                is SessionState.ReauthRequired -> SessionState.Active(current.session)
                else -> current
            }
        }
    }

    /** Online features (sync, online search, remote streaming) are allowed only when Active. */
    fun isOnlineEnabled(): Boolean = _state.value is SessionState.Active
}
