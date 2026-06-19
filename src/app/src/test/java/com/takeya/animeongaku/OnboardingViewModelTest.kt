package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.OngakuAuthRepository
import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.ui.onboarding.OnboardingViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() { Dispatchers.setMain(dispatcher) }
    @After fun tearDown() { Dispatchers.resetMain() }

    private fun settings(configured: Boolean): ServerSettingsStore =
        ServerSettingsStore(FakeSharedPreferences()).apply {
            if (configured) serverBaseUrl = "https://ongaku.example"
        }

    private class FakeAuthRepo(
        private val result: ServerSession? = null,
        private val error: Exception? = null
    ) : OngakuAuthRepository {
        var loginCalls = 0
        override suspend fun login(username: String, password: String, deviceName: String): ServerSession {
            loginCalls++
            error?.let { throw it }
            return result!!
        }
        override fun currentSession(): ServerSession? = null
        override fun clearSession() = Unit
    }

    @Test
    fun `successful login notifies session state manager`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val tokenStore = ServerTokenStore(FakeSharedPreferences())
        val sessionState = SessionStateManager(tokenStore)
        val vm = OnboardingViewModel(FakeAuthRepo(result = session), sessionState, settings(true))

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(com.takeya.animeongaku.data.auth.SessionState.Active(session), sessionState.state.value)
    }

    @Test
    fun `blocks sign-in when server not configured`() = runTest(dispatcher) {
        val repo = FakeAuthRepo(result = ServerSession("t", "u", "n"))
        val vm = OnboardingViewModel(repo, SessionStateManager(ServerTokenStore(FakeSharedPreferences())), settings(false))

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(0, repo.loginCalls)
        assertNotNull(vm.uiState.value.error)
    }

    @Test
    fun `surfaces login error`() = runTest(dispatcher) {
        val vm = OnboardingViewModel(
            FakeAuthRepo(error = RuntimeException("bad creds")),
            SessionStateManager(ServerTokenStore(FakeSharedPreferences())),
            settings(true)
        )
        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        assertEquals(false, vm.uiState.value.isSubmitting)
    }
}
