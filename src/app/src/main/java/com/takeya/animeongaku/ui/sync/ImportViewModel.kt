package com.takeya.animeongaku.ui.sync

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.math.abs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class ImportViewModel @Inject constructor(
    private val userRepository: UserRepository,
    private val animeRepository: AnimeRepository,
    private val animeDao: AnimeDao,
    private val themeDao: ThemeDao
) : ViewModel() {
    private val _uiState = MutableStateFlow(ImportUiState())
    val uiState: StateFlow<ImportUiState> = _uiState.asStateFlow()

    val anime = animeDao.observeAll()

    fun onUsernameChange(value: String) {
        _uiState.value = _uiState.value.copy(username = value)
    }

    fun onPasswordChange(value: String) {
        _uiState.value = _uiState.value.copy(password = value)
    }

    fun findUser() {
        val username = _uiState.value.username.trim()
        if (username.isBlank()) {
            updateError("Enter a Kitsu username to search.")
            return
        }

        viewModelScope.launch {
            setLoading(true)
            try {
                val userId = userRepository.findUserId(username)
                if (userId == null) {
                    updateError("No Kitsu user found for $username")
                } else {
                    _uiState.value = _uiState.value.copy(
                        userId = userId,
                        status = "User found: $userId",
                        errorMessage = null
                    )
                }
            } catch (exception: Exception) {
                updateError("Kitsu lookup failed: ${exception.message}")
            } finally {
                setLoading(false)
            }
        }
    }

    fun syncLibrary() {
        val username = _uiState.value.username.trim()
        if (username.isBlank()) {
            updateError("Enter a Kitsu username before syncing.")
            return
        }

        viewModelScope.launch {
            setLoading(true)
            try {
                val userId = _uiState.value.userId ?: userRepository.findUserId(username)
                if (userId == null) {
                    updateError("No Kitsu user found for $username")
                    return@launch
                }

                val entries = userRepository.getLibraryEntries(userId)
                val now = System.currentTimeMillis()
                val animeEntities = entries.map {
                    AnimeEntity(
                        kitsuId = it.id,
                        animeThemesId = null,
                        title = it.title,
                        thumbnailUrl = null,
                        syncedAt = now
                    )
                }
                animeDao.upsertAll(animeEntities)

                val syncResult = animeRepository.mapKitsuThemes(entries.map { it.id })
                val themeEntities = syncResult.themes.map { it.toEntity() }
                val mappedAnimeEntities = animeEntities.map { anime ->
                    val mappedId = syncResult.animeMappings[anime.kitsuId]
                    if (mappedId != null) {
                        anime.copy(animeThemesId = mappedId)
                    } else {
                        anime
                    }
                }
                animeDao.upsertAll(mappedAnimeEntities)
                themeDao.upsertAll(themeEntities)

                _uiState.value = _uiState.value.copy(
                    userId = userId,
                    status = "Imported ${animeEntities.size} anime, ${themeEntities.size} themes",
                    errorMessage = null,
                    lastSyncCount = animeEntities.size,
                    lastThemeCount = themeEntities.size
                )
            } catch (exception: Exception) {
                updateError("Sync failed: ${exception.message}")
            } finally {
                setLoading(false)
            }
        }
    }

    private fun setLoading(isLoading: Boolean) {
        _uiState.value = _uiState.value.copy(isLoading = isLoading)
    }

    private fun updateError(message: String) {
        _uiState.value = _uiState.value.copy(
            errorMessage = message,
            status = message,
            isLoading = false
        )
    }

    private fun AnimeThemeEntry.toEntity(): ThemeEntity {
        val themeId = themeId.toLongOrNull() ?: abs(themeId.hashCode()).toLong()
        val animeId = animeId.toLongOrNull()
        return ThemeEntity(
            id = themeId,
            animeId = animeId,
            title = title,
            artistName = artist,
            audioUrl = audioUrl,
            videoUrl = videoUrl,
            isDownloaded = false,
            localFilePath = null
        )
    }
}

data class ImportUiState(
    val username: String = "",
    val password: String = "",
    val userId: String? = null,
    val status: String = "Ready to connect",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val lastSyncCount: Int = 0,
    val lastThemeCount: Int = 0
)
