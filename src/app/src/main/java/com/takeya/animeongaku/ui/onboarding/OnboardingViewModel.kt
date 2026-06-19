package com.takeya.animeongaku.ui.onboarding

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.auth.OngakuAuthRepository
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.server.ServerSettingsStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OnboardingUiState(
    val username: String = "",
    val password: String = "",
    val isSubmitting: Boolean = false,
    val error: String? = null
) {
    val canSubmit: Boolean get() = !isSubmitting && username.isNotBlank() && password.isNotBlank()
}

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val authRepository: OngakuAuthRepository,
    private val sessionStateManager: SessionStateManager,
    private val serverSettingsStore: ServerSettingsStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(OnboardingUiState())
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    fun onUsernameChange(value: String) {
        _uiState.update { it.copy(username = value.replace(Regex("[\\r\\n]"), ""), error = null) }
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(password = value.replace(Regex("[\\r\\n]"), ""), error = null) }
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
            _uiState.update { it.copy(isSubmitting = true, error = null) }
            try {
                val session = authRepository.login(username, password, deviceName())
                sessionStateManager.onLogin(session)
                _uiState.update { it.copy(isSubmitting = false, password = "") }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isSubmitting = false, error = readableError(e))
                }
            }
        }
    }

    private fun deviceName(): String =
        listOf(Build.MANUFACTURER, Build.MODEL).joinToString(" ").trim().ifBlank { "Android" }

    private fun readableError(e: Exception): String = when (e) {
        is retrofit2.HttpException -> "Sign-in failed (HTTP ${e.code()}). Check your credentials."
        else -> e.message?.let { "Sign-in failed: $it" } ?: "Sign-in failed. Please try again."
    }
}
