# 10 — Offline-first sync + server-authoritative dynamic playlists

Status legend: `[ ]` todo · `[x]` done · `[~]` in progress · `[!]` blocked/deferred

Branch: `feature/offline-sync-and-server-dynamic-playlists`

## Goals

1. **Dynamic (smart) playlists become server-authoritative**, stored and refresh-triggered on the
   server, and synced to every device exactly like normal/auto playlists. A user on multiple
   devices sees the same created dynamic playlists, specs, and materialized entries.
2. **All user mutations are offline-first and conflict-managed.** Any change (like/dislike,
   create/rename/reorder/delete playlist, create/edit dynamic playlist, add/remove library anime,
   plays) can be made while the client has no server connection, is durably queued, and reconciles
   on reconnect — including pulling incoming changes. Conflicts resolve **last-write-wins (LWW)**
   by a monotonic per-entity timestamp, so a stalled-then-late write never clobbers a newer one.

"Offline" = client cannot reach the server, for any reason (device offline, server down,
interruption between).

## Key design decisions

- **LWW clock.** Every user-mutable row carries `updated_at` (server) / `updatedAt` (Room). Writes
  carry the originating **client op timestamp** (`opTs`, epoch ms). Server applies a write only if
  `opTs >= stored.updated_at`; otherwise it keeps the stored row and returns it (the client then
  reconciles to server state). This is the conflict-management rule for the whole system.
- **Tombstones.** Deletes set `deleted_at` (never hard-delete user rows that other devices may not
  have seen yet) so deletions propagate through the delta feed. Applies to playlists (exists),
  library_entries (exists), theme_prefs (added), dynamic specs (via playlist tombstone).
- **Unified delta feed.** A single `GET /v1/changes?since=<ms>` returns everything the client
  mirrors that changed since `since`: library anime/themes, theme prefs, playlists (+entries +
  dynamic spec), and `serverTime`. Full-vs-delta is just `since=null` vs `since=<cursor>`. The
  existing `/v1/library` stays as the catalog/library slice; `/v1/changes` composes the user-state
  slices so one round-trip reconciles everything.
- **Client outbox.** A generic `pending_ops` table records every mutation: `(entityType, entityKey,
  opType, payloadJson, opTs, attempts)`. Mutations are applied optimistically to Room **and**
  enqueued. A `SyncEngine` drains the outbox FIFO on connectivity/app events, then pulls the delta
  feed. Local rows store `updatedAt` so incoming deltas apply LWW locally too.
- **Offline-created ids.** Client-created playlists get a temporary negative local id. The outbox
  `create` op returns the server id on flush; an id-remap rewrites the local playlist + entries +
  any queued ops still referencing the temp id. (Likes/library/plays are keyed by themeId/kitsuId,
  so they need no remap.)
- **Server-side dynamic evaluation.** The filter+sort DSL is ported to TypeScript so the server
  materializes dynamic playlists (like the existing auto-playlists). Triggered on: spec
  create/edit, library sync, pref change, plays recorded, and periodic refresh. `Downloaded`
  filter and `DOWNLOADED` sort are **device-specific** — server treats them as `false`/neutral and
  this is documented; a dynamic playlist using them still syncs but the "downloaded" dimension is
  not applied server-side (acceptable: downloads are per-device anyway).

---

## Task A — Server-authoritative dynamic playlists

### A1 — Server data model & spec storage
- [x] Extend `playlists`: treat dynamic playlists as `is_auto=false` but `is_dynamic=true` with
      `dynamic_spec_json` (filter), `dynamic_sort_json` (sort), `dynamic_auto_update` (bool),
      `dynamic_spec_updated_at`. Migration `0004_nifty_purifiers.sql`.
- [x] `PlaylistDto` carries `isDynamic`, `dynamicSpecJson`, `dynamicSortJson`, `autoUpdate` (+ `deleted`);
      create/update persist them.

### A2 — Port filter/sort DSL to TypeScript
- [ ] `server/src/playlists/filterTypes.ts` — FilterNode/DateAnchor/SortSpec types matching the
      Moshi `"type"` discriminator + enum-name wire format.
- [ ] `server/src/playlists/evaluateFilter.ts` — port of `FilterEvaluator.matches` + anchors.
- [ ] `server/src/playlists/sortThemes.ts` — port of `SortComparators`.
- [ ] Unit tests mirroring `FilterEvaluatorSortTest`, `FilterNodeSerializationTest`,
      `ThemeSortOrderTest` to guard Kotlin↔TS parity.

### A3 — Evaluator + materialization
- [ ] `DrizzleDynamicPlaylistEvaluator`: load user catalog/library/prefs context, evaluate spec,
      write `playlist_entries` (mirrors `DrizzleAutoPlaylistRefresher.saveAutoPlaylist`).
- [ ] Hook into `refreshAutoPlaylists(userId)` and the sync pipeline triggers (library/prefs/plays).

### A4 — Client wiring
- [ ] `DynamicPlaylistRepository.createDynamic/update` write through the server (spec + sort +
      autoUpdate); local Room remains a cache.
- [ ] `LibraryPullManager` ingests dynamic playlists as first-class (spec, entries) from the feed.
- [ ] Auto-update dynamic playlists stop being device-evaluated when server-synced; snapshot
      (non-auto) dynamic playlists keep their entries as sent.

---

## Task B — Offline-first resilient sync (LWW)

### B1 — Server: LWW + tombstones + delta
- [x] Pure LWW primitive `sync/lww.ts` (`shouldApplyWrite`, `resolveOpTs`) + unit tests.
- [x] Add `deleted_at` tombstone + dedicated `liked_updated_at` clock to `theme_prefs`; expose
      `updatedAt`/`deleted` on pref DTOs. (Separate clock so additive play counts don't reject likes.)
- [x] `updateThemePref` and `updatePlaylist` accept `opTs` and apply LWW; return authoritative row.
- [~] `library` add/remove still stamp server-now (LWW-safe, no explicit `opTs` param yet).
- [x] `GET /v1/prefs/themes?since=` and `GET /v1/playlists?since=` return deltas incl. tombstones.
- [x] `GET /v1/changes?since=` composing library + prefs + playlists + serverTime.
- [x] vitest: pure LWW (newer applies / stale rejected / tie idempotent). Route-level LWW
      integration needs a real-DB harness (server tests use fakes) — deferred to manual/instrumented.

### B2 — Client: outbox + local clocks
- [ ] `pending_ops` Room table + DAO (FIFO, attempts, dedupe per entityKey+opType where safe).
- [ ] Add `updatedAt` (local op clock) to user-mutable Room rows: `user_preferences`, `playlists`,
      `playlist_entries` set, library (`anime` already has `libraryUpdatedAt`; add op clock).
- [ ] Mutation repositories enqueue ops + apply optimistic local change with `opTs = now`.
      (`UserPreferencesRepository`, `ServerPlaylistWriter`, `DynamicPlaylistRepository`,
      library add/remove, plays already queue.)

### B3 — Client: SyncEngine
- [ ] `SyncEngine.push()` — drain `pending_ops` FIFO; send with `opTs`; on success delete op; on
      server-newer response reconcile local row; on network failure stop (stay queued), backoff.
- [ ] `SyncEngine.pull()` — `GET /v1/changes?since=cursor`; apply incoming LWW vs local `updatedAt`;
      persist new cursor; honor tombstones.
- [ ] Offline-created playlist id remap (temp negative id → server id across rows + queued ops).
- [ ] Trigger on: connectivity regained, app foreground, post-mutation (debounced), periodic worker.
- [ ] Replace bespoke write-throughs (likes, playlist edits) with outbox enqueues.

### B4 — Tests / verification
- [ ] Server vitest green (`tsc --noEmit` + vitest run).
- [ ] Android unit tests green (outbox ordering, LWW apply, id remap as pure functions).
- [ ] Manual/instrumented: make changes airplane-mode, reconnect, verify convergence.

---

## Rollout / safety
- Backward compatible: new query params and columns are optional/defaulted; old clients keep working
  against the new server, and the new client tolerates a server without `/v1/changes` (falls back to
  existing endpoints).
- Each step keeps server `tsc`+vitest and Android `:app:testDebugUnitTest` green before commit.
