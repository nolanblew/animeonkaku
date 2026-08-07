package com.takeya.animeongaku.data.auth

sealed interface SessionState {
    /** No token stored — fresh install or explicit sign-out. */
    data object LoggedOut : SessionState

    /** Token stored while first-run sync/pull is preparing the local library. */
    data class InitialSync(val session: ServerSession) : SessionState

    /** Token stored and currently accepted by the server. */
    data class Active(val session: ServerSession) : SessionState

    /** Token stored but the server rejected it (e.g. server-side token reset). */
    data class ReauthRequired(val session: ServerSession) : SessionState
}
