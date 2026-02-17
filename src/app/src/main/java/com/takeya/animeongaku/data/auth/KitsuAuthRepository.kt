package com.takeya.animeongaku.data.auth

interface KitsuAuthRepository {
    suspend fun login(username: String, password: String): KitsuToken
    suspend fun refreshIfNeeded(): KitsuToken?
    fun currentToken(): KitsuToken?
    fun clearToken()
}
