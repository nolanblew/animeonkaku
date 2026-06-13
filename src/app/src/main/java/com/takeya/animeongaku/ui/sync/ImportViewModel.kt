package com.takeya.animeongaku.ui.sync

import android.content.Context
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.auth.KitsuAuthRepository
import com.takeya.animeongaku.data.auth.AuthException
import com.takeya.animeongaku.data.auth.KitsuTokenStore
import com.takeya.animeongaku.data.auth.OngakuAuthRepository
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import com.takeya.animeongaku.data.repository.LibrarySyncProgress
import com.takeya.animeongaku.data.repository.ThemeMappingProgress
import com.takeya.animeongaku.data.repository.UserRepository
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.LibraryPullManager
import com.takeya.animeongaku.sync.LibrarySyncService
import com.takeya.animeongaku.sync.SyncManager
import com.takeya.animeongaku.sync.SyncPhase
import com.takeya.animeongaku.sync.SyncState
import com.takeya.animeongaku.sync.toSyncState
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

@HiltViewModel
class ImportViewModel @Inject constructor(
    private val authRepository: KitsuAuthRepository,
    private val ongakuAuthRepository: OngakuAuthRepository,
    private val ongakuApi: OngakuApi,
    private val userRepository: UserRepository,
    private val animeDao: AnimeDao,
    private val tokenStore: KitsuTokenStore,
    private val serverSettingsStore: ServerSettingsStore,
    private val libraryPullManager: LibraryPullManager,
    val syncManager: SyncManager,
    @ApplicationContext private val appContext: Context
) : ViewModel() {
    companion object {
        private const val TAG = "ImportViewModel"
        private const val SERVER_SYNC_POLL_INTERVAL_MS = 2_000L
    }

    private val _authState = MutableStateFlow(AuthState())
    private val _serverSyncState = MutableStateFlow(SyncState())
    val uiState: StateFlow<ImportUiState>

    val anime = animeDao.observeAll()

    init {
        val useServer = serverSettingsStore.isConfigured
        val serverSession = if (useServer) {
            ongakuAuthRepository.currentSession()
        } else {
            null
        }
        val storedUsername = if (useServer) serverSession?.username else tokenStore.getUsername()
        val storedUserId = if (useServer) serverSession?.kitsuUserId else tokenStore.getUserId()
        val hasToken = if (useServer) serverSession != null else authRepository.currentToken() != null
        val isLinked = storedUsername != null && storedUserId != null
        _authState.value = AuthState(
            username = storedUsername ?: "",
            password = "",
            userId = storedUserId,
            isSignedIn = hasToken,
            isLinked = isLinked,
            linkedUsername = storedUsername,
            authError = null
        )

        uiState = MutableStateFlow(ImportUiState()).also { flow ->
            viewModelScope.launch {
                combine(_authState, syncManager.state, _serverSyncState) { auth, legacySync, serverSync ->
                    val sync = if (serverSettingsStore.isConfigured) serverSync else legacySync
                    mapToUiState(auth, sync)
                }.collect { flow.value = it }
            }
        }
    }

    fun onUsernameChange(value: String) {
        val sanitized = value.replace(Regex("[\\r\\n]"), "")
        _authState.value = _authState.value.copy(username = sanitized)
    }

    fun onPasswordChange(value: String) {
        val sanitized = value.replace(Regex("[\\r\\n]"), "")
        _authState.value = _authState.value.copy(password = sanitized)
    }

    fun syncLibrary() {
        if (_authState.value.isLinked) {
            performSync(forceFullSync = false)
        } else {
            signInAndSync()
        }
    }

    private val _showResyncConfirmation = MutableStateFlow(false)
    val showResyncConfirmation: StateFlow<Boolean> = _showResyncConfirmation.asStateFlow()

    fun requestForceFullSync() {
        _showResyncConfirmation.value = true
    }

    fun dismissResyncConfirmation() {
        _showResyncConfirmation.value = false
    }

    fun confirmForceFullSync() {
        _showResyncConfirmation.value = false
        tokenStore.saveLastSyncedAt(0L)
        performSync(forceFullSync = true)
    }

    fun pauseSync() = syncManager.pause()
    fun resumeSync() = syncManager.resume()
    fun cancelSync() = syncManager.cancel()

    private fun signInAndSync() {
        val username = _authState.value.username.trim()
        val password = _authState.value.password.trim()
        if (username.isBlank()) {
            _authState.value = _authState.value.copy(authError = "Enter your Kitsu email or username.")
            return
        }
        if (password.isBlank()) {
            _authState.value = _authState.value.copy(authError = "Enter your Kitsu password to sign in.")
            return
        }

        if (serverSettingsStore.isConfigured) {
            signInToServer(username, password)
            return
        }

        viewModelScope.launch {
            _authState.value = _authState.value.copy(authError = null, isAuthenticating = true)
            try {
                authRepository.login(username = username, password = password)
                _authState.value = _authState.value.copy(isSignedIn = true)
                val selfId = userRepository.getAuthenticatedUserId()
                if (selfId == null) {
                    _authState.value = _authState.value.copy(
                        authError = "Signed in, but Kitsu profile could not be loaded.",
                        isAuthenticating = false
                    )
                    return@launch
                }
                tokenStore.saveUsername(username)
                tokenStore.saveUserId(selfId)
                _authState.value = _authState.value.copy(
                    isLinked = true,
                    linkedUsername = username,
                    userId = selfId,
                    isAuthenticating = false
                )
                startSyncService(selfId, forceFullSync = false)
            } catch (exception: Exception) {
                _authState.value = _authState.value.copy(
                    authError = exception.toReadableMessage(prefix = "Sign-in failed"),
                    isAuthenticating = false
                )
            }
        }
    }

    private fun signInToServer(username: String, password: String) {
        viewModelScope.launch {
            _authState.value = _authState.value.copy(authError = null, isAuthenticating = true)
            try {
                val session = ongakuAuthRepository.login(
                    username = username,
                    password = password,
                    deviceName = deviceName()
                )
                _authState.value = _authState.value.copy(
                    username = session.username,
                    password = "",
                    userId = session.kitsuUserId,
                    isSignedIn = true,
                    isLinked = true,
                    linkedUsername = session.username,
                    isAuthenticating = false
                )
                performServerSync(forceFullSync = false)
            } catch (exception: Exception) {
                _authState.value = _authState.value.copy(
                    authError = exception.toReadableMessage(prefix = "Server sign-in failed"),
                    isAuthenticating = false
                )
            }
        }
    }

    private fun performSync(forceFullSync: Boolean) {
        if (serverSettingsStore.isConfigured) {
            performServerSync(forceFullSync)
            return
        }

        viewModelScope.launch {
            _authState.value = _authState.value.copy(authError = null, isAuthenticating = true)
            try {
                val token = try {
                    authRepository.refreshIfNeeded()
                } catch (e: Exception) {
                    null
                }
                val userId = tokenStore.getUserId()
                if (userId == null) {
                    _authState.value = _authState.value.copy(
                        authError = "No linked account found. Please sign in again.",
                        isAuthenticating = false
                    )
                    return@launch
                }
                if (token == null) {
                    _authState.value = _authState.value.copy(
                        authError = "Your session has expired. Please sign in again.",
                        isLinked = false,
                        isSignedIn = false,
                        isAuthenticating = false
                    )
                    authRepository.clearToken()
                    return@launch
                }
                _authState.value = _authState.value.copy(isAuthenticating = false)
                startSyncService(userId, forceFullSync)
            } catch (exception: Exception) {
                _authState.value = _authState.value.copy(
                    authError = exception.toReadableMessage(prefix = "Sync failed"),
                    isAuthenticating = false
                )
            }
        }
    }

    private fun performServerSync(forceFullSync: Boolean) {
        viewModelScope.launch {
            _authState.value = _authState.value.copy(authError = null, isAuthenticating = true)
            try {
                val session = ongakuAuthRepository.currentSession()
                if (session == null) {
                    _authState.value = _authState.value.copy(
                        authError = "No server session found. Please sign in again.",
                        isLinked = false,
                        isSignedIn = false,
                        isAuthenticating = false
                    )
                    return@launch
                }
                ongakuApi.startSync(OngakuSyncRequest(full = forceFullSync))
                _serverSyncState.value = SyncState(
                    phase = SyncPhase.SyncingLibrary,
                    status = "Server sync queued",
                    isRunning = true
                )
                _authState.value = _authState.value.copy(
                    userId = session.kitsuUserId,
                    isSignedIn = true,
                    isLinked = true,
                    linkedUsername = session.username,
                    isAuthenticating = false
                )
                pollServerSyncThenPull()
            } catch (exception: Exception) {
                val message = exception.toReadableMessage(prefix = "Server sync failed")
                _serverSyncState.value = SyncState(
                    phase = SyncPhase.Error,
                    status = message,
                    isRunning = false,
                    errorMessage = message
                )
                _authState.value = _authState.value.copy(
                    authError = message,
                    isAuthenticating = false
                )
            }
        }
    }

    private suspend fun pollServerSyncThenPull() {
        while (true) {
            val status = ongakuApi.syncStatus()
            val syncState = status.toSyncState()
            _serverSyncState.value = syncState

            when (status.state.uppercase()) {
                "QUEUED", "RUNNING" -> delay(SERVER_SYNC_POLL_INTERVAL_MS)
                "FAILED", "CANCELLED" -> return
                else -> {
                    libraryPullManager.pullNow(forceFull = true)
                    _serverSyncState.value = syncState.copy(
                        phase = SyncPhase.Done,
                        status = "Server sync complete",
                        isRunning = false
                    )
                    return
                }
            }
        }
    }

    private fun startSyncService(userId: String, forceFullSync: Boolean) {
        LibrarySyncService.start(appContext, userId, forceFullSync)
    }

    fun unlinkAccount() {
        authRepository.clearToken()
        ongakuAuthRepository.clearSession()
        tokenStore.clearAll()
        syncManager.cancel()
        _authState.value = AuthState()
    }

    private fun mapToUiState(auth: AuthState, sync: SyncState): ImportUiState {
        val syncPhaseUi = when (sync.phase) {
            SyncPhase.Idle -> ImportSyncPhase.Idle
            SyncPhase.SyncingLibrary -> ImportSyncPhase.SyncingLibrary
            SyncPhase.MappingThemes -> ImportSyncPhase.MappingThemes
            SyncPhase.FallbackSearch -> ImportSyncPhase.FallbackSearch
            SyncPhase.Saving -> ImportSyncPhase.Saving
            SyncPhase.Done -> ImportSyncPhase.Done
            SyncPhase.Error -> ImportSyncPhase.Error
        }

        val status = when {
            auth.isAuthenticating -> "Authenticating…"
            auth.authError != null -> auth.authError
            sync.isRunning || sync.phase == SyncPhase.Done || sync.phase == SyncPhase.Error -> sync.status
            auth.isLinked -> "Linked to ${auth.linkedUsername}"
            else -> "Ready to connect"
        }

        return ImportUiState(
            username = auth.username,
            password = auth.password,
            userId = auth.userId,
            isSignedIn = auth.isSignedIn,
            isLinked = auth.isLinked,
            linkedUsername = auth.linkedUsername,
            status = status,
            isLoading = auth.isAuthenticating || sync.isRunning,
            isPaused = sync.isPaused,
            errorMessage = auth.authError ?: sync.errorMessage,
            syncPhase = syncPhaseUi,
            libraryProgress = sync.libraryProgress,
            themeProgress = sync.themeProgress,
            lastSyncCount = sync.lastSyncCount,
            lastThemeCount = sync.lastThemeCount,
            unmatchedAnime = sync.unmatchedAnime,
            fallbackCurrent = sync.fallbackCurrent,
            fallbackTotal = sync.fallbackTotal
        )
    }
}

private fun deviceName(): String =
    listOf(Build.MANUFACTURER, Build.MODEL)
        .joinToString(" ")
        .trim()
        .ifBlank { "Android" }

private data class AuthState(
    val username: String = "",
    val password: String = "",
    val userId: String? = null,
    val isSignedIn: Boolean = false,
    val isLinked: Boolean = false,
    val linkedUsername: String? = null,
    val authError: String? = null,
    val isAuthenticating: Boolean = false
)

private fun Exception.toReadableMessage(prefix: String): String {
    return when (this) {
        is AuthException -> "$prefix: ${message}"
        is retrofit2.HttpException -> "$prefix (HTTP ${code()}): ${message()}"
        else -> "$prefix: ${message}"
    }
}

data class ImportUiState(
    val username: String = "",
    val password: String = "",
    val userId: String? = null,
    val isSignedIn: Boolean = false,
    val isLinked: Boolean = false,
    val linkedUsername: String? = null,
    val status: String = "Ready to connect",
    val isLoading: Boolean = false,
    val isPaused: Boolean = false,
    val errorMessage: String? = null,
    val syncPhase: ImportSyncPhase = ImportSyncPhase.Idle,
    val libraryProgress: LibrarySyncProgress? = null,
    val themeProgress: ThemeMappingProgress? = null,
    val lastSyncCount: Int = 0,
    val lastThemeCount: Int = 0,
    val unmatchedAnime: List<String> = emptyList(),
    val fallbackCurrent: Int = 0,
    val fallbackTotal: Int = 0
)

enum class ImportSyncPhase {
    Idle,
    SyncingLibrary,
    MappingThemes,
    FallbackSearch,
    Saving,
    Done,
    Error
}
