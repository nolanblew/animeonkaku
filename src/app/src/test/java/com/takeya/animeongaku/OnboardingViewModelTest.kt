package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.auth.OngakuAuthRepository
import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.importer.LegacyLibraryImportParser
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImportEntry
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.InitialLibrarySync
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
import org.junit.Assert.assertTrue
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
        var cleared = false
        var legacyImport: OngakuLegacyLibraryImport? = null
        override suspend fun login(
            username: String,
            password: String,
            deviceName: String,
            legacyLibraryImport: OngakuLegacyLibraryImport?
        ): ServerSession {
            loginCalls++
            legacyImport = legacyLibraryImport
            error?.let { throw it }
            return result!!
        }
        override fun currentSession(): ServerSession? = null
        override fun clearSession() {
            cleared = true
        }
    }

    private fun parser(): LegacyLibraryImportParser =
        LegacyLibraryImportParser(
            Moshi.Builder()
                .add(KotlinJsonAdapterFactory())
                .build()
        )

    private class FakeInitialLibrarySync(
        private val error: Exception? = null
    ) : InitialLibrarySync {
        var calls = 0
        val statuses = mutableListOf<String>()

        override suspend fun runFullSync(onStatus: (String) -> Unit) {
            calls++
            onStatus("Server sync queued")
            statuses += "Server sync queued"
            error?.let { throw it }
            onStatus("Library ready")
            statuses += "Library ready"
        }
    }

    @Test
    fun `successful login runs first sync before activating session`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val tokenStore = ServerTokenStore(FakeSharedPreferences())
        val sessionState = SessionStateManager(tokenStore)
        val initialSync = FakeInitialLibrarySync()
        val vm = OnboardingViewModel(
            FakeAuthRepo(result = session),
            sessionState,
            settings(true),
            initialSync,
            parser()
        )

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(1, initialSync.calls)
        assertEquals(listOf("Server sync queued", "Library ready"), initialSync.statuses)
        assertEquals(SessionState.Active(session), sessionState.state.value)
        assertEquals("", vm.uiState.value.password)
        assertEquals(false, vm.uiState.value.isSubmitting)
    }

    @Test
    fun `blocks sign-in when server not configured`() = runTest(dispatcher) {
        val repo = FakeAuthRepo(result = ServerSession("t", "u", "n"))
        val initialSync = FakeInitialLibrarySync()
        val vm = OnboardingViewModel(
            repo,
            SessionStateManager(ServerTokenStore(FakeSharedPreferences())),
            settings(false),
            initialSync,
            parser()
        )

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(0, repo.loginCalls)
        assertEquals(0, initialSync.calls)
        assertNotNull(vm.uiState.value.error)
    }

    @Test
    fun `surfaces login error`() = runTest(dispatcher) {
        val vm = OnboardingViewModel(
            FakeAuthRepo(error = RuntimeException("bad creds")),
            SessionStateManager(ServerTokenStore(FakeSharedPreferences())),
            settings(true),
            FakeInitialLibrarySync(),
            parser()
        )
        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        assertEquals(false, vm.uiState.value.isSubmitting)
    }

    @Test
    fun `initial sync failure keeps user on onboarding and clears saved session`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val tokenStore = ServerTokenStore(FakeSharedPreferences())
        val sessionState = SessionStateManager(tokenStore)
        val repo = FakeAuthRepo(result = session)
        val vm = OnboardingViewModel(
            repo,
            sessionState,
            settings(true),
            FakeInitialLibrarySync(error = RuntimeException("server offline")),
            parser()
        )

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(repo.cleared)
        assertEquals(SessionState.LoggedOut, sessionState.state.value)
        assertNotNull(vm.uiState.value.error)
        assertEquals(false, vm.uiState.value.isSubmitting)
    }

    @Test
    fun `selected legacy import is sent with login request`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val repo = FakeAuthRepo(result = session)
        val vm = OnboardingViewModel(
            repo,
            SessionStateManager(ServerTokenStore(FakeSharedPreferences())),
            settings(true),
            FakeInitialLibrarySync(),
            parser()
        )

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.onLegacyImportFileSelected(
            fileName = "anime-ongaku-export.json",
            contents = """
                {
                  "userPreferences": [
                    { "themeId": 10, "isLiked": true, "isDisliked": false }
                  ],
                  "playCounts": [
                    { "themeId": 10, "playCount": 3, "lastPlayedAt": 1000 }
                  ]
                }
            """.trimIndent()
        )

        assertEquals("anime-ongaku-export.json", vm.uiState.value.legacyImportFileName)

        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(1, repo.loginCalls)
        assertEquals(
            OngakuLegacyLibraryImport(
                entries = listOf(
                    OngakuLegacyLibraryImportEntry(
                        themeId = 10,
                        liked = true,
                        disliked = false,
                        playCount = 3,
                        lastPlayedAt = 1000
                    )
                )
            ),
            repo.legacyImport
        )
    }
}
