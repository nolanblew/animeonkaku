# Anime Fetcher migration and debug-request execution plan

**Status:** Approved direction; implementation pending

**Date:** 2026-07-21

**Supersedes:** Lidarr-specific acquisition/runtime design in
`12-media-catalog-prd.md`, `13-media-catalog-tdr.md`, and tickets MC-S05,
MC-S07, MC-S08, MC-S12, and MC-Q01 where those documents conflict with this
change. Completed ticket commits remain historical implementation evidence;
replacement work is tracked explicitly below.

## 1. Decision summary

1. Anime Ongaku no longer uses Lidarr.
2. The Anime Ongaku **server** integrates with Anime Music Fetcher (AMF) at
   the first-iteration hardcoded base URL
   `http://192.168.68.68:9292/api/v1`.
3. Android never calls AMF directly. It calls an authenticated Anime Ongaku
   server endpoint so request identity, batching, persistence, polling,
   indexing, validation, and import stay server-owned.
4. Automatic scheduling is temporarily not the entry point for acceptance.
   Debug Android builds expose a **Request music** action on the anime detail
   page. The action submits the same durable server workflow that a later
   automatic trigger will use.
5. The request covers known OP/ED Full songs plus OST, character song, drama,
   and other related-music categories for that anime. AMF limits a job to 12
   artifacts, so Anime Ongaku creates deterministic batches of at most 12.
6. AMF writes processed delivery files into a dedicated shared staging tree.
   Anime Ongaku validates, indexes, and copies accepted original-format audio
   into its own existing `MEDIA_ROOT`. AMF must not write directly to
   `MEDIA_ROOT`.
7. Listener catalog behavior remains ready-or-absent. Request/search/download
   progress is visible only in the debug action and operator diagnostics, not
   normal release UX.

## 2. Authoritative AMF contract

The contract was read from the live OpenAPI 3.1 document on 2026-07-21:

- Service: Anime Music Fetcher 0.2.0.
- Health: `GET /health`; readiness: `GET /ready`.
- Submit: `POST /api/v1/jobs`, optional `Idempotency-Key` header, returns 202.
- Poll: `GET /api/v1/jobs/{job_id}`.
- Retry/cancel: `POST /api/v1/jobs/{job_id}/retry` and `/cancel`.
- File access: `GET /api/v1/jobs/{job_id}/files/{file_index}`.
- Job request:
  - multilingual anime titles;
  - one to twelve artifact items;
  - optional AniList ID and AnimeThemes slug;
  - required destination;
  - `selection_mode` of `automatic` or `review`.
- Artifact kinds: `OP`, `ED`, `OST`, `CHARACTER_SONG`, `DRAMA`, `OTHER`.
- Artifact versions: `ANY`, `TV`, `FULL`.
- Job result includes status, warnings/errors, per-item results, source files,
  and deliveries.
- Delivery files expose a stable job-local file index, path relative to the AMF
  library root, AMF-host absolute path, media/download URLs, optional size and
  SHA-256, and metadata.

Anime Ongaku must parse responses with Zod and treat undocumented status or
shape changes as typed provider failures. It must never construct a local path
from AMF's `absolute_path`; it resolves `relative_path` under the configured
read-only staging mount and enforces containment.

The project README at
`E:\Users\Nolan\Documents\AnimeMusicFetcher\README.md` was read after the live
contract. It confirms the API is intentionally unauthenticated inside a private
Compose/LAN boundary; `/downloads` and `/library` are distinct required mounts;
the job `destination` is relative to `/library`; AMF organizes a private copy
through beets before delivery; qBittorrent and AMF must see the same downloads
host directory at exactly `/downloads`; and `/config` is a separate confidential
state/work mount.

## 3. Request composition and user flow

### 3.1 Debug Android experience

- Render the action only when `BuildConfig.DEBUG` is true.
- Place it on `AnimeDetailScreen` near the anime-level actions, not on each
  individual theme row.
- Initial state: **Request music**.
- While submitting: disabled progress state.
- Accepted/already active: show a concise acknowledgement and current summary
  returned by Anime Ongaku (for example, `3 batches queued`).
- Failure: show a retryable error without losing the existing anime page.
- A repeated tap/request is idempotent; it must not create duplicate AMF jobs.
- Release builds contain no visible action and no navigation path to it.

The debug action does not expose candidate selection or file naming. Ambiguous
AMF output remains operator-review work and never becomes listener-ready.

### 3.2 Server request endpoint

Add an authenticated additive endpoint:

`POST /v1/anime/{animeId}/music-request`

The endpoint:

1. Verifies the anime is visible to the authenticated user and has mapped
   catalog metadata.
2. Loads English/Japanese/Romaji/alternate titles, AniList ID when known,
   AnimeThemes slug when known, and known OP/ED song/artist/sequence metadata.
3. Builds deterministic artifacts:
   - one `FULL` item for every known numbered OP/ED target;
   - one category request each for `OST`, `CHARACTER_SONG`, `DRAMA`, and
     `OTHER`.
4. Splits artifacts into stable batches of at most 12 without reordering.
5. Persists one anime-level request plus its batches before any remote effect.
6. Enqueues the existing database-backed job workflow; the HTTP request does
   not wait for AMF searching or downloads.
7. Returns 202 with request ID, batch count, and durable state. Replays return
   the existing active request rather than resubmitting.

The internal trigger takes a source (`DEBUG_USER` initially, `AUTOMATIC`
later) but otherwise uses the same orchestration.

### 3.3 Idempotency

- Anime Ongaku owns an immutable request UUID and stable per-batch UUIDs.
- AMF `Idempotency-Key` is derived from the persisted batch UUID, never from
  mutable display titles.
- Persist the AMF job ID before polling.
- A crash after AMF accepts a job but before Anime Ongaku records the response
  retries with the same key.
- Repeated debug requests reuse an active request. A new terminal retry is an
  explicit server operation and receives new request/batch UUIDs.

## 4. Storage and vfolder contract

Use separate ownership boundaries:

```text
vdrive/
  anime-fetcher/
    downloads/                 # AMF/qBittorrent working data, if required
    library/
      anime-ongaku-staging/    # processed AMF deliveries shared with Ongaku
  anime-ongaku/
    media/                     # canonical Anime Ongaku MEDIA_ROOT
```

Recommended mounts:

| Host directory | AMF access | Anime Ongaku access | Purpose |
|---|---|---|---|
| `anime-fetcher/downloads` | read-write at the same `/downloads` path in AMF and qBittorrent | none | Required AMF/qBittorrent temporary and retained downloads |
| `anime-fetcher/library` | read-write at `/library` | read-only at a server-local staging path | AMF library root and processed delivery manifests/files |
| `anime-ongaku/media` | none | read-write | canonical listener-ready media managed only by Anime Ongaku |

AMF job destinations should be relative paths beneath its library root:

`anime-ongaku-staging/anime-{animeId}/request-{requestId}/batch-{batchIndex}`

Keep `AMF_CONFIG_PATH` on a separate private persistent path mounted only at
`/config`; it contains SQLite, tracker/source settings, credentials, and
temporary processing copies. Do not place it in the media vfolder. Do not
expose Anime Ongaku `MEDIA_ROOT` to AMF. If AMF and qBittorrent already share a
downloads host volume mounted at `/downloads` in both containers, only the
library/staging directory needs to be added to the new media vfolder.

Anime Ongaku receives a configured server-readable root for
`anime-fetcher/library` even though the AMF API base URL is hardcoded for this
iteration. It validates every delivery relative path, extension, size/hash when
provided, real path, and containment before invoking the existing atomic media
importer.

AMF may deliver `ape` and `wv` in addition to Anime Ongaku's currently
supported FLAC/MP3/M4A/AAC/Ogg/Opus/WAV set. The first iteration must leave APE
and WavPack unready with an operator-visible warning unless Android Media3,
streaming MIME behavior, and downloads are first proven and added under their
own regression coverage.

## 5. Replacement ticket sequence

### MC-S05R — Replace Lidarr with the AMF 0.2 job client

- Remove Lidarr runtime/config selection, HTTP factory, adapter, and deployment
  requirements.
- Keep provider-neutral domain contracts only where they still model AMF jobs
  cleanly; revise rather than force Lidarr resource semantics onto AMF.
- Add the hardcoded first-iteration AMF base URL, Zod DTOs, health/readiness,
  submit, poll, retry/cancel, and delivery parsing.
- Map retryability for network, 4xx, 429, 5xx, malformed payload, and unknown
  status cases.
- Use header idempotency and redact URLs/paths at normal log levels.
- TDD: OpenAPI-shaped fixtures, idempotent replay, status matrix, malformed
  response, and relative-path safety.
- Gate: focused tests, full server Vitest, typecheck, independent review.

### MC-S07R — Add durable whole-anime request orchestration

- Add anime request/batch persistence and generated migration.
- Add authenticated request route and deterministic artifact/batch builder.
- Route both debug and future automatic triggers through one service.
- Enqueue/poll with the existing database-backed worker and no sleeping worker.
- Preserve active-request idempotency and crash windows around AMF submission.
- Keep automatic catalog scheduling disabled for the first controller
  acceptance pass; do not delete the reusable scheduler infrastructure.
- TDD: title/item composition, >12 batching, user/anime guard, duplicate taps,
  crash/restart recovery, provider outage, and PostgreSQL concurrency.
- Gate: focused tests, real PostgreSQL integration, full server suite,
  typecheck, independent review.

### MC-S08R — Index and import validated AMF deliveries

- Poll terminal jobs and persist per-item result/warning/delivery evidence.
- Resolve AMF `relative_path` only under the shared read-only staging root.
- Reconcile known OP/ED deliveries to existing Full Size targets and map
  OST/character/drama/other deliveries to Related releases/songs.
- Require unambiguous item/file ownership; ambiguous or possible results remain
  hidden for operator review.
- Reuse the MC-S03 original-byte atomic importer and existing catalog READY
  transaction boundaries.
- Preserve filename only as source metadata; generate canonical Anime Ongaku
  storage paths. AMF/beets performs the initial organization. Do not rename a
  manifest-referenced staging file during automatic import; use AMF's operator
  selection/research/reprocess flow for ambiguous assignments and keep the
  Anime Ongaku request pending until its manifest is stable.
- TDD: multi-delivery categories, missing/hash-conflicting files, traversal and
  symlink escape, duplicate songs, partial batches, retries, and crash points.
- Gate: temp-file tests, real PostgreSQL publication tests, full suite,
  typecheck, independent QA/review.

### MC-A00 — Add the debug-only anime request action

- Add the Retrofit/server DTOs and repository/ViewModel action.
- Render the anime-level action only under `BuildConfig.DEBUG`.
- Model idle/submitting/accepted/error state and prevent concurrent taps.
- Preserve all existing anime detail playback/library behavior.
- TDD: ViewModel idempotency/error recovery and Compose visibility/action tests
  for debug versus release configuration where the test harness permits.
- Gate: Android unit suite, lint, debug assembly, UX review, and device smoke
  against the real Anime Ongaku server plus AMF controller.

### MC-S12R — Replace operator/deployment surfaces

- Replace Lidarr diagnostics/docs with AMF health/readiness, request/batch/job
  diagnostics, retry/cancel/reprocess, and staging cache cleanup.
- Document the hardcoded first-iteration address and the future configuration
  follow-up.
- Document the three directory ownership boundaries and container/vfolder
  mounts.
- Never delete AMF files unless an operator action targets an Anime
  Ongaku-owned staging request and the final canonical copy is verified.

### MC-Q01R — Controller and staging acceptance

- Start with automatic scheduling off.
- Request a curated set from debug anime detail pages, including a >12-item
  batch, multilingual titles, missing categories, ambiguous candidates, OST,
  character songs, drama, and duplicate/reused tracks.
- Inspect Anime Ongaku request rows, AMF job/item results, staged files,
  canonical imports, and ready-only listener projection.
- Verify repeated taps/restarts/outages do not duplicate remote jobs or media.
- Verify release builds do not expose the request action.
- Only after this passes may later work re-enable the automatic trigger.

## 6. Updated delivery order

1. MC-S05R — AMF client and removal of Lidarr runtime.
2. MC-S07R — durable request endpoint/orchestration.
3. MC-A00 — debug request UX; it may start after the S07R API contract is
   stable.
4. MC-S08R — delivery indexing/import and controller end-to-end flow.
5. MC-S12R — operator diagnostics and deployment/vfolder documentation.
6. MC-Q01R — real controller, filesystem, server, and debug-device acceptance.
7. Resume unaffected MC-S11 and then MC-A01 through MC-A11. Reconcile any DTO
   changes from the replacement tranche before Android catalog migration work.
8. Run the original MC-Q01 scope after all server and Android catalog tickets,
   substituting AMF for Lidarr and retaining MC-Q01R evidence.

Each replacement ticket receives RED-before-production evidence, light review,
completion/testing notes in `14-media-catalog-tickets.md`, and its own commit.
Large completed sections receive independent Terra/High QA and Sol/Medium
review/UX evaluation under the established model policy.

## 7. Deferred follow-ups

- Replace the hardcoded AMF base URL with validated deployment configuration
  after the first controller acceptance pass.
- Enable automatic requests only after MC-Q01R proves request construction,
  matching, staging, and canonical import on the curated set.
- Decide whether operator review uses AMF's selection/file-assignment endpoints
  directly or an Anime Ongaku admin surface. This is not part of the debug
  listener action.
- If the AMF README or OpenAPI version changes, re-read both before changing
  request, status, cleanup, or mount behavior.
