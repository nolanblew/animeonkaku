package com.takeya.animeongaku.data.auth

import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport

interface OngakuAuthRepository {
    suspend fun login(
        username: String,
        password: String,
        deviceName: String,
        legacyLibraryImport: OngakuLegacyLibraryImport? = null
    ): ServerSession
    fun currentSession(): ServerSession?
    fun clearSession()
}
