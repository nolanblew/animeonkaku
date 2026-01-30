package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.model.KitsuAnimeEntry

interface UserRepository {
    suspend fun findUserId(username: String): String?

    suspend fun getLibraryEntries(userId: String): List<KitsuAnimeEntry>
}
