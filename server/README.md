# Anime Ongaku Server

Self-hosted API server for the Anime Ongaku Android app. Design docs live in [`../.planing/`](../.planing/FINAL_PLAN.md). The current server includes the S1 skeleton plus S2 upstream clients for Kitsu and AnimeThemes.

## Run with Docker

```bash
cp .env.example .env   # edit DB_PASSWORD; leave KITSU_AUTH_MODE=stub for local smoke tests
docker compose up -d --build
curl http://localhost:8080/healthz
```

Database (`pgdata`) and media (`media`) live in named volumes and survive rebuilds/upgrades. Migrations run automatically on boot, before the server starts listening.

## Develop locally

```bash
npm install
npm test                              # vitest, no database needed
npm run typecheck
# against the compose database:
docker compose up -d db
$env:DATABASE_URL="postgres://ongaku:ongaku-dev@localhost:5432/ongaku"; $env:MEDIA_ROOT="./.media"; npm run dev
```

Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` (never edit applied migrations in `drizzle/`).

## API (S1 surface)

| Endpoint | Auth | Description |
|---|---|---|
| `GET /healthz` | none | DB ping + media-disk free bytes |
| `POST /v1/auth/login` | none | `{username, password, deviceName?}` → `{token, user, isNewUser}` |
| `GET /v1/auth/me` | bearer | user, kitsu auth state, device sessions |
| `POST /v1/auth/logout` | bearer | revoke current session |
| `DELETE /v1/auth/devices/:id` | bearer | revoke another device session |

With `KITSU_AUTH_MODE=stub` (compose default), any non-empty credentials log in and the user id is `stub-<username>`. Set `KITSU_AUTH_MODE=real` to use Kitsu OAuth; the public Kitsu client id/secret default from `../.planing/02-external-apis.md` are already in `.env.example`.

Errors use the envelope `{ "error": { "code": "...", "message": "..." } }`. Full API spec: [`../.planing/04-api-spec.md`](../.planing/04-api-spec.md).

## I1 Manual Android Smoke Test

Use this script after the server and Android client are both built from the I1 branch.

1. Start fresh compose services:

   ```powershell
   docker compose down -v
   docker compose up -d --build
   curl http://localhost:8080/healthz
   ```

2. Configure the Android app's Server URL to the LAN URL that reaches this API, for example `http://192.168.1.5:8080/`.
3. Sign in through the app using Kitsu credentials. For non-production credential checks, the known test slug is `nblewtest`.
4. Open Import and run a full sync. Watch the server sync phases complete, then confirm the library appears in the app after the client pull.
5. Play a track whose server audio state is still pending. Expected: `/v1/media/audio/{themeId}` may return a 302 to origin, ExoPlayer follows it, and playback starts.
6. Replay the same track after the server fetch completes. Expected: the server serves the cached file with normal `200` or `206` range responses.
7. Offline-download the same track from the app. Expected: the worker warms `/v1/media/audio/{themeId}/request`, downloads with bearer auth, and marks the local file complete.
8. Enable airplane mode and replay the downloaded track. Expected: playback uses the local file path and does not require the server.
9. On device A, like a track. On device B signed in to the same account, pull or restart the app. Expected: the like appears after `/v1/prefs/themes` reconciliation.
