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

- MC-S05R is complete at `284b7ad feat(server): replace Lidarr with Anime Music
  Fetcher`.
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
- MC-S07R is complete at `1a51ee5 feat(server): add durable anime music
  requests`.
  It adds durable request/batch/item rows, global active replay, immutable AMF
  bodies and keys, deterministic <=12-item batches, authenticated wrapped
  request resources, and attempt-neutral submit/poll/recovery jobs.
- MC-S07R verification: focused 12/12; isolated PostgreSQL 1/1 with the
  disposable instance removed; full server 409 passed and 16 environment-gated
  skipped; TypeScript and diff check passed; final Sol/Medium review clean.
- The AMF destination is now
  `anime-ongaku-staging/request-{requestId}/batch-{batchIndex}` so untrusted
  route Kitsu IDs never enter filesystem paths.
- MC-A00 is complete at `780114a feat(android): add debug anime music
  requests`. Its
  debug-only anime-detail action hydrates/polls Anime Ongaku request resources;
  Android never calls AMF. Only idle or POST-error states submit, while active
  and terminal states are read-only.
- MC-A00 verification: focused 16/16; full Android unit 383/383; lint, debug
  assembly, release Kotlin compile, and diff check passed. Sol/Medium UX review
  issues were fixed. Device/controller smoke remains MC-Q01R.
- MC-S08R is complete at `f73aa86 feat(server): import Anime Music Fetcher
  deliveries`. It
  persists AMF evidence/deliveries, validates the read-only staging mount,
  verifies bytes during copy, and atomically publishes ready Full/Related
  catalog entries with deterministic crash/replay behavior.
- MC-S08R verification: focused 39/39; isolated PostgreSQL 3/3 with the
  disposable instance removed; full server 416 passed and 18 environment-gated
  skipped; TypeScript/diff passed; Sol/Medium review and Terra/High QA clean.
- MC-S12R is complete in the ticket commit containing this handoff update. It
  adds authenticated, redacted operator diagnostics and persisted-batch
  retry/cancel/reprocess operations with exact AMF-status gates at enqueue and
  execution time. AMF diagnostics are bounded and isolated from Anime Ongaku
  health/startup/playback.
- MC-S12R documents and configures AMF `/library` as read-only to Anime Ongaku,
  keeps `MEDIA_ROOT` Anime Ongaku-only, and provides canonical-record-backed
  staging-cleanup eligibility without deleting files. Under AMF 0.2, cleanup
  remains an independently verified manual exact-file host operation.
- MC-S12R verification: full server 441 passed and 18 environment-gated
  skipped; isolated PostgreSQL 2/2; TypeScript, Compose validation, and diff
  check passed; final Sol/Medium review and Terra/High QA passed.
- Resume MC-Q01R only after the vfolder mounts below are available. Do not
  submit a live AMF job or re-enable automatic scheduling before that
  acceptance environment is ready.

Required vfolder contract for MC-Q01R:

1. `anime-fetcher/downloads/` mounted read-write at the identical `/downloads`
   path in AMF and qBittorrent.
2. `anime-fetcher/library/` mounted read-write as AMF `/library` and read-only
   as Anime Ongaku `/mnt/amf-library` with
   `AMF_LIBRARY_ROOT=/mnt/amf-library`.
3. `anime-ongaku/media/` mounted read-write only as Anime Ongaku `MEDIA_ROOT`;
   never expose it to AMF or qBittorrent.
4. Keep AMF `/config` on a separate private persistent path outside the shared
   media vfolder.

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

## MC-S11 completion and Android continuation

MC-S11 is complete in the ticket commit containing this handoff update. It
adds compatible broad/TV/Full theme reactions, independent Related-song prefs
and deltas, and strict legacy/new actual-mode play events with transactional,
user-scoped UUID idempotency. Focused routes passed 24/24, isolated PostgreSQL
passed 3/3, the full server suite passed 444 with 21 environment-gated skips,
and TypeScript/diff checks, Sol/Medium review, and Terra/High QA passed.

Live acceptance diagnosis for Kitsu anime `48649` / AnimeThemes anime `4496`
showed that request `7dc3570c-a628-4ed1-97f4-1449f09bc908` imported and indexed
correctly. Three Full songs (OP1, OP2, ED2) and all 28 tracks of the related
soundtrack release have READY canonical media with matching bytes and hashes.
The submit, poll, and import jobs are DONE. The request remains
`AWAITING_OPERATOR` because ED1, CHARACTER_SONG, DRAMA, and OTHER returned
not-found results; this attention state must not hide the 31 READY catalog
items. No importer change, retry, or reprocess is indicated by this evidence.

The Android app cannot display those READY items yet. Its sync DTOs and Room
model do not consume `musicCatalog` or `mediaModes`, the queue is still
theme-only, and Anime Detail has no Related Music surface. Resume in this
order: MC-A01, MC-A02, MC-A03, MC-A04, MC-A05, then MC-A07. Do not add a
top-level Albums destination: Full Size is a mode in Now Playing, while the OST
belongs in a nested Related Music section after Themes on Anime Detail.

UX continuation contract:

1. Put the centered `TV Size | Full Size | Video` selector at the top of Now
   Playing; resolve availability without losing queue-entry identity.
2. Show anime-owned releases and tracks under Anime Detail `Related Music`,
   after Themes.
3. Replace the static `1 batch requested` support text. Active requests say
   `Finding and preparing music` / `Ready music will appear below
   automatically.` Attention requests say `Some music is ready` / `Available
   music is shown below. Some requested items could not be added.` Completed
   requests say `Music is ready` / `Available music is shown below.`
4. Request status and catalog visibility are independent: render READY media
   immediately even while the request needs operator review.
5. Check AnimeDetailViewModel cache freshness. Its current cache-first path may
   avoid a server refresh when local anime data already exists.

The strict coding cutoff was reached after MC-S11, so no Android catalog ticket
was started in this continuation. Preserve `.codex-remote-attachments/`, keep
one commit per ticket, and perform the planned large-section review/QA and
device acceptance after the Android chain is complete.

## 2026-07-21 Android catalog continuation

- MC-S11 is committed at `0459549 feat(server): add mode-specific music user
  state`.
- MC-A01 is complete in the ticket commit containing this handoff update. It
  adds backward-compatible catalog/mode/user-state API contracts, Room v23
  typed music and exact-media storage, stable typed playlist storage, and
  transactional READY catalog sync without deleting independent downloads or
  preferences.
- MC-A01 verification: focused 23/23, full Android unit 388/388,
  `compileDebugAndroidTestKotlin`, `lintDebug`, `assembleDebug`, and diff check
  passed. Sol/Medium review and Terra/High QA passed.
- No ADB device was attached. The compiled v22→v23 migration and Room
  cache-preservation instrumentation must execute during the final device QA.
- Resume at MC-A02. Preserve queue occurrence identity and all existing
  single/multi/duplicate insertion invariants; do not implement mode switching
  until MC-A03.
- MC-A02 is complete in the ticket commit containing this handoff update. It
  generalizes the queue and persistence to real Theme/RelatedSong items while
  preserving queueId occurrence identity, legacy restore, mixed display,
  Media3 metadata, and pre-cache safety. Full unit verification passed 405/405;
  independent focused QA passed 135/135; final Sol/Medium review passed.
- Resume at MC-A03. Treat its resolver as the single authority for preferred
  intent, policy, availability, connectivity, exact local media, actual
  fallback, and retained-intent reason. Do not spread source-selection rules
  into UI, downloads, or Media3.
- MC-A03 is complete in the ticket commit containing this handoff update. Its
  pure resolver and coordinator own policy precedence, exact local/online
  availability, finite fallback, retained intent, and Related Audio behavior.
  `selectThemeMode` is the authoritative durable/runtime selection boundary;
  Video is session-only and RELATED_AUDIO is invalid for Theme sessions.
- MC-A03 verification: full unit 424/424, independent focused QA 137/137,
  corrected focused review 24/24, and diff check passed.
- Resume at MC-A04. Consume `ResolvedPlaybackItem`; do not reimplement fallback
  or availability in Media3. Preserve `MediaItem.mediaId == queueId`, route
  server audio with bearer+cache, direct video without either, and local files
  locally.
- MC-A04 is complete in the ticket commit containing this handoff update.
  Media3 now consumes resolved typed items, preserves queue occurrence IDs,
  routes authenticated cached server audio separately from anonymous uncached
  direct video and local files, rebuilds same-ID mode sources, and performs
  finite race-safe Video fallback.
- MC-A04 verification: full unit 441/441, independent focused QA 172/172,
  debug assembly, corrected Sol/Medium review, redirect-security tests, and
  diff check passed.
- Resume at MC-A05 using the approved compact top-centered selector and
  PlayerView UX contract already recorded above. Do not create a second player;
  bind the existing controller/service and preserve audio/video exclusivity.
- MC-A05 implementation is complete in the ticket commit containing this
  handoff update, but its ledger status remains device-QA-pending. It adds the
  compact actual-mode selector, shared-controller portrait/landscape Video,
  content warnings, accessibility-safe controls, queueId-safe UI metadata, and
  guarded D13 prior-audio restoration.
- MC-A05 verification: full unit 455/455, independent final focused 16/16,
  lint, Android-test compilation, debug assembly, Sol UX/technical review, and
  Terra/High static QA passed. No device is connected, so required physical
  rotation/PlayerView/TalkBack/system-bar/audio-video/D13 acceptance is open.
- Resume implementation at MC-A06. Carry MC-A05's physical device gate into
  MC-Q01 rather than claiming the ticket fully complete.
- MC-A06 is complete in the ticket commit containing this handoff update. All
  catalog-capable Theme overflow surfaces plus anime/playlist contexts expose
  warning-safe conditional Play Video, revalidate at start, replace the queue
  with temporary Video intent, and rely on normal per-entry fallback/retry.
- MC-A06 verification: full unit 460/460, independent focused QA 33/33,
  Android-test compilation, final Kotlin compile, diff check, and corrected
  Sol/Medium review passed.
- Resume at MC-A07. Build anime-owned Related Music browsing and Search without
  a top-level Albums destination; keep READY content independent of request
  attention state and fix the debug request copy recorded above.
- MC-A07 is complete in the ticket commit containing this handoff update. It
  adds owner-safe cached/remote catalog access, Anime Detail previews, nested
  release/track browsing, Search Releases/Tracks, stable SONG queue actions,
  and the gated Now Playing Related Music destination. Ready Full Size or
  Related Music now suppresses stale request-batch copy.
- MC-A07 verification: focused checks 47/47, full unit 470/470 across 75
  suites, Android-test Kotlin compilation, debug assembly, corrected Sol UX
  and technical review passed. Terra/High executable QA passed and identified
  the explicitly carried MC-A08 playlist-sync and MC-A10 download gates. No
  device was connected.
- Resume at MC-A08. Make the currently exposed SONG Save to Playlist action
  durable by generalizing playlist writes/pulls to ordered typed items, then
  implement default/override policy and mixed-item editing. MC-A10 still owns
  generalized SONG downloads and the Related Music Download action.

## Agent model policy

- Use `gpt-5.6-luna` for Luna-mapped work when available.
- If Luna is unavailable, use `gpt-5.6-terra` as its fallback.
- Never use Sol merely as a Luna fallback.
- Sol is allowed only where the original mapping explicitly permits it: UX and
  review at Medium, and medium/high-complexity development at the specified
  Medium/High effort.
