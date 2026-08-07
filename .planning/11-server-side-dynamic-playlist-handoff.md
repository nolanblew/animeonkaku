# Handoff: server-side authority for dynamic (smart) playlist entries

**Status:** server and Android authority work is complete on branch
`fix/playlist-sync-and-media-priority` (PR #54, base `feature/server-initiative`). Written
2026-07-02 as an agent handoff and updated after the 2026-07-09 review; read
`.planning/10-offline-sync-and-server-dynamic-playlists.md` first for the original design.

## Objective

Dynamic/smart playlists (spec-driven, `dynamicSpecJson` non-null, `autoUpdate=true`) must have
their entries computed **server-side** from the spec. The device stops being the source of truth
for which themes are in these playlists; it only authors the spec/sort/autoUpdate and renders
whatever the server materialized.

## What is already done (this branch — do not redo)

Server (`server/src/`):

- `playlists/dynamicPlaylistEvaluator.ts` — `refresh(userId, playlistId?)` re-materializes
  auto-update dynamic playlists from the spec (port of the device's FilterEvaluator; kept
  behaviorally in lock-step via `playlists/evaluate.ts` + `test/playlists.evaluate.test.ts`).
- `api/drizzleClientApiService.ts`:
  - `createPlaylist`: for dynamic+autoUpdate playlists, **client-sent entries are ignored** and the
    spec is evaluated server-side before the playlist is returned (`serverEvaluated` path). Also:
    create is transactional, converges onto an existing active same-name row (LWW), and
    `replacePlaylistEntries` drops entry theme-ids missing from this server's `themes` catalog
    (they FK-500'd before — see PR #54 description for the production incident).
  - `updatePlaylist`: after applying the LWW update, if the row ends up dynamic+autoUpdate the
    server re-evaluates that playlist and ignores `input.entries`; snapshot/manual playlists keep
    client entries.
- Refresh triggers that already exist: `refreshAutoPlaylists(userId)` (which includes the dynamic
  evaluator) runs on theme-pref writes, play writes, `/v1/playlists*` GETs after library changes,
  and the `AUTO_PLAYLIST_REFRESH` job that library syncs enqueue. The evaluator's `saveEntries`
  bumps `playlists.updated_at`, so re-materialized entries flow to devices through the existing
  `since`-cursor pull (`/v1/changes` / `/v1/playlists?since=`).
- Tests: `test/playlistCreate.contract.test.ts` guards the authority flip; suite is 201 passing
  via `cd server && node ./node_modules/vitest/vitest.mjs run` (also `tsc -p tsconfig.json --noEmit`).

## Android implementation

### 1. Stop pushing entries for dynamic auto playlists

Files: `src/app/src/main/java/com/takeya/animeongaku/`
`data/repository/ServerPlaylistWriter.kt`, `data/repository/DynamicPlaylistRepository.kt`,
`sync/SyncEngine.kt` (`playlistPayload`, `pushPlaylist`), `sync/DynamicPlaylistManager.kt`.

- Creating/updating a playlist that has a dynamic spec with AUTO mode now produces a pending payload
  should carry `name`, `dynamicSpecJson`, `dynamicSortJson`, `autoUpdate`, `opTs` — **no
  `entries`** (the server ignores them now, but sending 150+ ids per op is waste and was the
  source of the FK bug).
- Local evaluation (`DynamicPlaylistRepository.refreshOne`) remains available as an offline
  preview for client-managed specs. Its final freshness check and entry replacement are atomic, so
  a fresher server pull cannot be clobbered.
- `SyncEngine.pushPlaylist` strips legacy AUTO entries at send time and drains stale `OP_REORDER`
  rows for AUTO dynamic playlists without calling the server.

### 2. Device-only filter dimensions

`downloaded` (filter) and `DOWNLOADED` (sort) only exist on the device. Option (a) was chosen:
the server treats downloaded dimensions as broad no-ops and materializes a server-computable
superset; Android applies the actual downloaded filter/sort as a view-time overlay without writing
entries back.

Original options:

a. **Hybrid overlay (recommended):** server materializes the server-computable spec; the device
   applies device-only predicates as a *view-time filter* on the server's entry list without
   writing anything back. Sort with DOWNLOADED falls back to device-side ordering at render time.
b. Keep specs containing device-only dimensions fully client-evaluated (mark them, skip server
   materialization) — more code paths, keeps the old bug class alive.

### 3. End-to-end device verification

- Deploy PR #54's server (`scripts/deploy-server.ps1 -SshTarget nolan@192.168.68.68 ...` — note:
  the workstation's ssh key is NOT authorized non-interactively; the user runs the deploy).
- The user's phone has a wedged pending op ("6 Months & Liked", `pending_ops` row, 13+ attempts)
  that should drain on first retry after deploy. Check with:
  `adb exec-out run-as com.takeya.animeongaku sh -c "base64 databases/anime_ongaku.db" | tr -d '\r' | base64 -d > ao.db`
  then `sqlite3 ao.db "SELECT * FROM pending_ops;"` (plain adb pull/PowerShell `>` corrupts binary).
- Create a fresh smart playlist on-device; confirm the server response entries (not the device's)
  land in Room, and that a pref change (like/dislike) re-materializes server-side and pulls down.

### 4. Tests

- Android: unit tests around SyncEngine payloads for dynamic playlists (no entries key), and
  reconcile-wins-by-updatedAt. Run via memory note `android-build-env-local-jdk`
  (CLAUDE.md's F:-drive paths are stale): Android Studio JBR + %LOCALAPPDATA% SDK,
  `.\gradlew.bat --no-daemon test` from `src/`.
- Server: there is NO db-backed test harness (fakes + source-contract tests only; no pglite).
  Behavior was verified live against the local docker stack — see below.

## Local verification loop (how the current work was proven)

- Local stack: docker compose project `anime-ongaku-server` — API `localhost:48668`, Postgres via
  `docker exec anime-ongaku-server-db-1 psql -U ongaku -d ongaku -c "..."` (port not published;
  multi-statement `psql -c` is one transaction — errors roll back earlier statements).
- Mint a bearer session without Kitsu: insert `users` row + `device_sessions` row with
  `token_hash = sha256hex(raw token)`, future `expires_at`; then hit `/v1/*` with the raw token.
- Rebuild loop after server edits and before live tests (run in `server/`):
  `docker compose -p anime-ongaku-server build api && docker compose -p anime-ongaku-server up -d api`.
  Seed a couple of `animethemes_anime` + `themes` + `library_entries` rows to give the evaluator a
  universe.

## Gotchas learned this session

- `server/tsconfig.json` has `strict` + `exactOptionalPropertyTypes` — build optional objects
  conditionally, don't assign `undefined`.
- `jobs.priority` is int4 — never pass `Number.MAX_SAFE_INTEGER` into SQL params (crashed the
  worker once already; fixed in `pgJobRepository.claimNext`).
- The user's global rules disable commit attribution; conventional commits (`feat:`/`fix:`/...).
- Moshi map payloads on Android turn numbers into Doubles (`6.0` in specs) — the server's zod
  schemas and evaluator already tolerate this; keep it that way.
