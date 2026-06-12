# Spike 03 — API Server Architecture

## Goals (from initiative brief)
- Single internal server owns all metadata + binaries ("download once" from AnimeThemes).
- Server-side Kitsu sync (periodic + manual), auto-playlists, multi-device, app-reset-safe.
- Dockerized (compose), persistent DB + media storage across container upgrades.
- Small scale: a handful of users. Optimize for simplicity, operability, and a lightweight container — not throughput.

## Tech stack — decision

**Node.js + TypeScript + Fastify, with PostgreSQL.** Rationale: the most well-known and well-supported API ecosystem; small alpine-based images (~150–200 MB vs ~400+ MB JVM); fast iteration; first-class streaming/Range support; TypeScript is comfortable territory coming from Kotlin. The logic being ported from the Android app (`SyncManager`, `AnimeRepositoryImpl`, `UserRepositoryImpl`) is HTTP + JSON wrangling — it translates to TypeScript directly.

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS | |
| Framework | Fastify 5 | routing, pino logging built in, schema validation hooks |
| Language | TypeScript (strict) | |
| Validation | zod + `fastify-type-provider-zod` | request/response schemas double as API docs |
| DB | PostgreSQL 16 (compose service) | named volume; standard tooling |
| ORM/migrations | Drizzle ORM + drizzle-kit | typed schema in TS; generates plain SQL migrations (doc 05 SQL is the contract); `migrate` runs on boot before serving |
| DB driver | `pg` (node-postgres) | pool ~5 connections |
| Upstream HTTP | built-in `fetch` (undici) + small retry wrapper | honor `Retry-After`; per-host token buckets via `bottleneck` |
| Scheduling | in-process `setInterval` tickers | no cron infra needed at this scale |
| Auth tokens | random 256-bit opaque tokens, SHA-256-hashed at rest | no JWT complexity needed |
| Media streaming | `@fastify/static` (`acceptRanges`) or manual `Content-Range` streams | ExoPlayer needs 206 responses |
| Tests | vitest + `fastify.inject()` | fixture JSON reused from Android tests where applicable |
| Build/image | multi-stage Dockerfile: `node:22-alpine` build → prod-deps-only runtime | |

Alternatives considered: Kotlin/Ktor (rejected: heavier JVM image and less mainstream server ecosystem, despite code-sharing appeal — see git history of this doc), Python/FastAPI (equally valid, no strong pull), Go (lightest images but slowest iteration).

## Repository layout

```
animeonkaku/
├── src/                  # existing Android project (unchanged location)
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── drizzle.config.ts
│   ├── drizzle/                    # generated SQL migrations (checked in)
│   ├── src/
│   │   ├── index.ts                # bootstrap: migrate → fastify → worker → scheduler
│   │   ├── config.ts               # env parsing (zod)
│   │   ├── api/                    # route plugins (auth, library, media, playlists, sync, admin)
│   │   ├── auth/                   # Kitsu OAuth client, session token service
│   │   ├── kitsu/                  # Kitsu API client (port of KitsuApi/UserRepositoryImpl)
│   │   ├── animethemes/            # AnimeThemes client (port of AnimeRepositoryImpl)
│   │   ├── sync/                   # per-user library sync pipeline (port of SyncManager)
│   │   ├── jobs/                   # priority job queue + worker (doc 06)
│   │   ├── media/                  # binary store, range streaming, checksums
│   │   └── db/                     # drizzle schema + client
│   └── test/                       # vitest (mapping, queue, range serving)
```

## Docker / deployment

`server/docker-compose.yml`:

```yaml
services:
  api:
    build: .
    image: animeongaku-server:latest
    ports: ["8080:8080"]
    environment:
      DATABASE_URL: postgres://ongaku:${DB_PASSWORD}@db:5432/ongaku
      MEDIA_ROOT: /data/media
      KITSU_CLIENT_ID: ${KITSU_CLIENT_ID}
      KITSU_CLIENT_SECRET: ${KITSU_CLIENT_SECRET}
      SYNC_INTERVAL_MINUTES: "360"          # per-user background Kitsu sync
      AUDIO_BACKFILL_DELAY_SECONDS: "8"     # politeness pacing for backfill
    volumes:
      - media:/data/media
    depends_on:
      db: { condition: service_healthy }
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ongaku
      POSTGRES_USER: ongaku
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ongaku"]
      interval: 5s
      retries: 10
    restart: unless-stopped

volumes:
  media:     # audio + images survive container rebuilds
  pgdata:    # database survives container rebuilds
```

- Upgrades: `docker compose pull/build && docker compose up -d` — drizzle migrations run on boot (before the HTTP listener starts); volumes persist.
- Backup: `pg_dump` + tar of the media volume (admin endpoint optional later).
- TLS/ingress: out of scope (personal LAN / reverse-proxy of operator's choice). The API still requires bearer tokens so casual LAN exposure is safe enough for this project's threat model.

## Process model

Single Node process, three logical components (all in-process async — downloads and sync are I/O-bound, so the single thread is a non-issue; sha256 uses streaming `crypto`):

1. **HTTP API** (doc 04) — auth, library/catalog reads, playlist + prefs writes, media streaming, sync triggers, job-queue status.
2. **Job worker** — one async loop consuming the priority job queue (doc 06): metadata fetches, audio/image downloads, with rate limiting + retry/backoff + preemption by on-demand requests.
3. **Scheduler** — `setInterval` tickers:
   - every `SYNC_INTERVAL_MINUTES` (default 6h): enqueue `KITSU_DELTA_SYNC` per active user (replaces the phone's 5min/60min/2h foreground-only checks with something strictly better).
   - after every sync: enqueue `AUDIO_BACKFILL` scan (missing binaries → queue).
   - daily: auto-playlist refresh, stale-job cleanup, orphan-file scan.

## Media storage layout

```
/data/media/
├── audio/{themeId}.ogg          # canonical theme id from AnimeThemes
├── audio/tmp/                    # in-progress downloads (atomic rename on completion)
└── images/
    ├── anime/{kitsuId}/poster.jpg, cover.jpg
    └── artists/{artistSlug}.jpg
```

- DB row (`media_files`) is the source of truth: status, byte size, sha256, source URL, fetched_at. A file on disk without a READY row is garbage (orphan scan deletes); a READY row without a file triggers re-queue.
- Download protocol: stream to `tmp/`, verify Content-Length (and store sha256), `fs.rename` (atomic, same volume) into place, then mark READY. Never serve from `tmp/`.

## Streaming to clients

- `GET /v1/media/audio/{themeId}` with full **HTTP Range support** (ExoPlayer requires 206 responses). `@fastify/static` serves ranges out of the box; if routing through a handler, stream with explicit `Content-Range`/`Accept-Ranges` headers.
- **Cache-miss behavior (on-demand play of a not-yet-downloaded file):** respond `302 Found` → original AnimeThemes URL, *and* enqueue an URGENT download job. First play streams from origin exactly once; every later play is local. This avoids proxy-tee complexity (range requests + partial files) and guarantees playback never waits on our queue.
- Images same pattern (`/v1/media/images/...`), 302 to Kitsu/AnimeThemes CDN when missing.

## Error-handling principles

- Upstream failures never corrupt state: sync is transactional per-phase; job failures retry with backoff and park as `FAILED` after max attempts (inspectable/retryable via admin endpoint).
- Circuit breaker per upstream host: N consecutive failures → pause that host's jobs for cool-down (doc 06).
- API returns structured errors `{ "error": { "code": "...", "message": "..." } }`; 401 invalid/expired session token; 503 with `Retry-After` when an action needs an upstream that's circuit-broken.
- Health: `GET /healthz` (DB ping + disk free), `GET /v1/admin/status` (queue depth, last sync per user, media stats).
