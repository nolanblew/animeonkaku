# AMF fetching robustness review

**Status:** Review only — no code changed
**Date:** 2026-07-26
**Branch reviewed:** `feature/media-catalog-initiative` @ `69110d7`
**Base:** `feature/server-initiative` (merge-base `b44e2bf`)
**Relates to:** `16-anime-fetcher-migration-plan.md`, `14-media-catalog-tickets.md`
(MC-S05R, MC-S07R, MC-S08R, MC-S12R, MC-A00, MC-Q01R — all marked ✅ Complete),
`17-media-catalog-acceptance-report.md`

---

## 1. Method and evidence

This review compared the branch against its base, read the AMF integration code
end to end, and — most importantly — read the **live** controller rather than
trusting the contract snapshot in doc 16.

Live sources read on 2026-07-26:

- `GET http://192.168.68.68:9292/openapi.json` — Anime Music Fetcher 0.2.0.
  (Note: `/api/v1/openapi.json` is a 404; the document lives at the origin.)
- `GET /health` → `{"status":"ok"}`; `GET /ready` → `{"status":"ready",
  "database":true,"prowlarr_configured":true,"custom_source_count":1,
  "qbittorrent_configured":true}`.
- `GET /api/v1/jobs?limit=100` — 44 real jobs, all of them Anime Ongaku-created
  (`destination` = `anime-ongaku-staging/request-*/batch-*`).
- `E:\Users\Nolan\Documents\AnimeMusicFetcher\{README.md,API.md,API_INTEGRATION.md}`.

### 1.1 What the live controller actually looks like

| Measure | Value |
|---|---|
| Jobs total | 44 |
| **Root jobs (submitted by Anime Ongaku)** | **10** |
| **Child / follow-up jobs (created by AMF)** | **34** |
| Job statuses | `awaiting_selection` 29, `archived` 6, `completed_with_warnings` 6, `completed` 2, `download_stalled` 1 |
| Item-result statuses | `delegated` 30, `not_found` 23, `delivered` 20, `possible` 15, `found` 3 |
| Delivered items on **root** jobs | 20 |
| Delivered items on **child** jobs | 0 (all children are still `awaiting_selection` or `archived`) |
| Child jobs whose `destination` equals the parent's | 34 / 34 |

Representative root job `ef75e439` (Your Lie in April, 9 items):

```
0 OP1  delivered  files=3
1 OP2  delivered  files=2
2 ED1  delivered  files=3
3 ED2  delivered  files=3
4 ED3  delegated  files=0  follow_up_job_id=5d8c3275
5 OST  delivered  files=71
6 CHARACTER_SONG delegated files=0 follow_up_job_id=8c5c5287
7 DRAMA          delegated files=0 follow_up_job_id=903e2078
8 OTHER          delegated files=0 follow_up_job_id=607ff60b
warnings: ["No release found for requested item indexes: 4, 6, 7, 8",
           "Separate follow-up searches were queued for requested item indexes: 4, 6, 7, 8"]
```

**Follow-up delegation is not an edge case on this controller — it is the
majority of the job graph (34 of 44 jobs, 30 of 91 item results).**

---

## 2. Branch delta vs `feature/server-initiative`

245 files, ~48.8k insertions. The fetching-relevant additions are:

| Area | Added on this branch |
|---|---|
| `server/src/music/animeMusicFetcher/` | AMF 0.2 client, Zod schemas, typed errors, background HTTP lane |
| `server/src/music/requests/` | request/batch builder, durable orchestration, poll/submit handlers, delivery indexing + atomic import, PG repository |
| `server/src/music/operator/` | `/v1/admin/music/*` diagnostics, retry/cancel/reprocess, staging-cleanup dry run |
| `server/src/music/{matching,import,discovery}/` | AnimeThemes matching/resolver, acquisition import, discovery scheduler (disabled) |
| `server/drizzle/0008…0014` | media-catalog schema, request/batch/item/delivery tables, release track ordering, AMF localized metadata |
| Android | debug `Request music` action + `MusicRequestCoordinator`, playback modes, Related Music, mixed queues, video, mode-specific reactions/history |
| `.planning/12…17` | PRD, TDR, tickets, handoff, AMF migration plan, acceptance report |

Nothing on the branch references Lidarr in runtime code — the only remaining
mentions are the historical planning docs and two tests asserting the removal.
The Lidarr→AMF swap itself is clean and complete.

---

## 3. Findings

Severity is about *fetching reliability*, not security. Nothing here is a
security defect: path containment, hash/size verification, redaction, and
`absolute_path` rejection are all implemented correctly and hold up under review.

### F1 — Delegated follow-up jobs are never polled or imported 🔴 Critical

**What the provider does.** `API.md`:

> a delegated item includes `follow_up_job_id`. The parent also exposes
> `follow_up_jobs` … Fetch the linked child job to monitor or operate its
> independent work.

`API_INTEGRATION.md`: *"When `status` is `delegated`, follow `follow_up_job_id`
and poll that child job normally."*

**What Anime Ongaku does.** `animeMusicFetcher/schemas.ts` `amfRawJobSchema` does
not pick `parent_job_id`, `parent_item_index`, or `follow_up_jobs`, and
`amfItemMatchResultSchema` does not pick `follow_up_job_id`. All four fields are
silently dropped by Zod. `requests/handlers.ts` polls exactly one job id per
batch. `requests/deliveryService.ts:42` skips any item whose
`resultStatus !== "delivered"`.

**Consequences, in order of severity:**

1. **Content is never imported.** Every delegated item's audio — which the
   operator may have already selected and AMF may have already delivered — is
   invisible to Anime Ongaku forever. Today that is 30 items across 8 anime.
2. **The request never terminates.** `recordProviderEvidence` marks non-delivered
   items `ATTENTION` once evidence is final; `finishBatch` then returns
   `AWAITING_OPERATOR`, which is not terminal, so `completed_at` stays `NULL`.
3. **The anime is permanently blocked.** `repository.createOrReplay` treats
   "active" as `completed_at IS NULL` per anime, so the debug action replays the
   stuck request forever and no new request can ever be made for that anime.
   There is no operator action to close a request (see F3).
4. **Orphan staging files.** All 34 children write into the *same*
   `destination` as their parent. Child deliveries land in the batch staging
   directory with no `anime_music_request_deliveries` row. `cleanupEligibility`
   only counts rows it knows about, so a dry run can report "eligible" for a
   directory that still holds unimported audio.

**Proposed change.** Model the provider job graph, not a single job:

- Parse and persist `parent_job_id`, `parent_item_index`, `follow_up_jobs`, and
  `follow_up_job_id`.
- Give a batch *many* provider jobs (`anime_music_request_batch_jobs`, or an
  `amf_job_id` on a per-item link row) instead of one `amf_job_id` column.
- On each poll, discover children transitively from `follow_up_jobs` and enqueue
  a poll per newly discovered job; a batch is provider-terminal only when the
  root and every descendant are terminal.
- Attribute a child job's item-0 result back to `(parent batch, parent_item_index)`
  so the existing item/delivery/import machinery is reused unchanged. Keep the
  destination-prefix containment check — it still holds, since children share the
  parent destination.
- Guard against cycles and unbounded fan-out (cap descendants per batch; a child
  can itself delegate).

### F2 — A strict status enum turns normal provider states into hard failures 🟠 High

`schemas.ts` declares `AMF_JOB_STATUSES` as a 13-value `z.enum`. The live
OpenAPI declares `JobRead.status` as a plain `string`, and the controller is
already returning a 14th value:

```
statuses: awaiting_selection 29, archived 6, completed_with_warnings 6, completed 2, download_stalled 1
```

`archived` (from `POST /api/v1/jobs/{id}/archive`) is in the API surface, is live
on 6 jobs, and appears in neither the README nor `API.md`. Under the current
code an unknown status fails the whole-document parse →
`amfMalformedResponse` → `retryable: false` → `handleProviderError` writes
`state: "FAILED"` with a raw provider message. This is asserted deliberately by
`music.animeMusicFetcherClient.test.ts:516` (`"brand_new_status"` must be
`MALFORMED_RESPONSE`).

Today this is latent rather than active *only* because all 6 archived jobs are
children, which we never poll (F1). The moment an operator archives a root job —
or F1 is fixed and children are polled — an unrelated provider bookkeeping action
silently marks an Anime Ongaku request `FAILED`.

Same class of problem: `DELETE /api/v1/jobs/{job_id}` ("remove a terminal job
record") makes a subsequent poll return 404 → `NOT_FOUND`, non-retryable →
`FAILED`.

**`archived` semantics — decided 2026-07-26.** `archived` means **closed for
now, not closed forever.** An archived job may later gain the song(s) for its
item, so Anime Ongaku must **never stop importing from it.** It is a *dormant*
provider state, not a terminal one:

- Keep the provider job in the recheck lane indefinitely, at the slowest
  cadence (F4).
- Keep ingesting evidence and importing deliveries whenever they appear — an
  archived job that later reports `delivered` items must flow through the normal
  import path with no operator action.
- Dormancy is about the *provider job*, not the *Anime Ongaku request*. A
  request may be closed so its anime is re-requestable (F3) while its dormant
  provider jobs keep being observed; a late delivery still imports and still
  publishes to the catalog.

**Proposed change.**

- Parse `status` as `z.string()`; map known values to the domain state; map
  unknown values to a new `UNKNOWN_PROVIDER_STATUS` outcome that is
  **non-terminal, non-failing, operator-visible**, and preserves the rest of the
  document (item results and deliveries stay importable).
- Add `archived` as a **dormant** state: never terminal, never failing, polled
  forever at the slowest cadence, always importable.
- Treat a 404 on poll as the one genuine stop condition — the provider no longer
  holds the record, so there is nothing left to observe. Record it as
  provider-gone attention, not `FAILED`.
- Keep the strict enum only for *outbound* request construction.
- Add a diagnostics counter for unknown statuses seen, so contract drift is
  visible without breaking ingestion.

### F3 — Requests have no terminal path and no way to close 🟠 High

Beyond F1, several ordinary outcomes strand a request active forever:

- Every item `not_found` → all items `ATTENTION` → `AWAITING_OPERATOR` → no
  `completed_at`.
- Any item delegated (F1).
- Any delivery rejected by the importer, including an unsupported extension (F6).
- `awaiting_selection` with no operator ever acting.

`MusicOperatorService.enqueueAction` supports only `RETRY_PROVIDER`,
`CANCEL_PROVIDER`, and `REPROCESS_PROVIDER`, and each is gated on a specific
provider status. There is **no** action that resolves the Anime Ongaku side of a
request. So a request that AMF is finished with, but that has one unresolved
item, blocks its anime forever, and the debug UI shows "Needs operator review"
with the action disabled.

**Closing a request must not stop observation.** Per the `archived` decision in
F2, "the Anime Ongaku request is closed" and "the provider job is finished" are
separate facts. Closing frees the anime for a fresh request and clears the debug
UI; the provider jobs behind it stay in the dormant recheck lane forever, and any
delivery that shows up later still imports and still publishes. Closing must
therefore never detach, delete, or tombstone the batch's provider jobs, items, or
delivery rows.

**Proposed change.**

- Add `CLOSE_REQUEST` / `ABANDON_BATCH` operator actions that mark remaining
  non-READY items *closed-pending* (not "will never happen"), set `completed_at`
  on the Anime Ongaku request, and free the anime for a fresh request. Never
  delete or touch imported media, staging files, or provider job links.
- Distinguish three classes rather than two:
  - **operator must act** — `awaiting_selection`, `awaiting_file_selection`;
  - **dormant, keep watching** — `archived`, `not_found`, `download_stalled`,
    unknown status; auto-close the *request* once no provider work is active,
    while the jobs stay in the slow recheck lane;
  - **provider gone** — poll 404; nothing left to observe, stop the lane.
- A late import into a closed request must still publish to the catalog and must
  not resurrect or reopen the request. If a newer request for the same anime
  already exists, content-hash dedupe in `reserveCatalog` already prevents a
  duplicate song; verify that path explicitly.
- Give Android an explicit re-request affordance from `TerminalAttention` /
  `AwaitingOperator` once closing is possible. Currently
  `MusicRequestCoordinator.request()` returns early unless the state is `Idle` or
  `SubmissionError`.

### F4 — The poll loop has no backoff and never stops 🟠 High

`requests/handlers.ts:40`:

```ts
if (!isTerminal(providerJob.status))
  throw new RetryableJobError("AMF batch is still active",
    { incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS }); // 5s
```

`incrementAttempts: false` means `maxAttempts: 8` never applies, and
`retryAfterMs` overrides `backoffMs` entirely. `awaiting_selection` and
`download_stalled` map to `AWAITING_OPERATOR` but are not terminal, so **every
batch waiting on a human is polled every 5 seconds forever**, each poll
rewriting the full `manifest_evidence` JSON blob
(`recordProviderEvidence` runs on every poll for these statuses). With 29 live
`awaiting_selection` jobs this is a permanent load floor on both services and a
permanent write floor on Postgres.

The infrastructure to do this properly already exists:
`MusicRequestService.recheckIncomplete()` runs every 15 minutes and its own
comment says it exists so a hot poll is *not* kept running while an operator
decides. The handler was never changed to match.

**Proposed change — decided 2026-07-26: escalating backoff, capped at 20
minutes.** Keep the 5s interval only for machine-active statuses (`queued`,
`searching`, `selected`, `submitting`, `downloading`, `processing`). For
operator-wait and dormant states (`awaiting_selection`,
`awaiting_file_selection`, `download_stalled`, `archived`, unknown), escalate the
poll interval by consecutive unchanged observations and cap it at **20 minutes**:

```
5s → 30s → 2m → 5m → 10m → 20m (cap, held indefinitely)
```

The ladder resets to 5s whenever the provider document changes (status, item
results, or deliveries), so an operator selecting a release in AMF's UI is picked
up within one interval and the batch immediately returns to fast polling.

Because the cap is *never* removed, a dormant/archived job keeps being observed
forever at 20-minute cost — that is what makes F2's "never stop importing"
affordable.

Interaction with the existing sweep: `recheckIncomplete()` runs every 15 minutes
and enqueues with the same `POLL_AMF_MUSIC_BATCH:{batchId}` dedupe key. Verify
that enqueueing against an already-`QUEUED` job with a future `next_run_at` is a
no-op rather than a reschedule-to-now — otherwise the sweep silently floors the
ladder at 15 minutes and the 20-minute cap never applies. If it does reschedule,
either make the sweep respect a persisted `poll_not_before` on the batch, or
retire the sweep and let the ladder be the only scheduler (keeping the sweep's
crash-recovery role via `listRecoverableBatches`).

Also skip the `recordProviderEvidence` write when the manifest is unchanged — the
ladder already depends on detecting "unchanged", so the comparison is free.

### F5 — We throw away identity we already have 🟡 Medium

`JobCreate` accepts `anilist_id`, `animethemes_slug`, `quality`, and per-item
`song_titles`/`album_titles`/`artist_names`/`search_terms`.
`requests/builder.ts` sends: titles, `items` (kind/number/version/
release_preference/`song_titles.romaji`/`artists`), `metadata_lookup: true`,
`destination`, `selection_mode`. It never sends `anilist_id`, `animethemes_slug`,
`quality`, `album_titles`, `artist_names`, or `search_terms`.

Live evidence that this matters — the stored `request_payload` shows AMF's own
enrichment filling the gap, with mixed success:

| Root job | `anilist_id` AMF resolved | `animethemes_slug` | Outcome |
|---|---|---|---|
| `ef75e439` Your Lie in April | 20665 | `null` | completed_with_warnings, 4 delegated |
| `15a8b67a` Takagi-san | 99468 | `null` | completed_with_warnings, 10 delegated |
| `b4d97229` Kimizero | 154459 | `null` | **download_stalled**, 4 delegated |
| `35d535d6` Kimizero | **null** | `null` | awaiting_selection |

`animethemes_slug` is `null` on every job because
`server/src/db/schema.ts` `animethemes_anime` has no `slug` column — the server
never persists it, so `loadMetadata` cannot supply it. AMF resolving
`anilist_id: null` on one request is exactly the ambiguity that a slug would
remove.

**Proposed change.**

- Persist `animethemes_anime.slug` during AnimeThemes sync and pass it as
  `animethemes_slug`. This is the single highest-value precision change: it pins
  the exact AnimeThemes entry instead of letting AMF re-derive identity from
  translated titles.
- Send `song_titles` with all three localizations (we now retain
  `title_en`/`title_romaji`/`title_ja` after MC localization work) rather than
  only `romaji`, and send `artist_names` alongside the plain `artists` array.
- Send `quality.preferred_formats` restricted to the set Anime Ongaku can
  actually import (see F6).

### F6 — Formats AMF supports but the importer rejects 🟡 Medium

AMF's supported extension set is `flac, mp3, m4a, aac, ogg, opus, wav, ape, wv`.
`requests/deliveryImporter.ts` `SUPPORTED_AUDIO_EXTENSIONS` omits `ape` and `wv`
— a deliberate MC-S05R decision (doc 16 §4). But the rejection path is
`AmfDeliveryValidationError` → `markAttention` → item `ATTENTION` → per F3, the
whole request is blocked forever by a file we asked for and then refused.

**Proposed change.** Prevent rather than reject: pass
`quality.preferred_formats` / `excluded_terms` so AMF does not select APE/WavPack
releases in the first place. Keep the importer guard as defence in depth, but
classify "unsupported format" as a *closable* outcome distinct from "needs
operator review".

### F7 — Whole-batch import of a 71-file OST 🟡 Medium

Root job `ef75e439` item 5 delivered **71 files** for one OST request item. The
import is one `IMPORT_AMF_MUSIC_BATCH` job iterating deliveries sequentially, and
each file is read in full **twice**: once by `validateAmfDeliveryFile` (SHA-256)
and once by `mediaStore.importLocalSongFile` (copy + verify). For a FLAC
soundtrack that is multiple GB of I/O inside a single queue job, holding a
`pg_advisory_lock` per file.

The design *is* restart-safe — `publishDelivery` commits per file and re-entry
skips `READY` deliveries — so this is a throughput/latency concern, not a
correctness one.

**Proposed change.** Split import into per-item (or chunked per-N-deliveries)
queue jobs so progress is visible, the queue is not head-of-line blocked, and a
single bad file cannot stall an album. Consider reusing the validation hash as
the import hash instead of re-reading.

### F8 — Stored request bodies are re-validated with the current schema 🟡 Medium

`repository.ts` `mapBatch` runs `amfJobCreateSchema.parse(row.amf_request_body)`
on **every** batch read. The body was already validated at write time. If the
schema is ever tightened — which F5 and F6 both imply — existing rows stop
parsing and every route and handler touching those batches throws, including
recovery sweeps. Parse leniently on read (or store and replay the body as an
opaque blob) and keep strict validation on the write path only.

### F9 — Diagnostics do not describe the real job graph 🟡 Medium

`/v1/admin/music/diagnostics` reports provider health/readiness and
active/attention/failed request counts. It cannot answer any of the questions
this review had to answer by hand: how many delegated items are outstanding,
which child jobs exist, which batches are hot-polling, which staging directories
hold files with no delivery row, which unknown statuses were seen.

`cleanupEligibility` is actively misleading under F1 — it can report eligible for
a directory containing unimported child-job audio.

**Proposed change.** Extend diagnostics with per-request job-graph detail
(root + descendants, item coverage by status, delegated backlog, last poll time,
unknown-status counter) and make cleanup eligibility require that the staging
directory contains no untracked audio files.

### F10 — Hardcoded base URL 🔵 Low (known)

`AMF_API_BASE_URL = "http://192.168.68.68:9292/api/v1"` in `client.ts`, with
health/readiness derived from its origin. Already listed as a deferred follow-up
in doc 16 §7; restating it here so it lands in a ticket. Note the derivation
detail when configuring: `/health` and `/ready` are at the **origin**, not under
`/api/v1`, and `openapi.json` is at the origin too.

### F11 — Unused provider capability 🔵 Low

Available and unused: `POST /api/v1/search/preview` (dry-run a search before
creating a durable request — a cheap way to avoid persisting requests that will
find nothing), `GET /api/v1/logs`, `GET|PUT /api/v1/settings/{sources,worker}`,
`GET /jobs/{id}/source-files/{i}`, `POST /jobs/{id}/{review,research,select,files/select}`
(the operator-selection flow that would let Anime Ongaku resolve
`awaiting_selection` instead of waiting on AMF's own UI).

`POST /jobs/{id}/files/select` plus `/research` is the natural mechanism behind
F3's close/resolve actions if we ever want operator review inside Anime Ongaku
rather than in AMF's UI — doc 16 §7 left that decision open.

### F12 — Planning-doc drift 🔵 Low

`12-media-catalog-prd.md`, `13-media-catalog-tdr.md`, and
`14-media-catalog-tickets.md` still contain Lidarr-era acquisition design.
Doc 16 supersedes them by declaration, but the superseded MC-S05/S07/S08/S12/Q01
tickets sit inline next to their R-replacements. Worth an explicit strikethrough
pass so the next reader does not implement the wrong contract.

---

## 4. Proposed ticket sequence

Ordered so each ticket is independently shippable and the highest-risk gap
closes first.

### MC-S13 — Poll the provider job graph, not a single job

| Field | Value |
|---|---|
| Status | 📋 Proposed |
| Area | Server / AMF client + request orchestration |
| Difficulty | High |
| Effort | L, 4–5 days |
| Addresses | F1 |
| Depends on | MC-S05R, MC-S07R, MC-S08R |

- Parse and persist `parent_job_id`, `parent_item_index`, `follow_up_jobs`,
  `follow_up_job_id`.
- Migration: batch → many provider jobs; keep `amf_job_id` as the root for
  backward compatibility.
- Transitive child discovery on poll, with cycle and fan-out bounds.
- Attribute child item-0 results and deliveries to the parent item so existing
  import/matching/publication paths are unchanged.
- Provider-terminal only when the whole graph is terminal.
- TDD: parent with N delegated children; child that itself delegates; child
  delivering into the shared destination; cycle guard; a child appearing on a
  later poll; recovery after restart mid-graph; PostgreSQL concurrency.
- Backfill: re-poll the 10 existing live root jobs and adopt their 34 children.

### MC-S14 — Tolerate unknown and archived provider states

| Field | Value |
|---|---|
| Status | 📋 Proposed |
| Area | Server / AMF client |
| Difficulty | Medium |
| Effort | M, 2 days |
| Addresses | F2 |

- `status` as `z.string()`, mapped; unknown → non-terminal, non-failing,
  operator-visible; document/evidence preserved.
- `archived` as **dormant**: never terminal, never failing, kept in the recheck
  lane forever, always importable. Poll 404 is the only stop condition.
- Replace the "unknown status is malformed" test with "unknown status is
  tolerated and counted".
- Diagnostics counter for unknown statuses.
- TDD: an archived job that later reports `delivered` items imports normally
  with no operator action; an archived job is never marked terminal and never
  sets `completed_at` on its own.

### MC-S15 — Give requests a terminal path

| Field | Value |
|---|---|
| Status | 📋 Proposed |
| Area | Server / operator surface + Android debug action |
| Difficulty | Medium |
| Effort | M, 2–3 days |
| Addresses | F3 |
| Depends on | MC-S13, MC-S14 |

- `CLOSE_REQUEST` / `ABANDON_BATCH` operator actions and routes; never touch
  imported media, staging bytes, or provider job links.
- Three-way split: operator-must-act / dormant-keep-watching / provider-gone.
  Auto-close the *request* for the dormant class while its jobs stay in the slow
  lane.
- A delivery arriving after closure still imports and publishes, and does not
  reopen the request.
- Android: allow re-request from terminal-attention states.
- TDD: close a request with a dormant archived job, then have that job deliver —
  the song publishes, the closed request stays closed, and a newer request for
  the same anime does not duplicate the song.

### MC-S16 — Back off polling to match the wait (20-minute cap)

| Field | Value |
|---|---|
| Status | 📋 Proposed |
| Area | Server / job handlers |
| Difficulty | Low |
| Effort | S, 1 day |
| Addresses | F4, and the evidence-write half of F8 |

- 5s only for machine-active statuses.
- Escalating ladder for operator-wait and dormant states:
  `5s → 30s → 2m → 5m → 10m → 20m`, cap held indefinitely, reset to 5s on any
  change to the provider document.
- Persist the attempt/next-poll state on the batch so the ladder survives
  restarts, and confirm the 15-minute `recheckIncomplete` sweep cannot floor it.
- Skip `recordProviderEvidence` when the manifest is byte-identical.
- TDD: an unchanged `awaiting_selection` batch reaches the 20-minute cap and
  stays there; a status change drops it back to 5s within one interval; an
  `archived` batch keeps polling at the cap forever and never terminates.

### MC-S17 — Send the identity and quality we already know

| Field | Value |
|---|---|
| Status | 📋 Proposed |
| Area | Server / AnimeThemes sync + request builder |
| Difficulty | Medium |
| Effort | M, 2 days |
| Addresses | F5, F6 |

- Add and backfill `animethemes_anime.slug`; pass `animethemes_slug`.
- Pass full localized `song_titles`/`album_titles`/`artist_names`.
- Pass `quality.preferred_formats` limited to importable formats.
- Classify unsupported-format deliveries as closable, not blocking.
- TDD: builder snapshot per anime shape; slug present/absent; unsupported-format
  delivery closes the item without stranding the request.

### MC-S18 — Split delivery import and harden persisted-body reads

| Field | Value |
|---|---|
| Status | 📋 Proposed |
| Area | Server / delivery import + repository |
| Difficulty | Medium |
| Effort | M, 2 days |
| Addresses | F7, F8 |

- Per-item (or chunked) import jobs; single hash pass per file.
- Lenient read-side parsing of `amf_request_body`.

### MC-S19 — Diagnostics for the job graph and staging truth

| Field | Value |
|---|---|
| Status | 📋 Proposed |
| Area | Server / operator surface |
| Difficulty | Low |
| Effort | S, 1 day |
| Addresses | F9, F10, F12 |
| Depends on | MC-S13 |

- Per-request job graph, delegated backlog, poll cadence, unknown-status counts.
- Cleanup eligibility requires no untracked audio under the staging destination.
- Replace the hardcoded base URL with validated config (origin-derived
  `/health`, `/ready`); document the derivation.
- Strikethrough pass on superseded Lidarr sections in docs 12–14.

### MC-Q02 — Re-acceptance on the live controller

| Field | Value |
|---|---|
| Status | 📋 Proposed |
| Area | Server + AMF deployment + debug device |
| Difficulty | High |
| Effort | M, 2–3 days |
| Depends on | MC-S13 … MC-S19 |

Use the **existing** 44-job live state as the fixture — no new large downloads
needed:

1. Adopt the 34 existing child jobs; confirm every delegated item now has a
   tracked provider job and that resolving one in AMF's UI flows through to a
   READY Anime Ongaku delivery.
2. Archive a root job in AMF; confirm the Anime Ongaku request does **not** go
   `FAILED` and does not go terminal — the job stays dormant and keeps polling at
   the 20-minute cap.
3. Un-archive / resolve one of the 6 existing archived child jobs so it delivers;
   confirm the file imports and publishes with no operator action on the Anime
   Ongaku side, including when its request was already closed.
4. Confirm an unchanged `awaiting_selection` batch walks the ladder to the
   20-minute cap, and that acting on it in AMF's UI returns it to 5s polling
   within one interval.
5. Close a stuck request from the operator surface; confirm the debug action
   returns to `Request music` for that anime, a new request creates new
   request/batch UUIDs and a new destination, and the closed request's dormant
   jobs are still being observed.
6. Confirm staging cleanup reports ineligible while untracked child audio exists.

---

## 5. What is already solid

Worth recording so it does not get re-litigated:

- Path safety is genuinely good: `absolute_path` is required on the wire and
  dropped after validation, `relative_path` is containment-checked against both
  the configured library root (via `realpath`) and the persisted batch
  destination, symlink escape is covered, and `\`/drive-letter/UNC forms are
  rejected.
- Redaction of URLs, magnets, and container paths in labels, warnings, and
  error stages is consistent.
- Idempotency is correct: keys derive from persisted batch UUIDs, never from
  mutable titles, and the accept-before-persist crash window is covered by test.
- Import atomicity, per-delivery publication, content-hash dedupe across
  deliveries, and re-entrant `READY` skipping are all right, and the restart
  proof in doc 17 holds.
- The Android coordinator's polling, cancellation, and catalog-refresh
  triggering are clean; the debug gating is enforced in both Compose and the
  ViewModel.

The gaps above are all about **the provider's real behaviour differing from the
contract snapshot doc 16 was written against** — chiefly follow-up delegation,
which the README documents but which the implementation predates.
