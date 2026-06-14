# Anime Ongaku Server

Self-hosted API server for the Anime Ongaku Android app. Design docs live in [`../.planning/`](../.planning/FINAL_PLAN.md). The current server includes the S1 skeleton plus S2 upstream clients for Kitsu and AnimeThemes.

## Run with Docker

```bash
cp .env.example .env   # edit DB_PASSWORD; leave KITSU_AUTH_MODE=stub for local smoke tests
docker compose up -d --build
curl http://localhost:8080/healthz
```

Database (`pgdata`) and media (`media`) live in named volumes and survive rebuilds/upgrades. Migrations run automatically on boot, before the server starts listening.

## Deploy to LAN Server

The repository includes deploy scripts for a personal LAN server using this layout:

- Docker/build files: `/dockers/animeongaku`
- Persistent data: `/data/animeongaku`

PowerShell from Windows:

```powershell
.\scripts\deploy-server.ps1 -SshTarget nolan@192.168.1.10 -EnvFile .\server\.env.production
```

Bash from macOS/Linux/Git Bash:

```bash
scripts/deploy-server.sh --host nolan@192.168.1.10 --env-file server/.env.production
```

The scripts prefer `rsync` for minimal incremental uploads and fall back to a small tarball containing only server build inputs. They do not copy database or media data. On the remote host they create `/data/animeongaku/media` and `/data/animeongaku/postgres`, copy the server Docker files into `/dockers/animeongaku`, run `docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d --build`, and wait for `/healthz`.

Keep the production `.env` out of git. If `/dockers/animeongaku/.env` already exists, future deploys can omit `-EnvFile` / `--env-file`; the remote file is preserved.

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

With `KITSU_AUTH_MODE=stub` (compose default), any non-empty credentials log in and the user id is `stub-<username>`. Set `KITSU_AUTH_MODE=real` to use Kitsu OAuth; the public Kitsu client id/secret default from `../.planning/02-external-apis.md` are already in `.env.example`.

Errors use the envelope `{ "error": { "code": "...", "message": "..." } }`. Full API spec: [`../.planning/04-api-spec.md`](../.planning/04-api-spec.md).

## Operational notes

### AnimeThemes upstream blocks (most likely failure mode)

The server is the only component that talks to AnimeThemes, and AnimeThemes sits
behind Cloudflare. If this server's egress IP gets flagged, AnimeThemes returns
**HTTP 403** and theme mapping cannot complete — the symptom is a library that
imports anime but shows **0 themes** (no playback, downloads, likes, or search
results). This is the single most likely thing to break in production.

How the server handles it:

- Repeated AnimeThemes `403`/`451` responses open that host's circuit breaker
  (`breakerStatuses` in `src/index.ts`) so the job queue stops hammering a
  blocked origin instead of burning retries.
- `GET /v1/sync/status` reports the latest theme-mapping job via a `mapping`
  object and an `upstreamBlocked: true` flag when the failure looks like a
  block. Check this first when a library has 0 themes — it distinguishes
  "blocked by upstream" from "nothing to map".

Recovery levers:

- Set `ANIMETHEMES_BASE_URL` to an operator-controlled mirror / reverse-proxy
  with a different egress, then re-run a sync (`POST /v1/sync` with `full`).
- Inspect failed jobs: `GET /v1/jobs?status=FAILED` and retry with
  `POST /v1/jobs/{id}/retry` once egress is healthy.

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
