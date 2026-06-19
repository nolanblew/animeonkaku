# Tether — Durable Sessions, Onboarding Gate & Degraded Mode

**Date:** 2026-06-18
**Status:** Approved design, ready for implementation plan
**Initiative codename:** Tether (the session that keeps the user tethered — no spurious re-logins)

## Problem

Between app updates (and possibly over time) the user is silently logged out: every
network call starts returning `401`, yet the entire library still renders. The app
becomes half-broken — local data shows, but search, sync, and streaming all fail with
no clear path back.

This is a personal app with no sensitive credentials. The session should be effectively
permanent: the user should never have to re-login except when the server itself
deliberately resets/recycles tokens. When that genuine invalidation happens, the app
should degrade gracefully (downloaded media only) rather than break or blank out.

## Root causes (all three are fixed)

1. **Client wipes the token on _any_ 401.** `OngakuAuthInterceptor` calls
   `tokenStore.clear()` on every `401` response. A single transient/erroneous 401
   permanently destroys the local session while the Room-backed library keeps
   rendering. This is the primary match for the reported symptom.
2. **Server sessions hard-expire at 180 days.** `AuthService` sets
   `SESSION_TTL_MS = 180 days` and `authenticate()` only refreshes `lastUsedAt`, never
   `expiresAt` — a fixed 180-day cliff regardless of activity.
3. **Token stored in fragile `EncryptedSharedPreferences`.** The `androidx.security`
   keyset backing `kitsu_auth_prefs` is known to corrupt/invalidate across app updates,
   restores, and keystore changes. When it breaks, the token (and the server URL, which
   shares the same file) is lost.

## Goals

- Session is effectively permanent; no re-login except on deliberate server-side reset.
- Token survives app updates and restores.
- A fresh / signed-out user sees a polished onboarding + login screen and nothing else
  (debug builds also expose a limited server-settings screen).
- When the server genuinely rejects the token, the app enters a **downloaded-only**
  degraded mode with a persistent reconnect banner — it does not blank out or wipe data.

## Non-goals

- No change to the Kitsu OAuth model (server still owns Kitsu tokens).
- No multi-account support.
- No offline-first redesign beyond the degraded-mode gating described here.
- No encryption-at-rest for the session token (explicitly acceptable: no sensitive creds).

## Design decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Token storage | Plain (unencrypted) local storage; one-time migration from the encrypted store. |
| Server session expiry | Non-expiring (far-future `expiresAt`); server admin may still wipe all sessions. |
| On genuine 401 | Switch to downloaded-only degraded mode; disable online search & syncing; show a persistent reconnect banner across the whole app until re-login. |
| Logged-out settings | Debug builds only: a limited settings screen with the server URL. Release: onboarding/login only. |

## Architecture

### Session state — single source of truth

New `@Singleton` `SessionStateManager` exposes `StateFlow<SessionState>`:

```
sealed interface SessionState {
    data object LoggedOut : SessionState                 // no token stored
    data class Active(val session: ServerSession)        // token stored and working
    data class ReauthRequired(val session: ServerSession) // token stored, server rejected it
}
```

Transitions:

- `onLogin(session)` → `Active` (persists token).
- `onLogout()` → clears token → `LoggedOut`.
- `markUnauthorized()` → if `Active`, → `ReauthRequired` (token **kept**).
- `markAuthorized()` → if `ReauthRequired`, → `Active` (self-heals a transient 401).

Initialized at startup from `ServerTokenStore`: token present → `Active`, else `LoggedOut`.
The manager is the only place that decides login/logout state; ViewModels and the root
UI observe it.

### Token storage

- `ServerTokenStore` reads/writes a **plain** `SharedPreferences` (new file, e.g.
  `ongaku_session_prefs`) instead of the encrypted one.
- One-time migration: on first construction, if the new store is empty and the old
  encrypted `kitsu_auth_prefs` has a token, copy it over (token, kitsuUserId, username),
  then continue using the plain store. Migration must be resilient: if the encrypted
  store throws on read (the corruption case), swallow and treat as no prior token.
- `ServerSettingsStore` (server URL) shares the same fragile encrypted file today and is
  also lost on keyset corruption; move it to the same plain store with the same one-time
  migration so the server URL survives updates too. Falls back to
  `BuildConfig.ONGAKU_SERVER_BASE_URL` when unset, as today.

### Interceptor changes

`OngakuAuthInterceptor`:

- Inject `SessionStateManager`.
- Only act on requests that **carried a Bearer token** (excludes the login endpoint, so a
  bad-credentials 401 never flips global state).
- On `401` for a bearer request → `sessionStateManager.markUnauthorized()` (do **not**
  clear the token).
- On a successful (2xx) bearer request → `sessionStateManager.markAuthorized()`
  (clears a transient degraded flag).

`OngakuInterceptorsTest` updated to assert the new behavior (token preserved on 401,
state transition reported).

### Server changes

- `AuthService.login` sets `expiresAt` to a far-future value (e.g. `Date.now() + 100yr`)
  so sessions are effectively non-expiring. No schema change (column stays non-null).
- `authenticate()` is unchanged in shape: a missing, expired, or deleted session still
  returns `null` → `401`. A deliberate server-side reset (deleting session rows) thus
  cleanly produces the degraded-mode 401 on clients.
- Update `SESSION_TTL_MS` usage / constant and the related Vitest expectations; run
  `tsc --noEmit`.

### App gating (root: `AnimeOngakuApp`)

Root collects `SessionState` and branches:

- **`LoggedOut`** → full-screen **Onboarding/Login** only. No bottom bar, no app content.
  Debug builds expose a link to the limited server-settings screen; release shows
  onboarding only.
- **`Active`** → the existing app, unchanged.
- **`ReauthRequired`** → the existing app shell **plus** the persistent reconnect banner
  and degraded-mode gating.

### Onboarding / Login screen (new)

Polished dark screen using the existing Ink/Mist/Rose theme palette:

- App branding / hero.
- Short "how it works" copy: connects to your Anime Ongaku server, syncs your Kitsu
  library, streams & downloads OP/ED themes.
- Login form: Kitsu **email/username** + **password**, sign-in button, inline error,
  loading state.
- Debug-only subtle "Server settings" affordance (server URL).

The login logic currently embedded in `ImportViewModel`/`ImportScreen` is extracted into a
shared path used by both the onboarding screen and the existing import/sync screen, so
there is exactly one login implementation. On success →
`SessionStateManager.onLogin(...)`. `ImportScreen` keeps its post-login sync/resync
controls.

### Degraded "downloaded-only" mode (`ReauthRequired`)

- **Persistent banner** on every screen ("Session ended — reconnect to sync & stream"),
  tappable to open the login screen (modal route). Successful login → `Active`, banner
  disappears.
- **Online search disabled** — Search screen shows a reconnect prompt instead of querying.
- **Syncing disabled** — `LibraryPullManager` pulls, the periodic foreground sync loop,
  and `startSync` are gated on `Active`.
- **Playback restricted to downloaded** — at play time, non-downloaded tracks are blocked
  with a reconnect message; downloaded tracks (resolved via `DownloadDao` /
  `PlaybackMediaItems` local path) play normally.

## Recovery semantics

- `ReauthRequired` recovery is **re-login only**. A genuine server token reset invalidates
  the old token, so it cannot self-heal silently. `markAuthorized` exists only to recover
  from the rare transient 401 where the same token later succeeds.
- On app restart while degraded: token is present → starts `Active` optimistically; the
  first authenticated call 401s → returns to `ReauthRequired`. No persisted degraded flag
  is required.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `SessionStateManager` | Single source of truth for auth state; transitions | `ServerTokenStore` |
| `ServerTokenStore` (changed) | Plain-storage token persistence + migration | `SharedPreferences` (plain + legacy encrypted) |
| `ServerSettingsStore` (changed) | Plain-storage server URL + migration | same |
| `OngakuAuthInterceptor` (changed) | Attach bearer; report 401/2xx to state manager | `SessionStateManager`, `ServerTokenStore` |
| `AuthService` (server, changed) | Non-expiring sessions | repo |
| Onboarding/Login screen + VM | Gate UI + login entry | `OngakuAuthRepository`, `SessionStateManager` |
| Root gating in `AnimeOngakuApp` | Branch UI on `SessionState` | `SessionStateManager` |
| Degraded-mode gating | Banner + disable search/sync + restrict playback | `SessionStateManager`, `DownloadDao` |

## Testing strategy

- **Unit (Android):** `SessionStateManager` transitions; `ServerTokenStore` migration
  (happy path, empty legacy, throwing legacy); interceptor 401/2xx reporting
  (`OngakuInterceptorsTest`).
- **Unit (server):** non-expiring session creation; `authenticate` returns null for
  deleted/expired sessions (Vitest); `tsc --noEmit`.
- **Manual/QA:** fresh install → onboarding gate; login → app; simulate server token reset
  → degraded banner + downloaded-only playback + disabled search/sync; re-login → restored;
  app update → token survives (plain storage).

## Build order (each independently testable)

1. `SessionState` + `SessionStateManager` (+ unit tests).
2. Plain token storage + migration from encrypted (+ migration tests).
3. Interceptor: report instead of clear (+ update `OngakuInterceptorsTest`).
4. Server non-expiring sessions (+ Vitest, tsc).
5. Root gating + Onboarding/Login screen.
6. Degraded mode (banner, search/sync gating, playback restriction).
7. Debug-only logged-out settings access.
