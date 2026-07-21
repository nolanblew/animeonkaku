# Media Catalog execution handoff

Last updated: 2026-07-21

## 2026-07-21 acquisition direction change

Lidarr is no longer an active dependency. Read
`.planning/16-anime-fetcher-migration-plan.md` before editing acquisition,
discovery, import, operator, or Android anime-detail code. The live Anime Music
Fetcher 0.2 OpenAPI contract was verified at
`http://192.168.68.68:9292/openapi.json`; `/health` returned `ok` and `/ready`
reported its database, Prowlarr, custom source, and qBittorrent ready. The AMF
README at `E:\Users\Nolan\Documents\AnimeMusicFetcher\README.md` confirms the
separate `/config`, shared `/downloads`, and output `/library` mount contract.

The replacement sequence is MC-S05R, MC-S07R, MC-A00/MC-S08R, MC-S12R, then
MC-Q01R. MC-S11 remains the next unaffected original ticket, but it is paused
until the controller request/import path is established. The new debug Android
button must call Anime Ongaku, never AMF directly. AMF deliveries go to a
shared read-only staging mount for Anime Ongaku and are then validated/copied
into the separate canonical `MEDIA_ROOT`.

## Branch and completed ticket commits

- Branch: `feature/media-catalog-initiative`
- MC-S01: `121a8c7 feat(server): add media catalog schema`
- MC-S02: `aa8eb66 feat(server): preserve AnimeThemes video catalog`
- MC-S03: `d0ae8e4 feat(server): import and stream original song audio`
- MC-S04: `1ae8bac feat(server): define music provider contracts`
- MC-S05: `5dbe22c feat(server): add Lidarr acquisition adapter`
- MC-S06: `dc673c0 feat(server): add conservative music catalog matching`
- MC-S07: `f6f849e feat(server): add automatic music discovery workflows`
- MC-S08: `d916d43 feat(server): import validated music acquisitions`
- MC-S09: `b11d198 feat(server): expose ready music catalog`
- MC-S10: completed and verified in the next ticket commit after `b11d198`
  (use `git log -1 --oneline` for its final hash).

The pre-existing untracked `.codex-remote-attachments/` directory is unrelated
and must not be staged, modified, or deleted.

## 2026-07-21 AMF replacement continuation

- MC-S05R is complete in the ticket commit containing this handoff update.
- Anime Music Fetcher 0.2 replaces Lidarr. Its first-iteration API base is
  hardcoded to `http://192.168.68.68:9292/api/v1`; root `/health` and `/ready`
  remain service-origin routes.
- The AMF client supports validated/redacted health, readiness, submit, poll,
  retry, cancel, status, result, and delivery contracts. It never projects AMF
  absolute paths, raw provider URLs, opaque download data, or raw error text.
- All Lidarr runtime/configuration/adapter code is removed. The old automatic
  discovery/import/recovery wiring is paused so historical acquisition rows
  cannot be submitted to AMF.
- MC-S05R verification: focused 54/54; full server 397 passed and 15
  environment-gated skipped; TypeScript `--noEmit` and diff check passed; live
  AMF health/readiness were ready; independent Sol/Medium review passed after
  two schema/redaction corrections.
- Resume with MC-S07R durable whole-anime request persistence, routes,
  deterministic <=12-item batches, job submission/polling, replay, and real
  PostgreSQL concurrency/restart tests. Do not re-enable automatic scheduling.

## MC-S10 completed scope

- Playlist reads add `defaultMode` and ordered polymorphic `items` with stable
  occurrence `entryId`s. Legacy `entries` remains the ordered,
  duplicate-preserving THEME projection and omits SONG occurrences.
- Writes support duplicate/reordered THEME and ready Related SONG occurrences.
  THEME overrides are null/TV_SIZE/FULL_SIZE; SONG overrides are null; Video,
  inactive themes, unready/Full-only songs, mixed legacy/new shapes, and
  foreign/duplicate entry IDs are rejected atomically.
- Header/default/item mutation is one locked PostgreSQL LWW transaction. Stale
  writes no-op before guards/validation; failed writes do not advance the clock
  or alter items. Same-name replay and reorder retain stable occurrence IDs.
- Legacy entries replacement returns 409 `PLAYLIST_REQUIRES_NEW_CLIENT` when it
  would erase SONG or override data, while safe theme-only/name-only legacy
  behavior and ownership scope remain compatible.
- Auto playlists canonicalize to TV_SIZE plus THEME/null items. Dynamic
  materialization emits THEME/null, preserves its explicit default, and skips
  identical refresh writes so IDs/timestamps do not churn.

## MC-S10 verification evidence

- Independent Terra/High QA focused matrix: 44/44.
- Isolated PostgreSQL 16 playlist integration: 1/1, covering mixed duplicate
  order, stable IDs/replay/reorder, LWW, destructive legacy guard, ready SONG
  validation, inactive THEME rejection, and transactional rollback. The exact
  temporary container was removed; `server-db-1` was verified untouched.
- Full default server Vitest: 46 files passed, 7 environment-gated files
  skipped; 381 tests passed and 15 skipped.
- TypeScript `--noEmit` and `git diff --check` passed.
- Independent Sol/Medium review found no remaining blocker.

## Deferred original next ticket: MC-S11

Read MC-S11 in `.planning/14-media-catalog-tickets.md`, TDR 8.6, and the PRD
reaction/history requirements before editing. MC-S11 owns mode-specific theme
reactions, Related-song prefs, and actual-mode play events. Preserve:

1. Existing theme-pref fields/routes and theme play aggregates remain additive
   and compatible.
2. Legacy themeId-only plays map to THEME/TV_SIZE and continue incrementing the
   existing aggregate exactly once.
3. New play events use stable clientEventId idempotency and record itemType,
   itemId, actualMode, and playedAt without double counting retries.
4. Song prefs are user-scoped LWW deltas with tombstones and join the normal
   `/v1/changes` response.
5. Broad like/dislike and TV-only/Full-only dislike clearing semantics must be
   explicit and regression-tested; Related SONG reactions never mutate every
   theme for an anime.
6. Preserve `.codex-remote-attachments/` and commit MC-S11 separately.

## Agent model policy

- Use `gpt-5.6-luna` for Luna-mapped work when available.
- If Luna is unavailable, use `gpt-5.6-terra` as its fallback.
- Never use Sol merely as a Luna fallback.
- Sol is allowed only where the original mapping explicitly permits it: UX and
  review at Medium, and medium/high-complexity development at the specified
  Medium/High effort.
