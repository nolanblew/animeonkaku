# Anime Ongaku Server

Self-hosted API server for the Anime Ongaku Android app. Design docs live in [`../.planing/`](../.planing/FINAL_PLAN.md) — this milestone (S1) is the skeleton: Fastify + Postgres + drizzle migrations + Kitsu-backed session auth (stubbed Kitsu client until S2).

## Run with Docker

```bash
cp .env.example .env   # edit DB_PASSWORD
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

With `KITSU_AUTH_MODE=stub` (default until S2), any non-empty credentials log in and the user id is `stub-<username>`.

Errors use the envelope `{ "error": { "code": "...", "message": "..." } }`. Full API spec: [`../.planing/04-api-spec.md`](../.planing/04-api-spec.md).
