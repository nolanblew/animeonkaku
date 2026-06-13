package com.takeya.animeongaku.data.auth

interface OngakuAuthRepository {
    suspend fun login(username: String, password: String, deviceName: String): ServerSession
    fun currentSession(): ServerSession?
    fun clearSession()
}
