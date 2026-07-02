package com.takeya.animeongaku.ui.onboarding

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.auth.OngakuAuthRepository
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.importer.LegacyLibraryImportParseException
import com.takeya.animeongaku.data.importer.LegacyLibraryImportParser
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.network.toFriendReadableMessage
import com.takeya.animeongaku.sync.FirstSyncProgress
import com.takeya.animeongaku.sync.FirstSyncStep
import com.takeya.animeongaku.sync.InitialLibrarySync
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FirstSyncUiState(
    val stepNumber: Int,
    val totalSteps: Int,
    val stepTitle: String,
    val message: String
)

fun FirstSyncProgress.toUiState(): FirstSyncUiState = FirstSyncUiState(
    stepNumber = step.stepNumber,
    totalSteps = FirstSyncStep.totalSteps,
    stepTitle = step.title,
    message = message
)

data class OnboardingUiState(
    val username: String = "",
    val password: String = "",
    val isSubmitting: Boolean = false,
    val status: String? = null,
    val error: String? = null,
    val firstSync: FirstSyncUiState? = null,
    val legacyImportFileName: String? = null,
    val legacyImportEntryCount: Int = 0
) {
    val canSubmit: Boolean get() = !isSubmitting && username.isNotBlank() && password.isNotBlank()
}

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val authRepository: OngakuAuthRepository,
    private val sessionStateManager: SessionStateManager,
    private val serverSettingsStore: ServerSettingsStore,
    private val initialLibrarySync: InitialLibrarySync,
    private val legacyLibraryImportParser: LegacyLibraryImportParser
) : ViewModel() {

    private val _uiState = MutableStateFlow(OnboardingUiState())
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()
    private var selectedLegacyImport: SelectedLegacyImport? = null

    fun onUsernameChange(value: String) {
        _uiState.update { it.copy(username = value.replace(Regex("[\\r\\n]"), ""), error = null) }
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(password = value.replace(Regex("[\\r\\n]"), ""), error = null) }
    }

    fun onLegacyImportFileSelected(fileName: String, contents: String) {
        try {
            val payload = legacyLibraryImportParser.parse(contents)
            selectedLegacyImport = SelectedLegacyImport(
                fileName = fileName.ifBlank { "legacy-library-export.json" },
                payload = payload
            )
            _uiState.update {
                it.copy(
                    legacyImportFileName = selectedLegacyImport?.fileName,
                    legacyImportEntryCount = payload.entries.size,
                    status = "Legacy import ready: ${payload.entries.size} tracks",
                    error = null
                )
            }
        } catch (e: LegacyLibraryImportParseException) {
            selectedLegacyImport = null
            _uiState.update {
                it.copy(
                    legacyImportFileName = null,
                    legacyImportEntryCount = 0,
                    status = null,
                    error = "Legacy import failed: ${e.message}"
                )
            }
        }
    }

    fun onLegacyImportReadFailed(message: String) {
        selectedLegacyImport = null
        _uiState.update {
            it.copy(
                legacyImportFileName = null,
                legacyImportEntryCount = 0,
                status = null,
                error = message
            )
        }
    }

    fun clearLegacyImport() {
        selectedLegacyImport = null
        _uiState.update {
            it.copy(
                legacyImportFileName = null,
                legacyImportEntryCount = 0,
                status = null,
                error = null
            )
        }
    }

    fun signIn() {
        val state = _uiState.value
        val username = state.username.trim()
        val password = state.password.trim()
        if (username.isBlank() || password.isBlank()) {
            _uiState.update { it.copy(error = "Enter your Kitsu email/username and password.") }
            return
        }
        if (!serverSettingsStore.isConfigured) {
            _uiState.update { it.copy(error = "Configure your Anime Ongaku server URL in Settings first.") }
            return
        }
        viewModelScope.launch {
            var loggedIn = false
            _uiState.update { it.copy(isSubmitting = true, status = "Signing in...", error = null) }
            try {
                val session = authRepository.login(
                    username,
                    password,
                    deviceName(),
                    selectedLegacyImport?.payload
                )
                sessionStateManager.onInitialSync(session)
                loggedIn = true
                initialLibrarySync.runFullSync { progress ->
                    _uiState.update {
                        it.copy(status = progress.message, firstSync = progress.toUiState())
                    }
                }
                sessionStateManager.onLogin(session)
                _uiState.update {
                    it.copy(isSubmitting = false, password = "", status = null, firstSync = null)
                }
            } catch (e: Exception) {
                if (loggedIn) {
                    authRepository.clearSession()
                    sessionStateManager.onLogout()
                }
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        status = null,
                        firstSync = null,
                        error = e.toFriendReadableMessage("Sign-in failed")
                    )
                }
            }
        }
    }

    private fun deviceName(): String =
        listOf(Build.MANUFACTURER, Build.MODEL).joinToString(" ").trim().ifBlank { "Android" }

}

private data class SelectedLegacyImport(
    val fileName: String,
    val payload: OngakuLegacyLibraryImport
)
