package com.takeya.animeongaku.data.auth

data class KitsuToken(
    val accessToken: String,
    val refreshToken: String?,
    val expiresAtMillis: Long
) {
    fun isExpired(nowMillis: Long = System.currentTimeMillis()): Boolean {
        return nowMillis >= expiresAtMillis
    }
}
