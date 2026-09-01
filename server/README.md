# Anime Ongaku Server

Self-hosted API server for the Anime Ongaku Android app. Design docs live in [`../.planning/`](../.planning/FINAL_PLAN.md). The current server includes the S1 skeleton plus S2 upstream clients for Kitsu and AnimeThemes.

## Run with Docker

```bash
cp .env.example .env   # edit DB_PASSWORD and ADMIN_PASSWORD; leave KITSU_AUTH_MODE=stub for local smoke tests
docker compose up -d --build
curl http://localhost:48668/healthz
```

Database (`pgdata`) and media (`media`) live in named volumes and survive rebuilds/upgrades. Migrations run automatically on boot, before the server starts listening.

Postgres only uses `POSTGRES_PASSWORD` when `pgdata` is first initialized. If you later change `DB_PASSWORD` in `.env`, the API will log `password authentication failed for user "ongaku"` and the DB health check will stay unhealthy. For disposable local data, run `docker compose down -v` and start again. To preserve data, restore the original password in `.env`, start the DB, rotate the `ongaku` password inside Postgres, then update `.env`.

## Deploy to LAN Server

The repository includes deploy scripts for a personal LAN server using this layout:

- Docker/build files: `~/dockers/anime-ongaku-server`
- Persistent data: `~/docker-data/anime-ongaku-server`
- Host port: `48668` by default, mapped to container port `8080`

PowerShell from Windows:

```powershell
.\scripts\deploy-server.ps1 -SshTarget nolan@192.168.68.68 -EnvFile .\server\.env.production
```

Bash from macOS/Linux/Git Bash:

```bash
scripts/deploy-server.sh --host nolan@192.168.68.68 --env-file server/.env.production
```

The scripts prefer `rsync` for minimal incremental uploads and fall back to a small tarball containing only server build inputs. They do not copy database or media data. On the remote host they create `~/docker-data/anime-ongaku-server/media` and `~/docker-data/anime-ongaku-server/postgres`, copy the server Docker files into `~/dockers/anime-ongaku-server`, run `docker compose -p anime-ongaku-server -f docker-compose.yml -f docker-compose.lan.yml up -d --build`, and wait for `http://127.0.0.1:48668/healthz`.

Keep the production `.env` out of git. If `~/dockers/anime-ongaku-server/.env` already exists, future deploys can omit `-EnvFile` / `--env-file`; the remote file is preserved. Use `-HostPort <port>` / `--host-port <port>` if `48668` is already taken.

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
| `GET`/`HEAD /v1/media/audio/:themeId` | bearer | stream stable audio URLs for player clients |
| `POST /v1/media/audio/:themeId/request` | bearer | prioritize server-side audio warming for downloads |

With `KITSU_AUTH_MODE=stub` (compose default), any non-empty credentials log in and the user id is `stub-<username>`. Set `KITSU_AUTH_MODE=real` to use Kitsu OAuth; the public Kitsu client id/secret default from `../.planning/02-external-apis.md` are already in `.env.example`.

Errors use the envelope `{ "error": { "code": "...", "message": "..." } }`. Full API spec: [`../.planning/04-api-spec.md`](../.planning/04-api-spec.md).

The browser-only API is namespaced under `/api`: `GET /api/v1/home` provides
the bounded home projection and `GET /api/v1/library/live` provides
cookie-authenticated SSE invalidation hints. Events carry only canonical
`library`, `playlist`, and `profile` categories; the browser follows them with
`/api/v1/changes`. Background sync jobs do not fabricate completion events when
they have no reliable completion callback, so the browser's bounded fallback
polling remains the safety net for those updates.

### Sonos sandbox Music API

Set `SONOS_SMAPI_ENABLED=true` together with the canonical HTTPS
`WEB_PUBLIC_ORIGIN` to expose the sandbox adapter. Production Compose enables
the endpoint by default; the Sonos developer service must remain in **Sandbox**
and must not be submitted for production review yet.

- SOAP 1.1 endpoint: `POST /sonos/smapi`
- Account-link page/action: `GET|POST /sonos/link`
- Browse roots: Anime (active user library), Playlists (read-only manual/auto/
  dynamic snapshots), and Liked Songs
- Search categories: all, albums, playlists, and tracks
- Supported SMAPI methods: `getMetadata`, `getMediaMetadata`,
  `getExtendedMetadata`, `getMediaURI`, `search`, `getLastUpdate`, `getAppLink`,
  and `getDeviceAuthToken`

The basic sandbox link flow creates a normal Anime Ongaku device session named
`Sonos` and returns that opaque bearer token to Sonos. Only its SHA-256 hash is
persisted, existing device-session revocation continues to work, and this avoids
a Sonos-specific token table or database migration. `getMediaURI` passes the
same token through an `Authorization` HTTP header; tokens are never put in media
URLs. Link codes are random, one-time, device-bound, valid for at most ten
minutes, and revoked after repeated failed logins. No Sonos credential or secret
is required by this adapter or should be committed to `.env`.

## Operational notes

### Anime Music Fetcher operator and mounts

This first controller iteration intentionally uses the hardcoded API address
`http://192.168.68.68:9292/api/v1`; making it configurable is deferred. AMF is
an optional acquisition dependency: an AMF outage is reported only by the
authenticated, on-demand `GET /v1/admin/music/diagnostics` route. It does not
change `/healthz`, server startup, catalog reads, or playback of existing media.

These private-LAN operator endpoints use the existing bearer-session check;
there is currently no separate administrator role. Do not expose them publicly.
`GET /v1/admin/music/requests` returns safe Anime Ongaku request/batch states.
Persisted batch IDs can be targeted with `retry`, `cancel`, or `reprocess`
under `/v1/admin/music/batches/{batchId}/...`; actions are
state-gated and enter the durable Anime Ongaku queue. Responses omit AMF job
IDs, paths, URLs, keys, and raw errors.

Use four strict ownership boundaries:

- AMF-only private `/config` contains its database, work files, and credentials.
- AMF and qBittorrent share one host downloads directory read-write at the
  same container path `/downloads` in both containers.
- AMF owns `/library` read-write. Anime Ongaku mounts that exact host directory
  read-only at `/mnt/amf-library` and sets `AMF_LIBRARY_ROOT=/mnt/amf-library`.
- Anime Ongaku alone owns `MEDIA_ROOT=/data/media` read-write. Never mount it
  into AMF or qBittorrent.

Set `AMF_LIBRARY_HOST_PATH` to the host directory mounted as AMF `/library`.
The default LAN example is `/data/anime-fetcher/library`. Automatic discovery
remains disabled during controller acceptance. The staging-cleanup diagnostic
is deliberately dry-run only: it reports eligibility only after every active
delivery has a verified canonical copy. Anime Ongaku performs no staging
deletion. After reviewing the dry-run result and independently verifying the
current canonical file bytes, remove the exact request staging files manually
on the host. A future AMF cleanup API may replace this manual step; AMF 0.2 job
deletion does not remove delivered `/library` files.

### Reset Android sessions intentionally

Tether sessions are effectively non-expiring. Normal rebuilds, redeploys, and
Drizzle migrations should preserve the `device_sessions` table because Postgres
uses the persistent `pgdata` volume/bind and the server uses stable SHA-256 token
hashing.

When you deliberately need every Android client to reconnect, delete session rows
from Postgres. The next authenticated request for an old token returns `401`, and
the Android client enters reconnect/degraded mode while keeping local downloads.

From `server/` on a Docker Compose host:

```powershell
docker compose exec db psql -U ongaku -d ongaku -c "DELETE FROM device_sessions;"
```

For a single Kitsu user id:

```powershell
docker compose exec db psql -U ongaku -d ongaku -c "DELETE FROM device_sessions WHERE user_id = 'stub-nolan';"
```

On the LAN deployment, run the same SQL from `/dockers/animeongaku` with the
compose files used by that host, for example:

```bash
docker compose -p animeongaku -f docker-compose.yml -f docker-compose.lan.yml exec db \
  psql -U ongaku -d ongaku -c "DELETE FROM device_sessions;"
```

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
   curl http://localhost:48668/healthz
   ```

2. Configure the Android app's Server URL to the LAN URL that reaches this API, for example `http://192.168.68.85:48668/`.
3. Sign in through the app using Kitsu credentials. For non-production credential checks, the known test slug is `nblewtest`.
4. Open Import and run a full sync. Watch the server sync phases complete, then confirm the library appears in the app after the client pull.
5. Play a track whose server audio state is still pending. Expected: `/v1/media/audio/{themeId}` may return a 302 to origin, ExoPlayer follows it, and playback starts.
6. Replay the same track after the server fetch completes. Expected: the server serves the cached file with normal `200` or `206` range responses.
7. Offline-download the same track from the app. Expected: the worker warms `/v1/media/audio/{themeId}/request`, downloads with bearer auth, and marks the local file complete.
8. Enable airplane mode and replay the downloaded track. Expected: playback uses the local file path and does not require the server.
9. On device A, like a track. On device B signed in to the same account, pull or restart the app. Expected: the like appears after `/v1/prefs/themes` reconciliation.
