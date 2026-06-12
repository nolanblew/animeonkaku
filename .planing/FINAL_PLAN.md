# FINAL PLAN — Anime Ongaku Server Initiative

> **For future developers and agents:** read this file first, then the referenced spike doc for whichever section you're implementing. Spike docs (`01`–`08` in this folder) contain the detailed designs, schemas, endpoint specs, and the audit of the current app — this file is the work breakdown and sequencing. Nothing in this plan modifies behavior until its section is implemented; the existing app keeps working throughout.

**Goal:** Move all metadata + audio binaries behind a self-hosted, dockerized API server (download-once from AnimeThemes, server-side Kitsu sync, multi-device, reset-safe), and refactor the Android app into a thin client of that server while preserving full offline-download support.

**Architecture (summary):** Node.js/TypeScript (Fastify) server + Postgres + media volume in docker compose (doc 03). DB-backed priority job queue with one worker, per-host rate limits, circuit breakers (doc 06). REST API v1 with opaque bearer sessions backed by Kitsu password-grant login (doc 04). Android keeps UI/media/Room/offline-downloads; swaps data source to the server (doc 07).

**Tech stack:** Server: Node.js 22, TypeScript, Fastify 5, zod, Drizzle ORM + drizzle-kit migrations, `pg`, PostgreSQL 16, vitest, Docker (node:22-alpine multi-stage). Client: existing stack (Compose, Hilt, Room, Media3, WorkManager, Retrofit/OkHttp).

**Document index**
| Doc | Contents |
|---|---|
| `01-current-android-architecture.md` | As-is audit: sync pipeline, cadences, auth, downloads, Room schema, media engine |
| `02-external-apis.md` | Kitsu + AnimeThemes contracts, rate limits (AnimeThemes 90/min), data gotchas |
| `03-server-architecture.md` | Stack decision, repo layout, docker-compose, storage layout, streaming strategy |
| `04-api-spec.md` | Full v1 endpoint spec with payloads |
| `05-server-data-model.md` | Postgres schema (SQL contract for the initial drizzle migration) + Room→server mapping table |
| `06-download-queue-design.md` | Priority queue, preemption, rate limiting, retry/backoff, circuit breaker |
| `07-android-refactor.md` | Client changes, migration of existing installs, deletions, test impact |
| `08-corner-cases.md` | Bug list in current app + acceptance-criteria corner cases |

---

## Workstreams

Two concurrent workstreams (S = server, A = android), with one integration milestone (I). S1–S5 have no Android dependency; A1 has no server dependency. First hard sync point is I1.

**Key invariants every task must respect**
1. Never break offline playback of already-downloaded files on device.
2. Server is the only component that talks to Kitsu/AnimeThemes after migration; it stays within politeness budgets (doc 02).
3. Client-facing media URLs (`/v1/media/audio/{themeId}`) are stable forever.
4. All schema changes via drizzle-kit migrations (server) / Room migrations (client); never edit applied migrations.

---

### S1 — Server skeleton + persistence (no upstream calls yet) ✅ DONE

**Completed 2026-06-12 in [PR #24](https://github.com/nolanblew/animeonkaku/pull/24).**

**Deliverable:** `server/` Node/TypeScript project boots in docker compose, initial drizzle migration applied, `/healthz` green, auth round-trip works against a stubbed Kitsu client.

Tasks:
- [x] 1. Create `server/` per layout in doc 03: `npm init` + TypeScript strict config, Fastify 5, Dockerfile (multi-stage: node:22-alpine build → prod-deps runtime) + `docker-compose.yml` (api + postgres:16-alpine + volumes) + `.env.example` exactly as doc 03.
- [x] 2. Drizzle schema in `src/db/schema.ts` producing exactly the SQL contract in doc 05; `drizzle-kit generate` initial migration (checked in); migration runner invoked in `src/index.ts` before the HTTP listener.
- [x] 3. `pg` pool from `DATABASE_URL`; config parsing via zod in `src/config.ts`.
- [x] 4. Fastify wiring: zod type provider, error handler emitting the error envelope from doc 04, pino logging, `/healthz` (DB ping + disk free on `MEDIA_ROOT`).
- [x] 5. Session auth: token generation (`crypto.randomBytes(32)`, base64url), SHA-256 storage, bearer-auth Fastify hook/decorator, `POST /auth/login` against a `KitsuAuthClient` *interface* (real impl in S2), `/auth/me`, `/auth/logout`, device list/revoke.
- [x] 6. Tests (vitest + `fastify.inject()`): token hash round-trip, login creates user+session, 401 paths.

**Definition of done:** `docker compose up` → login with stub → authenticated `/auth/me`; `docker compose down && up` retains data (volume check). ✅ Verified live (20/20 tests, persistence confirmed via re-login `isNewUser=false` after down/up).

### S2 — Upstream clients (Kitsu + AnimeThemes ports) ✅ DONE

**Completed 2026-06-12 in [PR #25](https://github.com/nolanblew/animeonkaku/pull/25).**

**Deliverable:** server-side ports of the proven Android clients, with politeness built in.

Tasks:
1. [x] `kitsu/KitsuClient`: OAuth password+refresh grant with the tolerant response parsing ported from `KitsuAuthRepositoryImpl.parseFallback` (doc 02 lists why); library paging (500/page), `-updatedAt` delta walk, anime details/mappings/categories batchers (20/batch) — port `UserRepositoryImpl` behavior 1:1, including ratingTwenty/averageRating conversions.
2. [x] `animethemes/AnimeThemesClient`: the four query shapes from doc 02 (Kitsu-id batch ≤50, MAL-id batch, `q=` title search, single anime), `links.next` pagination.
3. [x] Shared HTTP stack: retry (GET-only, 408/429/5xx, exp backoff) **honoring `Retry-After`**; per-host token buckets (animethemes-api 60/min, kitsu 2/s, binary hosts 1-concurrent) per doc 06; circuit breaker (5 fails → 10 min open).
4. [x] Tests: fixture-JSON parsing (reuse the Android test fixtures from `src/app/src/test/` where applicable — `ApiDeserializationTest` inputs), rate-limiter timing, Retry-After honored, breaker opens/half-opens.

### S3 — Job queue + media store

**Deliverable:** the doc 06 queue running end-to-end with `FETCH_AUDIO`/`FETCH_IMAGE`.

Tasks:
1. `jobs/JobQueue`: enqueue with `ON CONFLICT (dedupe_key)` priority-bump upsert (SQL in doc 06), picker query with `FOR UPDATE SKIP LOCKED`, worker loop, backoff, boot-time RUNNING→QUEUED recovery, per-type timeouts.
2. `media/MediaStore`: tmp-file download → size/Content-Type validation → sha256 → atomic move → `media_files` READY (doc 03 storage layout; doc 08 §B validation rules, incl. `video_fallback` flag).
3. `FETCH_AUDIO`/`FETCH_IMAGE` handlers; disk-free guard (<2 GB pauses fetch jobs).
4. Admin: `GET /v1/jobs?status=`, `POST /v1/jobs/{id}/retry`.
5. Tests: dedupe/priority-bump semantics, preemption ordering (URGENT beats running-next MAINTENANCE), crash-recovery requeue, partial-file never READY.

### S4 — Library sync pipeline (the big port)

**Deliverable:** `KITSU_FULL_SYNC`/`KITSU_DELTA_SYNC`/`MAP_THEMES`/`BACKFILL_SCAN`/`AUTO_PLAYLIST_REFRESH` jobs producing a correct catalog + per-user library.

Tasks:
1. Port `SyncManager.doSync` phase-by-phase (doc 01 lists all 11 phases) into `sync/LibrarySyncPipeline`, writing to the split schema (catalog vs `library_entries`) per doc 05. Drop the 1:1 claimed-id guards in favor of N:1 mapping (doc 05 decision 2); drop hash-fallback theme ids (reject non-numeric).
2. Fallback chain: MAL-id lookup, strict title/synonym search with the same exact-match guards (`AnimeRepositoryImpl.searchAnimeThemesInternal` logic), `mapping_state=UNMATCHED` terminal state.
3. Checkpoint/yield between batches when an URGENT job is queued (doc 06 preemption), progress JSON on the job row.
4. `BACKFILL_SCAN` → MAINTENANCE `FETCH_AUDIO` for every library-referenced theme missing READY audio.
5. Auto playlists: Kitsu Library / Currently Watching / Liked Songs recompute (port `AutoPlaylistManager` + `updateKitsuPlaylist`).
6. Scheduler tickers: per-user delta sync every `SYNC_INTERVAL_MINUTES` (default 360), daily auto-playlist refresh + orphan-file scan + weekly FAILED-media re-queue (docs 03/08).
7. Tests (most valuable in the repo): mapping with fixtures incl. N:1 season case, delta stop-at-known-page, tombstoning removed entries, unmatched bookkeeping, backfill diff.

### S5 — Read/write API surface

**Deliverable:** every endpoint in doc 04 live.

Tasks:
1. `GET /v1/library?since=` delta feed with `serverTime`, tombstones, `audioState` join against `media_files`.
2. Media streaming: PartialContent (Range/206) for READY files; 302+URGENT-enqueue on miss; ETag/immutable headers; `HEAD` probe; `POST /media/audio/{id}/request`.
3. Prefs/plays/playlists endpoints (LWW prefs, additive play events, playlist CRUD, `dynamic_spec_json` blob passthrough, auto-playlist reads).
4. `POST /v1/sync` + `GET /v1/sync/status` (job progress passthrough), manual add/remove anime endpoints.
5. Search/artist proxy endpoints with short-TTL in-memory cache.
6. Tests: Range semantics (ExoPlayer-style byte-range requests against a real file), 302-on-miss enqueues exactly one job, delta feed correctness (the `since`/tombstone contract), play-count additivity.

### A1 — Android: server plumbing behind a flag (parallel with S1–S5)

**Deliverable:** app gains a "Server" mode scaffold compiled in but inert until a base URL is configured.

Tasks:
1. `OngakuApi` Retrofit service + DTOs matching doc 04 (build against the spec, not the server — fixtures from doc 04 JSON).
2. `ServerTokenStore`, `OngakuAuthInterceptor` (Bearer + 401→logout signal), settings UI for base URL, `@Named("ongaku")` client/retrofit in `NetworkModule`.
3. New login path posting to `/v1/auth/login` (kept behind "server configured" gate; legacy Kitsu login remains the default until I1).
4. Room migration v19→v20: add `pending_plays` table; add `serverPullCursor` (store in prefs instead if simpler — decide in PR).
5. Pending-writes flush worker (plays first; prefs/playlist edits reuse it).

### I1 — Integration: client reads from server

**Pre-req:** S5 + A1. **Deliverable:** with a server URL configured, the app's library/playback/downloads run entirely through the server; legacy direct mode still intact as fallback.

Tasks:
1. `LibraryPullManager` (new, small): `GET /library?since=` → Room upserts + tombstones → dynamic playlist refresh. Wire to cold-start/resume/2h-loop triggers + new 6 h WorkManager periodic job (doc 07 §3 cadence mapping).
2. Point `ThemeEntity.audioUrl` + artwork URLs at server on upsert; verify ExoPlayer plays READY (200/206) and PENDING (302→origin) tracks; verify `DownloadWorker` offline flow against both.
3. Import screen: swap `SyncManager` state collection for `POST /sync` + `/sync/status` polling (phase names map 1:1).
4. Prefs/plays/playlists write-through + reconcile-on-pull.
5. Manual end-to-end test script (document in `server/README.md`): fresh compose up → login on device → full sync → play (302 path) → replay (local path) → offline-download → airplane-mode playback → like on device A visible on device B.

### I2 — Migration & cleanup (cutover)

**Deliverable:** server mode is the only mode; dead code removed.

Tasks:
1. One-time migration for existing installs per doc 07 §Migration (push likes/plays/manual playlists/dynamic specs up; URL rewrite happens via pull).
2. Delete legacy code (deletion list in doc 07) + their Hilt providers; remove `RateLimitInterceptor`; trim `KitsuTokenStore` to nothing or delete.
3. Fix the surviving client bugs from doc 08 §A while touching the files: #2 (PreCache partial-span), #3 (DownloadWorker failed-vs-retry status).
4. Update `CLAUDE.md` + `README.md` (server setup, signing docs already exist), bump Room schema snapshot, full test pass: `./gradlew test` (client, from `src/`) + `npm test` (in `server/`).

### Backlog (explicitly out of v1 — do not build now)
- Server-side dynamic-playlist evaluation; video file storage; transcoding; web/desktop clients (the API is already shaped for them); TLS/user-management hardening; Kitsu write-back (marking episodes watched); multi-worker queue scaling.

---

## Suggested execution order

```
S1 ──► S2 ──► S3 ──► S4 ──► S5 ─┐
                                ├─► I1 ──► I2
A1 (anytime) ───────────────────┘
```

Each S-milestone is a working, testable increment (S1 boots; S2 talks upstream; S3 downloads a file by hand-enqueued job; S4 syncs a real Kitsu account; S5 serves a client). Suggested branch naming: `server/s1-skeleton`, `android/a1-plumbing`, etc.; PR per milestone; agents executing a milestone should use the superpowers plan-execution workflow with this file's task list as the checklist and write per-milestone implementation plans (with full TDD step granularity) before coding.
