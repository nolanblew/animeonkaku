package com.takeya.animeongaku.sync

import javax.inject.Inject
import javax.inject.Singleton

interface ServerUserStateRefresher {
    suspend fun refreshAfterPreferenceWrite()
}

@Singleton
class LibraryPullServerUserStateRefresher @Inject constructor(
    private val libraryPullManager: LibraryPullManager
) : ServerUserStateRefresher {
    override suspend fun refreshAfterPreferenceWrite() {
        libraryPullManager.pullNow(forceFull = false)
    }
}
