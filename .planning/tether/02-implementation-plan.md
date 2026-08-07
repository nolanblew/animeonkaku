# Tether Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Anime Ongaku session effectively permanent (no spurious re-logins), gate signed-out users behind a polished onboarding/login screen, and degrade gracefully to downloaded-only playback when the server genuinely rejects the token.

**Architecture:** Introduce a single source of truth for auth state (`SessionStateManager`) that the interceptor reports into (instead of wiping the token on every 401) and the root UI observes to switch between onboarding, the full app, and a degraded "downloaded-only" mode. Move the token + server settings off fragile `EncryptedSharedPreferences` to plain storage with a one-time migration. Make server sessions non-expiring.

**Tech Stack:** Kotlin, Jetpack Compose, Hilt, OkHttp interceptors, Media3, Room, JUnit (Android unit tests with Robolectric-free fakes); server is Node/TypeScript + Fastify + Vitest.

---

## Conventions for this plan

**Android unit tests** run from `src/`. On this Windows workspace, set the toolchain once per shell before running gradle:

```powershell
$env:ANDROID_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:JAVA_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\openjdk\jdk-21.0.8'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;C:\Windows\System32;$env:Path"
```

Then run a single test class with (from `src/`): `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.SomeTest"`

**Server checks** run from `server/`:
```powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit
```

**Commits:** keep messages in the repo's existing style (short imperative subject). End each commit message body with the standard footer:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014iMLpENBRJ8PdZdNxQBZRD
```

**Package root:** `com.takeya.animeongaku` at `src/app/src/main/java/com/takeya/animeongaku/`. Tests live at `src/app/src/test/java/com/takeya/animeongaku/`.

---

# Phase 1 — Session state source of truth

### Task 1: `SessionState` + `SessionStateManager`

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/data/auth/SessionState.kt`
- Create: `src/app/src/main/java/com/takeya/animeongaku/data/auth/SessionStateManager.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/SessionStateManagerTest.kt`

- [ ] **Step 1: Write the failing test**

Create `SessionStateManagerTest.kt`:

```kotlin
package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionStateManagerTest {

    private fun store(session: ServerSession? = null): ServerTokenStore =
        ServerTokenStore(FakeSharedPreferences()).apply { session?.let { save(it) } }

    private val sampleSession = ServerSession("tok", "uid-1", "nblew")

    @Test
    fun `starts logged out when no token stored`() {
        val manager = SessionStateManager(store())
        assertEquals(SessionState.LoggedOut, manager.state.value)
    }

    @Test
    fun `starts active when a token is stored`() {
        val manager = SessionStateManager(store(sampleSession))
        assertEquals(SessionState.Active(sampleSession), manager.state.value)
    }

    @Test
    fun `markUnauthorized moves active to reauth required and keeps the token`() {
        val tokenStore = store(sampleSession)
        val manager = SessionStateManager(tokenStore)
        manager.markUnauthorized()
        assertEquals(SessionState.ReauthRequired(sampleSession), manager.state.value)
        assertEquals("tok", tokenStore.currentToken())
    }

    @Test
    fun `markAuthorized recovers reauth required back to active`() {
        val manager = SessionStateManager(store(sampleSession))
        manager.markUnauthorized()
        manager.markAuthorized()
        assertEquals(SessionState.Active(sampleSession), manager.state.value)
    }

    @Test
    fun `markUnauthorized is a no-op when logged out`() {
        val manager = SessionStateManager(store())
        manager.markUnauthorized()
        assertEquals(SessionState.LoggedOut, manager.state.value)
    }

    @Test
    fun `onLogin becomes active and onLogout clears token and becomes logged out`() {
        val tokenStore = store()
        val manager = SessionStateManager(tokenStore)
        tokenStore.save(sampleSession)
        manager.onLogin(sampleSession)
        assertEquals(SessionState.Active(sampleSession), manager.state.value)

        manager.onLogout()
        assertEquals(SessionState.LoggedOut, manager.state.value)
        assertNull(tokenStore.currentToken())
    }

    @Test
    fun `isOnlineEnabled only true when active`() {
        val manager = SessionStateManager(store(sampleSession))
        assert(manager.isOnlineEnabled())
        manager.markUnauthorized()
        assert(!manager.isOnlineEnabled())
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.SessionStateManagerTest"`
Expected: FAIL — `SessionState` / `SessionStateManager` unresolved.

- [ ] **Step 3: Create `SessionState.kt`**

```kotlin
package com.takeya.animeongaku.data.auth

sealed interface SessionState {
    /** No token stored — fresh install or explicit sign-out. */
    data object LoggedOut : SessionState

    /** Token stored and currently accepted by the server. */
    data class Active(val session: ServerSession) : SessionState

    /** Token stored but the server rejected it (e.g. server-side token reset). */
    data class ReauthRequired(val session: ServerSession) : SessionState
}
```

- [ ] **Step 4: Create `SessionStateManager.kt`**

```kotlin
package com.takeya.animeongaku.data.auth

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Single source of truth for authentication state. The interceptor reports 401/2xx
 * outcomes here (it never clears the token directly), and the root UI observes [state]
 * to switch between onboarding, the full app, and degraded downloaded-only mode.
 */
@Singleton
class SessionStateManager @Inject constructor(
    private val tokenStore: ServerTokenStore
) {
    private val _state = MutableStateFlow(initialState())
    val state: StateFlow<SessionState> = _state.asStateFlow()

    private fun initialState(): SessionState {
        val session = tokenStore.currentSession()
        return if (session != null) SessionState.Active(session) else SessionState.LoggedOut
    }

    fun onLogin(session: ServerSession) {
        _state.value = SessionState.Active(session)
    }

    fun onLogout() {
        tokenStore.clear()
        _state.value = SessionState.LoggedOut
    }

    /** A 401 on a request that carried a bearer token. Keeps the token. */
    fun markUnauthorized() {
        _state.update { current ->
            when (current) {
                is SessionState.Active -> SessionState.ReauthRequired(current.session)
                else -> current
            }
        }
    }

    /** A successful authenticated response — recovers from a transient 401. */
    fun markAuthorized() {
        _state.update { current ->
            when (current) {
                is SessionState.ReauthRequired -> SessionState.Active(current.session)
                else -> current
            }
        }
    }

    /** Online features (sync, online search, remote streaming) are allowed only when Active. */
    fun isOnlineEnabled(): Boolean = _state.value is SessionState.Active
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.SessionStateManagerTest"`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/data/auth/SessionState.kt \
        src/app/src/main/java/com/takeya/animeongaku/data/auth/SessionStateManager.kt \
        src/app/src/test/java/com/takeya/animeongaku/SessionStateManagerTest.kt
git commit -m "Add SessionStateManager as auth state source of truth"
```

---

# Phase 2 — Durable plain-storage token + migration

### Task 2: One-time storage migrator (encrypted → plain)

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/data/auth/SessionStorageMigrator.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/SessionStorageMigratorTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.SessionStorageMigrator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStorageMigratorTest {

    @Test
    fun `copies token and server keys from legacy store on first run`() {
        val legacy = FakeSharedPreferences().apply {
            edit()
                .putString("ongaku_server_token", "legacy-token")
                .putString("ongaku_server_kitsu_user_id", "uid-9")
                .putString("ongaku_server_username", "nblew")
                .putString("ongaku_server_base_url", "https://ongaku.example/")
                .putLong("ongaku_server_pull_cursor", 42L)
                .apply()
        }
        val session = FakeSharedPreferences()

        SessionStorageMigrator(session, legacy).migrateIfNeeded()

        assertEquals("legacy-token", session.getString("ongaku_server_token", null))
        assertEquals("uid-9", session.getString("ongaku_server_kitsu_user_id", null))
        assertEquals("https://ongaku.example/", session.getString("ongaku_server_base_url", null))
        assertEquals(42L, session.getLong("ongaku_server_pull_cursor", 0L))
    }

    @Test
    fun `does not re-copy after migration flag is set`() {
        val legacy = FakeSharedPreferences().apply {
            edit().putString("ongaku_server_token", "legacy-token").apply()
        }
        val session = FakeSharedPreferences()
        val migrator = SessionStorageMigrator(session, legacy)

        migrator.migrateIfNeeded()
        // User signs out -> session token cleared
        session.edit().remove("ongaku_server_token").apply()
        // Second run must NOT resurrect the legacy token
        migrator.migrateIfNeeded()

        assertNull(session.getString("ongaku_server_token", null))
    }

    @Test
    fun `survives a legacy store that throws on read`() {
        val throwing = object : android.content.SharedPreferences by FakeSharedPreferences() {
            override fun getAll(): MutableMap<String, *> = throw IllegalStateException("corrupt keyset")
            override fun contains(key: String): Boolean = throw IllegalStateException("corrupt keyset")
        }
        val session = FakeSharedPreferences()

        SessionStorageMigrator(session, throwing).migrateIfNeeded()

        // No crash, migration flag still set so we never retry the broken store
        assertTrue(session.getBoolean("tether_storage_migrated", false))
        assertNull(session.getString("ongaku_server_token", null))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.SessionStorageMigratorTest"`
Expected: FAIL — `SessionStorageMigrator` unresolved.

- [ ] **Step 3: Create `SessionStorageMigrator.kt`**

```kotlin
package com.takeya.animeongaku.data.auth

import android.content.SharedPreferences
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * One-time copy of the session token and server settings from the legacy
 * EncryptedSharedPreferences store into a plain store. EncryptedSharedPreferences'
 * keyset is fragile across app updates/restores; once it corrupts, the token is lost.
 * Reading the legacy store is wrapped in runCatching so a corrupt keyset degrades to
 * "no prior token" instead of crashing.
 */
@Singleton
class SessionStorageMigrator @Inject constructor(
    @Named("session") private val sessionPrefs: SharedPreferences,
    @Named("legacyEncrypted") private val legacyPrefs: SharedPreferences
) {
    fun migrateIfNeeded() {
        if (sessionPrefs.getBoolean(KEY_MIGRATED, false)) return
        runCatching {
            val editor = sessionPrefs.edit()
            val all = legacyPrefs.all
            for (key in MIGRATED_KEYS) {
                when (val value = all[key]) {
                    is String -> editor.putString(key, value)
                    is Long -> editor.putLong(key, value)
                    is Boolean -> editor.putBoolean(key, value)
                }
            }
            editor.apply()
        }
        // Always set the flag, even if the legacy store threw, so we never retry it.
        sessionPrefs.edit().putBoolean(KEY_MIGRATED, true).apply()
    }

    companion object {
        private const val KEY_MIGRATED = "tether_storage_migrated"
        private val MIGRATED_KEYS = listOf(
            "ongaku_server_token",
            "ongaku_server_kitsu_user_id",
            "ongaku_server_username",
            "ongaku_server_base_url",
            "ongaku_server_pull_cursor",
            "ongaku_server_last_pull_at",
            "ongaku_server_migration_complete"
        )
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.SessionStorageMigratorTest"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/data/auth/SessionStorageMigrator.kt \
        src/app/src/test/java/com/takeya/animeongaku/SessionStorageMigratorTest.kt
git commit -m "Add one-time session storage migrator off encrypted prefs"
```

### Task 3: Wire DI to plain storage + run migration at app startup

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/di/NetworkModule.kt:171-198`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/AnimeOngakuApp.kt`

Note: only `provideServerSettingsStore` and `provideServerTokenStore` consume the unqualified
`SharedPreferences` (verified — `DownloadPreferences` and `AppUpdateManager` build their own
from `Context`). So qualifying the encrypted provider is safe.

- [ ] **Step 1: Replace the prefs providers in `NetworkModule.kt`**

Replace the existing `provideEncryptedPreferences`, `provideServerSettingsStore`, and
`provideServerTokenStore` (lines ~171-198) with:

```kotlin
    @Provides
    @Singleton
    @Named("legacyEncrypted")
    fun provideLegacyEncryptedPreferences(
        @ApplicationContext context: Context
    ): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            "kitsu_auth_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    @Provides
    @Singleton
    @Named("session")
    fun provideSessionPreferences(
        @ApplicationContext context: Context
    ): SharedPreferences =
        context.getSharedPreferences("ongaku_session_prefs", Context.MODE_PRIVATE)

    @Provides
    @Singleton
    fun provideServerSettingsStore(
        @Named("session") prefs: SharedPreferences
    ): ServerSettingsStore {
        return ServerSettingsStore(prefs, BuildConfig.ONGAKU_SERVER_BASE_URL)
    }

    @Provides
    @Singleton
    fun provideServerTokenStore(
        @Named("session") prefs: SharedPreferences
    ): ServerTokenStore {
        return ServerTokenStore(prefs)
    }
```

Add `import javax.inject.Named` to the imports if not already present. Keep the existing
`import android.content.Context`.

- [ ] **Step 2: Run migration before anything reads the stores**

In `AnimeOngakuApp.kt` (the `@HiltAndroidApp class AnimeOngakuApp`), inject the migrator and
call it first in `onCreate`:

```kotlin
    @Inject lateinit var sessionStorageMigrator: com.takeya.animeongaku.data.auth.SessionStorageMigrator

    override fun onCreate() {
        sessionStorageMigrator.migrateIfNeeded()
        super.onCreate()
        // ...existing onCreate body remains below...
    }
```

If `onCreate` already exists, add the `migrateIfNeeded()` call as the very first statement
(before `super.onCreate()` is fine — field injection for `@HiltAndroidApp` is available at
that point; if the worker observes an injection-timing issue, move it to immediately after
`super.onCreate()`). Add `import javax.inject.Inject` if missing.

- [ ] **Step 3: Build to verify DI graph compiles**

Run: `./gradlew.bat --no-daemon :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL (Hilt resolves `@Named("session")` and `@Named("legacyEncrypted")`).

- [ ] **Step 4: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/di/NetworkModule.kt \
        src/app/src/main/java/com/takeya/animeongaku/AnimeOngakuApp.kt
git commit -m "Store session token + server settings in plain prefs with startup migration"
```

---

# Phase 3 — Interceptor reports instead of wiping the token

### Task 4: `OngakuAuthInterceptor` reports 401/2xx to `SessionStateManager`

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/network/OngakuAuthInterceptor.kt`
- Modify: `src/app/src/test/java/com/takeya/animeongaku/OngakuInterceptorsTest.kt:103-117` (replace the 401-clears test) and `:84-101` / `:88` (constructor calls)

- [ ] **Step 1: Update the interceptor tests**

In `OngakuInterceptorsTest.kt`, the `auth interceptor adds bearer token` test constructs
`OngakuAuthInterceptor(tokenStore)`. Update it to pass a `SessionStateManager`, and replace
the `clears server session on 401` test with two new tests. Apply these edits:

Add imports at the top:
```kotlin
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
```

Replace the body of `auth interceptor adds bearer token` so the interceptor is built as:
```kotlin
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("opaque-token", "12345", "nblewtest"))
        }
        val interceptor = OngakuAuthInterceptor(tokenStore, SessionStateManager(tokenStore))
```
(the rest of that test is unchanged).

Replace the entire `auth interceptor clears server session on 401` test with:
```kotlin
    @Test
    fun `auth interceptor keeps token and flags reauth on 401`() {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("opaque-token", "12345", "nblewtest"))
        }
        val sessionState = SessionStateManager(tokenStore)
        val interceptor = OngakuAuthInterceptor(tokenStore, sessionState)
        val original = Request.Builder()
            .url("https://ongaku.local/v1/auth/me")
            .get()
            .build()

        interceptor.intercept(fakeChain(original) { request -> fakeResponse(401, request) }).close()

        assertEquals("opaque-token", tokenStore.currentToken())
        assertEquals(SessionState.ReauthRequired(ServerSession("opaque-token", "12345", "nblewtest")), sessionState.state.value)
    }

    @Test
    fun `auth interceptor recovers reauth state on a successful response`() {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("opaque-token", "12345", "nblewtest"))
        }
        val sessionState = SessionStateManager(tokenStore)
        sessionState.markUnauthorized()
        val interceptor = OngakuAuthInterceptor(tokenStore, sessionState)
        val original = Request.Builder().url("https://ongaku.local/v1/auth/me").get().build()

        interceptor.intercept(fakeChain(original) { request -> fakeResponse(200, request) }).close()

        assert(sessionState.state.value is SessionState.Active)
    }
```

Remove the now-unused `import org.junit.Assert.assertNull` only if no other test uses it
(the base-url test does not; the media tests do not — so remove it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.OngakuInterceptorsTest"`
Expected: FAIL — `OngakuAuthInterceptor` constructor takes one argument / `SessionStateManager` not a param.

- [ ] **Step 3: Update `OngakuAuthInterceptor.kt`**

```kotlin
package com.takeya.animeongaku.network

import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.Interceptor
import okhttp3.Response

@Singleton
class OngakuAuthInterceptor @Inject constructor(
    private val tokenStore: ServerTokenStore,
    private val sessionStateManager: SessionStateManager
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenStore.currentToken()
        if (token.isNullOrBlank()) {
            // No bearer to attach (e.g. the login request) — never touch session state.
            return chain.proceed(chain.request())
        }

        val request = chain.request().newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        val response = chain.proceed(request)

        when {
            response.code == 401 -> sessionStateManager.markUnauthorized()
            response.isSuccessful -> sessionStateManager.markAuthorized()
        }
        return response
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.OngakuInterceptorsTest"`
Expected: PASS (all interceptor tests, including the two new auth tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/network/OngakuAuthInterceptor.kt \
        src/app/src/test/java/com/takeya/animeongaku/OngakuInterceptorsTest.kt
git commit -m "Report 401/2xx to SessionStateManager instead of wiping the token"
```

---

# Phase 4 — Server: non-expiring sessions

### Task 5: Make server sessions effectively non-expiring

**Files:**
- Modify: `server/src/auth/service.ts:9`
- Verify: `server/test/auth.routes.test.ts:148-155` (TTL test still passes) and `:113-124` (expired-session test still passes)

- [ ] **Step 1: Update the TTL constant**

In `server/src/auth/service.ts`, change line 9 from:
```ts
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days (doc 04)
```
to:
```ts
// Sessions are effectively non-expiring for this personal deployment. The token only
// becomes invalid via explicit logout, device revoke, or a deliberate server-side reset
// (deleting session rows). 100 years keeps the existing non-null expiresAt column.
export const SESSION_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000;
```

No other code changes: `login()` already sets `expiresAt = new Date(Date.now() + SESSION_TTL_MS)`,
and `authenticate()` already returns `null` for missing/expired/deleted sessions, so a manual
server-side reset still produces a clean 401.

- [ ] **Step 2: Run the server tests**

Run (from `server/`): `& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run`
Expected: PASS. The "creates a session with the documented TTL" test asserts the issued TTL
is within 60s of `SESSION_TTL_MS` (still true), and "rejects expired sessions" forces a past
`expiresAt` manually (still 401).

- [ ] **Step 3: Type-check**

Run (from `server/`): `& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/auth/service.ts
git commit -m "Issue effectively non-expiring server sessions"
```

---

# Phase 5 — Onboarding/login gate

### Task 6: Shared sign-in ViewModel for onboarding

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/OnboardingViewModel.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/OnboardingViewModelTest.kt`

This ViewModel owns ONLY login (username/password/submit) and reports success into
`SessionStateManager.onLogin`. It deliberately does not do sync — sync stays in
`ImportViewModel` and runs after the app appears.

- [ ] **Step 1: Write the failing test**

```kotlin
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.OnboardingViewModelTest"`
Expected: FAIL — `OnboardingViewModel` unresolved.

- [ ] **Step 3: Create `OnboardingViewModel.kt`**

```kotlin
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.OnboardingViewModelTest"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/OnboardingViewModel.kt \
        src/app/src/test/java/com/takeya/animeongaku/OnboardingViewModelTest.kt
git commit -m "Add OnboardingViewModel for the login gate"
```

### Task 7: Onboarding/login screen UI

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/OnboardingScreen.kt`

No new test (Compose UI). The screen mirrors the existing `ImportScreen` sign-in styling
(Ink/Mist/Rose palette, rounded cards) but stands alone full-screen.

- [ ] **Step 1: Create `OnboardingScreen.kt`**

```kotlin
package com.takeya.animeongaku.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.BuildConfig
import com.takeya.animeongaku.ui.theme.Ember400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnboardingScreen(
    onOpenServerSettings: () -> Unit,
    viewModel: OnboardingViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val backgroundGradient = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    val submit: () -> Unit = {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
        viewModel.signIn()
    }

    val textFieldColors = TextFieldDefaults.colors(
        focusedTextColor = Mist100,
        unfocusedTextColor = Mist100,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        focusedIndicatorColor = Rose500,
        unfocusedIndicatorColor = Mist200.copy(alpha = 0.5f),
        focusedLabelColor = Mist200,
        unfocusedLabelColor = Mist200,
        cursorColor = Rose500
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundGradient)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp, vertical = 48.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Spacer(Modifier.height(24.dp))

            // Branding
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .background(Rose500.copy(alpha = 0.18f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Rounded.MusicNote, contentDescription = null, tint = Rose500)
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text("Anime Ongaku", style = MaterialTheme.typography.headlineSmall, color = Mist100, fontWeight = FontWeight.Bold)
                    Text("Your anime opening & ending library", style = MaterialTheme.typography.bodyMedium, color = Mist200)
                }
            }

            // How it works
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Ink800.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                    .border(1.dp, Mist200.copy(alpha = 0.12f), RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("How it works", style = MaterialTheme.typography.titleMedium, color = Mist100)
                HowItWorksRow("1", "Sign in with your Kitsu account.")
                HowItWorksRow("2", "Your anime list syncs and builds a library of OPs, EDs & OSTs.")
                HowItWorksRow("3", "Stream or download themes to listen anytime.")
            }

            // Sign-in card
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Ink800.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                    .border(1.dp, Mist200.copy(alpha = 0.12f), RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("Sign in to Kitsu", style = MaterialTheme.typography.titleMedium, color = Mist100)
                OutlinedTextField(
                    value = uiState.username,
                    onValueChange = viewModel::onUsernameChange,
                    label = { Text("Email or username") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = Mist100),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    colors = textFieldColors
                )
                OutlinedTextField(
                    value = uiState.password,
                    onValueChange = viewModel::onPasswordChange,
                    label = { Text("Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = Mist100),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    colors = textFieldColors
                )
                uiState.error?.let { error ->
                    Text(error, style = MaterialTheme.typography.bodySmall, color = Rose500)
                }
                Button(
                    onClick = submit,
                    enabled = uiState.canSubmit,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Rose500,
                        contentColor = Ink900,
                        disabledContainerColor = Rose500.copy(alpha = 0.4f)
                    )
                ) {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Ink900, strokeWidth = 2.dp)
                    } else {
                        Text("Sign In", color = Ink900, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            if (BuildConfig.DEBUG) {
                TextButton(onClick = onOpenServerSettings) {
                    Text("Server settings", color = Ember400)
                }
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun HowItWorksRow(number: String, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier.size(24.dp).background(Ember400.copy(alpha = 0.2f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(number, style = MaterialTheme.typography.labelMedium, color = Ember400, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Mist200)
    }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `./gradlew.bat --no-daemon :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/OnboardingScreen.kt
git commit -m "Add onboarding/login screen UI"
```

### Task 8: Gate the root on `SessionState`

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt`
- Test: `src/app/src/test/java/com/takeya/animeongaku/ui/NavigationRoutesTest.kt` (only if it references a route map — leave untouched if it does not need the new route)

The root composable gains a `sessionState` parameter (collected from `SessionStateManager`).
When `LoggedOut`, it renders only `OnboardingScreen` (plus, in debug, a reachable settings
screen for the server URL). Otherwise it renders the existing app. The injection of
`SessionStateManager` into the composable is done via a tiny holder ViewModel so the
composable stays previewable.

- [ ] **Step 1: Add a root session ViewModel**

Create `src/app/src/main/java/com/takeya/animeongaku/ui/RootSessionViewModel.kt`:

```kotlin
package com.takeya.animeongaku.ui

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.data.auth.SessionStateManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow

@HiltViewModel
class RootSessionViewModel @Inject constructor(
    sessionStateManager: SessionStateManager
) : ViewModel() {
    val sessionState: StateFlow<SessionState> = sessionStateManager.state
}
```

- [ ] **Step 2: Branch the root composable**

In `AnimeOngakuApp.kt`, at the top of `fun AnimeOngakuApp(...)` (after the existing
`appUpdateViewModel` parameter is in scope), collect the session state and branch before
building the main `Box`/`Scaffold`. Add these imports:

```kotlin
import com.takeya.animeongaku.data.auth.SessionState
import com.takeya.animeongaku.ui.onboarding.OnboardingScreen
```

(`hiltViewModel` and `SettingsScreen` are already imported in this file — do not duplicate
them; add only the two imports above.) Then add a `rootSessionViewModel`
parameter with a default and the branch. Change the signature to:

```kotlin
@Composable
fun AnimeOngakuApp(
    pendingNavigateTo: androidx.compose.runtime.MutableState<String?>? = null,
    appUpdateViewModel: AppUpdateViewModel,
    rootSessionViewModel: RootSessionViewModel = hiltViewModel()
) {
    val sessionState by rootSessionViewModel.sessionState.collectAsStateWithLifecycle()

    if (sessionState is SessionState.LoggedOut) {
        LoggedOutGate()
        return
    }
    // ...existing body unchanged...
```

Note: the `AppPreview` in `MainActivity.kt` calls `AnimeOngakuApp()` with no args — it will now
require the parameters to have defaults or be updated. `appUpdateViewModel` has no default;
the preview already omits it (it calls `AnimeOngakuApp()` which is a different no-arg overload
created by the lint). If `AppPreview` fails to compile, update it to remove the body or guard
with `@Preview` stub; simplest fix: delete the `AppPreview` composable in `MainActivity.kt`
(it is preview-only and already inconsistent with the required `appUpdateViewModel` param).

- [ ] **Step 3: Add the `LoggedOutGate` composable**

At the bottom of `AnimeOngakuApp.kt` add:

```kotlin
@Composable
private fun LoggedOutGate() {
    if (!com.takeya.animeongaku.BuildConfig.DEBUG) {
        OnboardingScreen(onOpenServerSettings = {})
        return
    }
    // Debug-only: allow reaching a limited settings screen for the server URL.
    val gateNav = rememberNavController()
    NavHost(navController = gateNav, startDestination = "onboarding") {
        composable("onboarding") {
            OnboardingScreen(onOpenServerSettings = { gateNav.navigate("gateSettings") })
        }
        composable("gateSettings") {
            SettingsScreen(
                onBack = { gateNav.popBackStack() },
                onOpenImport = {},
                onOpenDownloadManager = {},
                updaterEnabled = false,
                isCheckingForUpdates = false,
                availableUpdate = null,
                onCheckForUpdates = {},
                onDownloadUpdate = {},
                onOpenReleasePage = {}
            )
        }
    }
}
```

(`rememberNavController`, `NavHost`, `composable` are already imported in this file.)

- [ ] **Step 4: Build to verify it compiles**

Run: `./gradlew.bat --no-daemon :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL. If `AppPreview` breaks, apply the fix noted in Step 2.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Install debug build, clear app data, launch → onboarding appears with no bottom bar. Sign in →
the app appears. (`./gradlew.bat --no-daemon installDebug`.)

- [ ] **Step 6: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/ui/RootSessionViewModel.kt \
        src/app/src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt \
        src/app/src/main/java/com/takeya/animeongaku/MainActivity.kt
git commit -m "Gate the app root behind onboarding when logged out"
```

---

# Phase 6 — Degraded downloaded-only mode

### Task 9: Block remote playback when not Active

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/media/NowPlayingManager.kt:13` (constructor) and `:49-57` (`play` entry)
- Test: `src/app/src/test/java/com/takeya/animeongaku/NowPlayingManagerDegradedTest.kt`

`NowPlayingManager` is the single choke point for starting playback. When the session is not
Active, it filters the incoming theme list to downloaded-only before building the queue. If
nothing is downloaded, `play` becomes a no-op (the banner explains why).

- [ ] **Step 1: Write the failing test**

```kotlin
package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import org.junit.Assert.assertEquals
import org.junit.Test

class NowPlayingManagerDegradedTest {

    private fun theme(id: Long, downloaded: Boolean) = ThemeEntity(
        id = id,
        animeId = null,
        title = "t$id",
        artistName = null,
        audioUrl = "https://server/v1/media/audio/$id",
        videoUrl = null,
        isDownloaded = downloaded,
        localFilePath = if (downloaded) "/data/$id.mp3" else null,
        themeType = "OP"
    )

    private fun manager(active: Boolean): NowPlayingManager {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "n"))
        }
        val state = SessionStateManager(tokenStore)
        if (!active) state.markUnauthorized()
        return NowPlayingManager(state)
    }

    @Test
    fun `active mode plays all themes`() {
        val npm = manager(active = true)
        npm.play("ctx", listOf(theme(1, false), theme(2, false)), startIndex = 0)
        assertEquals(2, npm.state.value.nowPlayingEntries.size)
    }

    @Test
    fun `degraded mode keeps only downloaded themes`() {
        val npm = manager(active = false)
        npm.play("ctx", listOf(theme(1, false), theme(2, true), theme(3, false)), startIndex = 0)
        val ids = npm.state.value.nowPlayingEntries.map { it.theme.id }
        assertEquals(listOf(2L), ids)
    }

    @Test
    fun `degraded mode with no downloads is a no-op`() {
        val npm = manager(active = false)
        npm.play("ctx", listOf(theme(1, false)), startIndex = 0)
        assertEquals(0, npm.state.value.nowPlayingEntries.size)
    }
}
```

Verify the `ThemeEntity(...)` constructor argument names/positions against
`data/local/ThemeEntity.kt` before running; adjust the test factory to match the actual
required fields (the entity may have additional non-null fields with defaults).

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.NowPlayingManagerDegradedTest"`
Expected: FAIL — `NowPlayingManager` constructor takes no args.

- [ ] **Step 3: Inject `SessionStateManager` and filter in `play`**

In `NowPlayingManager.kt` change the class declaration:

```kotlin
@Singleton
class NowPlayingManager @Inject constructor(
    private val sessionStateManager: com.takeya.animeongaku.data.auth.SessionStateManager
) {
```

At the very start of `fun play(...)`, after `if (themes.isEmpty()) return`, add:

```kotlin
        val playable = if (sessionStateManager.isOnlineEnabled()) {
            themes
        } else {
            themes.filter { it.isDownloaded && !it.localFilePath.isNullOrBlank() }
        }
        if (playable.isEmpty()) return
```

Then use `playable` instead of `themes` for the rest of the method (the next line builds
`createQueueEntries(themes)` — change it and any later `themes` references in `play` to
`playable`; `startIndex` should be coerced into `playable.indices` — replace the start index
usage with `startIndex.coerceIn(0, playable.lastIndex)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.NowPlayingManagerDegradedTest"`
Expected: PASS (3 tests). Also re-run the existing `NowPlayingManagerTest` to confirm no
regression: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.NowPlayingManagerTest"`.

- [ ] **Step 5: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/media/NowPlayingManager.kt \
        src/app/src/test/java/com/takeya/animeongaku/NowPlayingManagerDegradedTest.kt
git commit -m "Restrict playback to downloaded themes in degraded mode"
```

### Task 10: Gate sync on Active

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/sync/LibraryPullManager.kt:17-40` (constructor + `pullIfStale`/`pullNow` guard)
- Modify: `src/app/src/main/java/com/takeya/animeongaku/MainActivity.kt:52-89,105-111` (don't start periodic pull unless Active)
- Test: extend `src/app/src/test/java/com/takeya/animeongaku/LibraryPullManagerTest.kt`

- [ ] **Step 1: Add a guard test**

In `LibraryPullManagerTest.kt`, add a test that `pullNow` short-circuits when the session is
not Active. Match the existing test's construction style for `LibraryPullManager` (it already
constructs the manager with fakes). Add the `SessionStateManager` dependency to that
construction. Example test body:

```kotlin
    @Test
    fun `pullNow does nothing when session is not active`() = runTest {
        // sessionState built with a token then marked unauthorized -> ReauthRequired
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "n"))
        }
        val sessionState = SessionStateManager(tokenStore).apply { markUnauthorized() }
        val manager = buildManager(sessionState = sessionState) // adapt to existing helper
        val result = manager.pullNow(forceFull = true)
        assertEquals(false, result.applied)
    }
```

Adapt `buildManager`/construction to the file's existing pattern; the key assertion is
`applied == false` and that `api.changes` is never called.

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.LibraryPullManagerTest"`
Expected: FAIL — constructor mismatch / pull still runs.

- [ ] **Step 3: Add the guard in `LibraryPullManager`**

Add `private val sessionStateManager: SessionStateManager` to the constructor (import
`com.takeya.animeongaku.data.auth.SessionStateManager`). At the start of `pullIfStale` and
`pullNow`, add:

```kotlin
        if (!sessionStateManager.isOnlineEnabled()) return LibraryPullResult(applied = false)
```

- [ ] **Step 4: Guard the periodic pull in `MainActivity`**

`MainActivity` already injects managers. Add `@Inject lateinit var sessionStateManager:
SessionStateManager` (import it). Replace the `if (serverSettingsStore.isConfigured)` guards
in `onCreate`/`onStart` with `if (serverSettingsStore.isConfigured && sessionStateManager.isOnlineEnabled())`
so cold-start, warm-resume, and the periodic loop only run while Active.

- [ ] **Step 5: Run tests + build**

Run: `./gradlew.bat --no-daemon test --tests "com.takeya.animeongaku.LibraryPullManagerTest"` → PASS
Run: `./gradlew.bat --no-daemon :app:compileDebugKotlin` → BUILD SUCCESSFUL

- [ ] **Step 6: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/sync/LibraryPullManager.kt \
        src/app/src/main/java/com/takeya/animeongaku/MainActivity.kt \
        src/app/src/test/java/com/takeya/animeongaku/LibraryPullManagerTest.kt
git commit -m "Skip library sync unless the session is active"
```

### Task 11: Disable online search in degraded mode

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/search/SearchViewModel.kt:43-58,134-154`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/search/SearchScreen.kt` (reconnect prompt)

- [ ] **Step 1: Expose online-availability and guard `searchOnline`**

In `SearchViewModel`, inject `SessionStateManager` (add to the constructor and import
`com.takeya.animeongaku.data.auth.SessionStateManager`; also import `SessionState`). Add a
state flow:

```kotlin
    val onlineEnabled: StateFlow<Boolean> = sessionStateManager.state
        .map { it is SessionState.Active }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), sessionStateManager.isOnlineEnabled())
```

At the top of `searchOnline()` add:

```kotlin
        if (!sessionStateManager.isOnlineEnabled()) {
            _onlineError.value = "Reconnect to search online."
            _onlineState.value = OnlineSearchState.Error
            return
        }
```

- [ ] **Step 2: Reflect it in `SearchScreen`**

In `SearchScreen.kt`, collect `onlineEnabled` and, where the "Search online" affordance is
rendered, show a disabled state / "Reconnect to search online" message when `!onlineEnabled`
instead of the search-online button. (Locate the existing online-search trigger UI and wrap
its enabled state with `onlineEnabled`.)

- [ ] **Step 3: Build**

Run: `./gradlew.bat --no-daemon :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/ui/search/SearchViewModel.kt \
        src/app/src/main/java/com/takeya/animeongaku/ui/search/SearchScreen.kt
git commit -m "Disable online search in degraded mode"
```

### Task 12: Persistent reconnect banner

**Files:**
- Create: `src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/ReconnectBanner.kt`
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt` (render the banner + a re-login modal route when `ReauthRequired`)

- [ ] **Step 1: Create the banner composable**

```kotlin
package com.takeya.animeongaku.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun ReconnectBanner(onReconnect: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Rose500)
            .clickable(onClick = onReconnect)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Icon(Icons.Rounded.CloudOff, contentDescription = null, tint = Ink900)
        Text(
            "Session ended — tap to reconnect (downloads still play)",
            style = MaterialTheme.typography.bodyMedium,
            color = Ink900,
            fontWeight = FontWeight.SemiBold
        )
    }
}
```

- [ ] **Step 2: Render the banner + reconnect modal in the root**

In `AnimeOngakuApp.kt`, when `sessionState is SessionState.ReauthRequired`:
- Add `var showReconnect by rememberSaveable { mutableStateOf(false) }`.
- Place `ReconnectBanner(onReconnect = { showReconnect = true })` at the top of the content
  column (inside the outer `Box`, above the `Scaffold`, or as the first item of the scaffold
  body so it spans full width below the status bar).
- When `showReconnect`, render `OnboardingScreen(onOpenServerSettings = {})` in a full-screen
  `Dialog` / overlay `Box`. On successful login the session flips to `Active`, which removes
  the banner; also dismiss the overlay by observing the state change
  (`LaunchedEffect(sessionState) { if (sessionState is SessionState.Active) showReconnect = false }`).

Add imports as needed: `com.takeya.animeongaku.ui.onboarding.ReconnectBanner`,
`androidx.compose.runtime.mutableStateOf`, `androidx.compose.runtime.getValue`,
`androidx.compose.runtime.setValue`, `androidx.compose.runtime.saveable.rememberSaveable`
(several already imported).

- [ ] **Step 3: Build**

Run: `./gradlew.bat --no-daemon :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/ReconnectBanner.kt \
        src/app/src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt
git commit -m "Show persistent reconnect banner in degraded mode"
```

---

# Phase 7 — Logout entry point + full verification

### Task 13: Route existing unlink/logout through `SessionStateManager`

**Files:**
- Modify: `src/app/src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt:237-241` (`unlinkAccount`)

The existing `unlinkAccount()` calls `ongakuAuthRepository.clearSession()` directly. Route it
through `SessionStateManager.onLogout()` so the root gate switches to `LoggedOut`.

- [ ] **Step 1: Inject and use `SessionStateManager`**

Add `private val sessionStateManager: SessionStateManager` to `ImportViewModel`'s constructor
(import `com.takeya.animeongaku.data.auth.SessionStateManager`). Change `unlinkAccount()`:

```kotlin
    fun unlinkAccount() {
        sessionStateManager.onLogout()
        serverSettingsStore.resetServerMigration()
        _authState.value = AuthState()
    }
```

(`onLogout()` already clears the token via the token store, so the explicit
`ongakuAuthRepository.clearSession()` is removed.)

- [ ] **Step 2: Build + run existing ImportViewModel-related tests**

Run: `./gradlew.bat --no-daemon :app:compileDebugKotlin` → BUILD SUCCESSFUL
Run: `./gradlew.bat --no-daemon test` → all unit tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/src/main/java/com/takeya/animeongaku/ui/sync/ImportViewModel.kt
git commit -m "Route account unlink through SessionStateManager logout"
```

### Task 14: Full verification pass

- [ ] **Step 1: Android unit tests**

Run (from `src/`): `./gradlew.bat --no-daemon test`
Expected: BUILD SUCCESSFUL, all tests pass.

- [ ] **Step 2: Android lint/compile**

Run (from `src/`): `./gradlew.bat --no-daemon :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Server tests + type-check**

Run (from `server/`):
```
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit
```
Expected: all green.

- [ ] **Step 4: Manual QA matrix**

Install debug build (`./gradlew.bat --no-daemon installDebug`) and verify:
1. **Fresh install** → onboarding gate shown; no bottom bar; debug "Server settings" link works.
2. **Login** → app appears; library syncs.
3. **App update simulation** → reinstall over existing (without clearing data) → still logged in
   (token survived in plain storage).
4. **Server token reset** → on the server, delete the session rows for this user; trigger any
   network action in the app → reconnect banner appears, online search shows the reconnect
   prompt, sync stops, non-downloaded tracks won't start, downloaded tracks still play.
5. **Reconnect** → tap banner → login → banner clears, online features restored.
6. **Unlink** (Settings → Kitsu Sync → Unlink) → returns to onboarding gate.

- [ ] **Step 5: Final commit (if any QA fixes were needed)**

```bash
git add -A
git commit -m "Tether: QA fixes"
```

---

## Notes for the executor

- **Verify entity/constructor shapes before writing test factories.** `ThemeEntity` (Task 9)
  and the `LibraryPullManager` test harness (Task 10) may have more required fields than shown;
  open the actual files and match them. The plan's test bodies show intent and key assertions.
- **`markAuthorized` on every 2xx is intentional and cheap** — it only changes state when
  currently `ReauthRequired`.
- **Degraded recovery is re-login only** for a real server token reset (the old token is gone);
  `markAuthorized` exists for the rare transient 401 case.
- **Do not** reintroduce `tokenStore.clear()` in the interceptor — clearing is now exclusively
  `SessionStateManager.onLogout()` (explicit user action).
