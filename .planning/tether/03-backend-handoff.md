# Tether — Backend Handoff

**Date:** 2026-06-18
**Audience:** Anime Ongaku server (Node/TS + Fastify + Postgres) devs
**Status:** Android/UI side implemented on branch `feature/tether-ui` (off `feature/server-initiative`). The backend "portion" below is a skeleton/stub; **the rest is yours to finish and verify.**

## Context (what the Android side now expects)

The Android client was getting silently logged out (every call 401s while the local library
still renders). We fixed three client causes (interceptor no longer wipes the token on 401;
token moved to durable plain storage; client now has a `SessionStateManager` that degrades to
a downloaded-only mode instead of blanking out). For the client to stop expiring sessions on
its own, the **server sessions must be effectively non-expiring**, and a deliberate token
reset must produce a clean `401` so the client drops into reconnect mode.

Client contract assumptions (already true in current server code — please keep them):
- `POST /v1/auth/login` returns `{ token, user: { kitsuUserId, username }, isNewUser }`.
- Any authenticated endpoint returns **HTTP 401** when the bearer token is missing, unknown,
  expired, or its session row was deleted. The client treats a 401 on a *bearer* request as
  "session rejected" → degraded mode; a successful 2xx clears it.
- A bad-credentials login returns 401 with `error.code` (e.g. `KITSU_AUTH_FAILED`). The client
  does **not** treat the login endpoint's 401 as a session rejection (login carries no bearer).

## The portion already applied (stub)

`server/src/auth/service.ts`: `SESSION_TTL_MS` bumped from 180 days to ~100 years, so
`login()` issues effectively non-expiring sessions. No schema change (the `expiresAt` column
stays non-null). This is the minimal change; it is **not verified by you yet**.

```ts
// service.ts
export const SESSION_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000;
```

`authenticate()` is unchanged: it still returns `null` for missing/expired/deleted sessions,
so a manual reset still yields 401.

## What backend devs still need to do

1. **Verify the change** — run the suite and type-check from `server/`:
   ```
   & 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
   & 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit
   ```
   Expected: existing `server/test/auth.routes.test.ts` still passes. Note two relevant tests:
   - "creates a session with the documented TTL" asserts the issued TTL is within 60s of
     `SESSION_TTL_MS` — still true after the bump.
   - "rejects expired sessions" forces `expiresAt` into the past manually — still 401.

2. **Decide the canonical expiry model.** Two acceptable options — pick one and make it the
   real implementation (the stub picked the first):
   - **Far-future expiry (current stub):** simplest, no migration. Slight oddity: the TTL test
     name "documented TTL" is now misleading — consider renaming it.
   - **Truly non-expiring (nullable `expiresAt`):** cleaner semantics. Requires a Postgres
     migration to make `sessions.expires_at` nullable and updating `authenticate()` to treat
     `null` as "never expires". More work; only if you want it tidy.

3. **Provide/operationalize the "reset all tokens" path.** The whole degraded-mode UX hinges
   on the server being able to invalidate sessions (e.g. after a breach, a key rotation, or a
   schema reset) and clients getting a 401. Today this is just "delete the session rows."
   Please confirm/establish the supported mechanism:
   - An admin/maintenance command or endpoint to delete sessions (all, or per-user), **or**
   - Documented runbook for truncating/clearing the sessions table on deploys that require it.
   Whatever it is, ensure it leaves `authenticate()` returning `null` (→ 401) afterward.

4. **Confirm deploys don't accidentally wipe sessions.** Since "between updates" was a reported
   symptom, verify that normal server redeploys/migrations do **not** drop the sessions table
   or rotate token hashing in a way that invalidates existing tokens. If a deploy must
   invalidate sessions, that's fine — clients will reconnect — but it should be intentional.

## Out of scope for this handoff
- No change to the Kitsu OAuth model (server still owns Kitsu tokens).
- No multi-account / multi-tenant work.
- The Android side is complete and does not require any new server endpoints.
