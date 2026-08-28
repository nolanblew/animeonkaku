package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.auth.OngakuAuthRepository
import com.takeya.animeongaku.data.auth.ServerLoginResult
import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerSyncMode
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.importer.LegacyLibraryImportParser
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImportEntry
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.FirstSyncProgress
import com.takeya.animeongaku.sync.FirstSyncStep
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
        private val error: Exception? = null,
        private val syncMode: ServerSyncMode = ServerSyncMode.FULL,
        private val isNewUser: Boolean = true
    ) : OngakuAuthRepository {
        var loginCalls = 0
        var cleared = false
        var logoutCalls = 0
        var legacyImport: OngakuLegacyLibraryImport? = null
        var lastUsername: String? = null
        var lastPassword: String? = null
        override suspend fun login(
            username: String,
            password: String,
            deviceName: String,
            legacyLibraryImport: OngakuLegacyLibraryImport?
        ): ServerLoginResult {
            loginCalls++
            lastUsername = username
            lastPassword = password
            legacyImport = legacyLibraryImport
            error?.let { throw it }
            return ServerLoginResult(session = result!!, syncMode = syncMode, isNewUser = isNewUser)
        }
        override fun currentSession(): ServerSession? = null
        override suspend fun logout() {
            logoutCalls++
            cleared = true
        }
        override fun clearSession() {
            cleared = true
        }
    }

    @Test
    fun `sign in trims the username but preserves password whitespace`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val repo = FakeAuthRepo(result = session)
        val vm = OnboardingViewModel(
            repo,
            SessionStateManager(ServerTokenStore(FakeSharedPreferences())),
            settings(true),
            FakeInitialLibrarySync(),
            parser()
        )

        vm.onUsernameChange("  nblew  ")
        vm.onPasswordChange("  password with spaces  ")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals("nblew", repo.lastUsername)
        assertEquals("  password with spaces  ", repo.lastPassword)
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
        var backgroundCalls = 0
        var lastMode: ServerSyncMode? = null
        val statuses = mutableListOf<String>()

        override suspend fun runInitialSync(
            mode: ServerSyncMode,
            onProgress: (FirstSyncProgress) -> Unit
        ) {
            calls++
            lastMode = mode
            onProgress(FirstSyncProgress(FirstSyncStep.SyncLibrary, "Server sync queued"))
            statuses += "Server sync queued"
            error?.let { throw it }
            onProgress(FirstSyncProgress(FirstSyncStep.LoadDevice, "Library ready"))
            statuses += "Library ready"
        }

        override fun startBackgroundSync(mode: ServerSyncMode) {
            backgroundCalls++
            lastMode = mode
        }
    }

    @Test
    fun `returning user with a local cache enters immediately while refresh continues`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val tokenStore = ServerTokenStore(FakeSharedPreferences())
        val sessionState = SessionStateManager(tokenStore)
        val initialSync = FakeInitialLibrarySync()
        val configuredSettings = settings(true).apply { serverPullCursor = 42L }
        val vm = OnboardingViewModel(
            FakeAuthRepo(
                result = session,
                syncMode = ServerSyncMode.DELTA,
                isNewUser = false
            ),
            sessionState,
            configuredSettings,
            initialSync,
            parser()
        )

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(SessionState.Active(session), sessionState.state.value)
        assertEquals(0, initialSync.calls)
        assertEquals(1, initialSync.backgroundCalls)
        assertEquals(ServerSyncMode.DELTA, initialSync.lastMode)
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
        assertEquals(null, vm.uiState.value.firstSync)
    }

    @Test
    fun `first sync progress drives the first sync ui state`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val sessionState = SessionStateManager(ServerTokenStore(FakeSharedPreferences()))
        val sync = object : InitialLibrarySync {
            override suspend fun runInitialSync(
                mode: ServerSyncMode,
                onProgress: (FirstSyncProgress) -> Unit
            ) {
                onProgress(FirstSyncProgress(FirstSyncStep.SyncLibrary, "Server sync: syncing library"))
                kotlinx.coroutines.delay(1)
                onProgress(FirstSyncProgress(FirstSyncStep.MatchThemes, "Server sync: mapping themes"))
                kotlinx.coroutines.delay(1)
                onProgress(FirstSyncProgress(FirstSyncStep.LoadDevice, "Library ready"))
            }
        }
        val vm = OnboardingViewModel(
            FakeAuthRepo(result = session),
            sessionState,
            settings(true),
            sync,
            parser()
        )

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()

        dispatcher.scheduler.runCurrent()
        val step1 = vm.uiState.value.firstSync
        assertNotNull(step1)
        assertEquals(1, step1?.stepNumber)
        assertEquals(3, step1?.totalSteps)

        dispatcher.scheduler.advanceTimeBy(1)
        dispatcher.scheduler.runCurrent()
        assertEquals(2, vm.uiState.value.firstSync?.stepNumber)

        dispatcher.scheduler.advanceUntilIdle()
        // Cleared once the sync finishes so the app can leave the first-sync screen.
        assertEquals(null, vm.uiState.value.firstSync)
    }

    @Test
    fun `delta login runs a delta initial sync and flags the ui state as delta`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val sessionState = SessionStateManager(ServerTokenStore(FakeSharedPreferences()))
        var receivedMode: ServerSyncMode? = null
        val sync = object : InitialLibrarySync {
            override suspend fun runInitialSync(
                mode: ServerSyncMode,
                onProgress: (FirstSyncProgress) -> Unit
            ) {
                receivedMode = mode
                onProgress(FirstSyncProgress(FirstSyncStep.SyncLibrary, "Checking for library updates..."))
                kotlinx.coroutines.delay(1)
                onProgress(FirstSyncProgress(FirstSyncStep.LoadDevice, "Library ready"))
            }
        }
        val vm = OnboardingViewModel(
            FakeAuthRepo(result = session, syncMode = ServerSyncMode.DELTA),
            sessionState,
            settings(true),
            sync,
            parser()
        )

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()

        dispatcher.scheduler.runCurrent()
        assertEquals(true, vm.uiState.value.firstSync?.isDelta)

        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(ServerSyncMode.DELTA, receivedMode)
        assertEquals(null, vm.uiState.value.firstSync)
        assertEquals(SessionState.Active(session), sessionState.state.value)
    }

    @Test
    fun `first sync failure clears the first sync ui state`() = runTest(dispatcher) {
        val session = ServerSession("tok", "uid", "nblew")
        val sync = object : InitialLibrarySync {
            override suspend fun runInitialSync(
                mode: ServerSyncMode,
                onProgress: (FirstSyncProgress) -> Unit
            ) {
                onProgress(FirstSyncProgress(FirstSyncStep.SyncLibrary, "Server sync queued"))
                throw RuntimeException("server offline")
            }
        }
        val vm = OnboardingViewModel(
            FakeAuthRepo(result = session),
            SessionStateManager(ServerTokenStore(FakeSharedPreferences())),
            settings(true),
            sync,
            parser()
        )

        vm.onUsernameChange("nblew")
        vm.onPasswordChange("pw")
        vm.signIn()
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(null, vm.uiState.value.firstSync)
        assertNotNull(vm.uiState.value.error)
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
        assertEquals(1, repo.logoutCalls)
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
