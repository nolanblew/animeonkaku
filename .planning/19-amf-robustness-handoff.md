# AMF robustness — running handoff log

**Purpose:** Anyone picking this work up mid-flight should be able to read only
this file and continue. Updated after every ticket. Newest entry at the bottom of
§4.

**Work item source:** `18-amf-fetch-robustness-review.md` (findings F1–F12,
tickets MC-S13 … MC-S19, MC-Q02).
**Branch:** `feature/media-catalog-initiative`. No PR is to be created.

---

## 1. Ground rules for this tranche

- One commit per ticket. Conventional-commit style matching branch history
  (`fix(music):`, `feat(server):`, …). No PR at the end.
- Verification gate before every commit, run from `server/`:
  ```powershell
  & 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
  & 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit
  ```
- Android gate (only for tickets touching `src/`), from `src/`:
  ```powershell
  $env:ANDROID_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\android-sdk'
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $env:JAVA_HOME = 'F:\Program Files (x86)\Microsoft Visual Studio\Shared\Android\openjdk\jdk-21.0.8'
  $env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;C:\Windows\System32;$env:Path"
  .\gradlew.bat --no-daemon test
  ```
- TDD: RED before production code. The review doc lists required cases per
  ticket; treat those as the minimum.
- **Baseline at tranche start (2026-07-26):** server 52 files / 453 tests passed,
  10 files / 22 tests skipped (environment-gated, need `TEST_DATABASE_URL`);
  `tsc --noEmit` exit 0. Any deviation is caused by this tranche, not inherited.

## 2. The two decisions that drive most of this work

1. **`archived` means "closed for now", never "closed forever."** An archived AMF
   job may later gain its song(s). Anime Ongaku must never stop importing from
   it. Archived is *dormant*, not terminal: polled forever at the slowest
   cadence, always importable, never `FAILED`. The only genuine stop condition is
   a poll 404 (the provider no longer holds the record).
2. **Closing an Anime Ongaku request ≠ finishing the provider job.** Closing
   frees the anime to be re-requested and clears the debug UI; the provider jobs
   behind it stay under observation forever. A delivery arriving after closure
   still imports and publishes, and must not reopen the request.

Consequence to keep in mind everywhere: *nothing in this tranche may introduce a
state that permanently stops observation or import,* except a poll 404.

## 3. Live controller facts (measured 2026-07-26)

- AMF 0.2.0 at `http://192.168.68.68:9292`; OpenAPI at the **origin**
  (`/openapi.json`), `/health` and `/ready` also at the origin, not under
  `/api/v1`. Unauthenticated by design on the LAN.
- 44 jobs: **10 roots we submitted, 34 follow-up children AMF created.**
- Job statuses live: `awaiting_selection` 29, `archived` 6,
  `completed_with_warnings` 6, `completed` 2, `download_stalled` 1.
  **`archived` is not in our `z.enum` and not in AMF's README.**
- Item statuses live: `delegated` 30, `not_found` 23, `delivered` 20,
  `possible` 15, `found` 3.
- All 34 children share their parent's `destination`.
- One OST item delivered **71 files**.
- These 44 jobs are the MC-Q02 acceptance fixture. **Do not archive, delete, or
  bulk-cancel them** — they are expensive to recreate.

## 4. Ticket ledger

Status values: `📋 not started` · `🔨 in progress` · `✅ done (commit)` ·
`⛔ blocked`.

| Ticket | Summary | Status | Commit |
|---|---|---|---|
| MC-S14 | Tolerate unknown + archived provider states | ✅ | `d8568dc` |
| MC-S17 | Send AnimeThemes slug, localized titles, quality prefs | ✅ | `b3e4dd4` |
| MC-S16 | Escalating poll backoff, 20-min cap; lenient body reads (F8) | ✅ | `b69e8bd` |
| MC-S18 | Split delivery import; unsupported-format closable | ✅ | `41e5aba` |
| MC-S13 | Poll the provider job graph, not a single job | ✅ | `b5e9044` |
| MC-S15 | Give requests a terminal path (close ≠ stop watching) | 📋 **← RESUME HERE** | — |
| MC-S19 | Diagnostics for the job graph and staging truth | 📋 | — |
| MC-Q02 | Re-acceptance on the live controller | 📋 | — |

**Tranche paused 2026-07-26 at `b5e9044`** — five of eight tickets done, working
tree clean, server suite green (506 passed / 30 skipped, tsc exit 0). Paused on a
session usage limit, not on a technical problem. MC-S15 had been started and was
still in its reading phase; **it wrote nothing, so there is no partial work to
unpick.** Start it from scratch.

### Execution order and why

`MC-S13` rewrites `requests/handlers.ts` and `requests/repository.ts` most
heavily, so the small tickets that touch the same files land first and S13
absorbs them, rather than the reverse.

```
S14 ─┐                    (schemas.ts, handlers.ts mapStatus)
     ├─ S16 ─┐            (handlers.ts poll cadence)
S17 ─┘       ├─ S13 ─ S15 ─ S19 ─ Q02
S18 ─────────┘
```

- **S14 ∥ S17** — disjoint. S14 owns `animeMusicFetcher/schemas.ts` +
  `music.animeMusicFetcherClient.test.ts`; S17 owns `requests/builder.ts`,
  `db/schema.ts`, `animethemes/*` + the builder `describe` in
  `music.requests.test.ts`.
- **S16 ∥ S18** — S16 owns the poll cadence in `requests/handlers.ts`; S18 owns
  `requests/deliveryService.ts`, `requests/deliveryImporter.ts`, and only
  `mapBatch` in `requests/repository.ts`.
- **S13, S15, S19, Q02 are strictly sequential** — each depends on the previous.

**Migration numbering is assigned up front** so parallel agents cannot collide on
`drizzle/meta/_journal.json`:

| Ticket | Reserved migration |
|---|---|
| MC-S17 | `0015` |
| MC-S16 | `0016` — needed after all; see §5, ladder state must live on the batch |
| MC-S13 | `0017` |
| MC-S15 | `0018` (if needed) |

### Log

_(append one entry per ticket: what changed, what was verified, what the next
person needs to know, anything deliberately left undone)_

- **2026-07-26 — tranche opened.** Baseline captured (§1). No code changed yet.

- **2026-07-26 — MC-S17 `b3e4dd4`** *feat(music): send precise AMF request identity*
  - Added `animethemes_anime.slug` (migration `0015_animethemes_anime_slug`,
    hand-authored SQL + journal entry, matching the 0013/0014 convention in this
    repo — drizzle's runtime `migrate()` reads the journal and SQL, not
    snapshots). Threaded `slug` through `animethemes/{types,parse}.ts` and
    `sync/drizzleSyncRepository.ts`. Confirmed against the live AnimeThemes API
    that every anime resource carries `slug` with no extra `include`.
  - Builder now sends `animethemes_slug` (omitted, not null, when unknown),
    localized `song_titles` + `artist_names` sourced via
    `themes → theme_full_songs → songs`, and `quality.preferred_formats`.
  - `SUPPORTED_AUDIO_FORMATS` is now exported from `deliveryImporter.ts` and
    consumed by the builder, so the ask and the accept cannot drift.
  - Added `AmfUnsupportedFormatDeliveryError` (subclass of
    `AmfDeliveryValidationError`, so existing catch behaviour is unchanged).
  - Verified in isolation: 464 tests passed (+11), 10 files skipped, tsc exit 0.
  - ⚠️ **Existing rows keep `slug = NULL` until a sync pass touches them.** The
    value is not derivable locally; no backfill script exists.

- **2026-07-26 — MC-S14 `d8568dc`** *fix(music): tolerate unknown and archived AMF statuses*
  - Inbound `status` parses as `z.string()`; the strict enum is retained for
    outbound construction only. `AmfJobStatus` is now `string`.
  - `mapStatus` gained `archived` and a logging `default` (the old `assertNever`
    threw). `archived` and unknown statuses are deliberately **absent** from
    `AMF_TERMINAL_STATUSES`, so they fall through to "keep polling, never
    FAILED" with no cadence change.
  - `shouldPersistEvidence` generalised to `!AMF_MACHINE_ACTIVE_STATUSES.has(...)`
    — a strict superset of the old condition. The raw status string lands
    verbatim in `manifest_evidence.status`, which is the durable half of the
    unknown-status diagnostics signal.
  - `handleProviderError` branches on `NOT_FOUND` → `AWAITING_OPERATOR`, no
    longer `FAILED`.
  - `operator/handlers.ts` duplicate `mapStatus` hardened: its default was
    `CANCELLED` (terminal!), now `AWAITING_OPERATOR`.
  - Verified on top of MC-S17: 470 tests passed (+6), 10 skipped, tsc exit 0.
  - Deliberately left: no new `MusicBatchState` value (would ripple into
    `service.ts`'s exhaustive switch and `db/schema.ts`'s `AnimeMusicBatchState`,
    both out of scope). See the new risk below.

- **2026-07-26 — MC-S16 `b69e8bd`** *fix(music): back off AMF polling to a 20-minute cap*
  - Ladder `AMF_POLL_BACKOFF_LADDER_MS = [5s, 30s, 2m, 5m, 10m, 20m]`, clamped at
    the last index forever. Imports MC-S14's `AMF_MACHINE_ACTIVE_STATUSES`.
  - **Ladder state persisted on the batch**: `poll_backoff_step` +
    `poll_not_before` (migration `0016_amf_poll_backoff_ladder`). The handler
    checks `pollNotBefore` *before* contacting AMF and re-throws
    `RetryableJobError` for the remainder, so a sweep-induced early wake costs
    one DB read and nothing else. It never reads the job record, so `attempts = 0`
    cannot touch it.
  - "Unchanged" = `deepEqual` on `{status, item_results, deliveries}` vs a new
    narrow `StoredMusicBatchManifest` projection. The same flag gates
    `recordProviderEvidence`, so unchanged manifests are no longer rewritten.
  - **F8**: `parseStoredMusicRequestBody(batchId, value)` `safeParse`s and falls
    back to the raw stored JSON with a warning instead of throwing. Write path
    (`builder.ts`) stays strict.
  - Verified in isolation: 478 tests passed (+8), 10 skipped, tsc exit 0.

- **2026-07-26 — MC-S18 `41e5aba`** *perf(music): split AMF delivery import into per-chunk jobs*
  - `IMPORT_AMF_MUSIC_BATCH` is now a planner; it chunks each item's outstanding
    deliveries by `AMF_IMPORT_CHUNK_SIZE` (10) and enqueues one new
    `IMPORT_AMF_MUSIC_ITEM` job per chunk. The 71-file OST becomes 8 jobs.
    `finishBatch` was already idempotent, so every chunk calling it still settles
    the batch exactly once in effect. `importBatch()` remains as an in-process
    wrapper used by tests and crash recovery.
  - Exhaustion is now scoped: `markItemOperationalExhausted(itemId, deliveryIds)`
    for a chunk vs. batch-level for planner failure — a bad chunk no longer marks
    unrelated items of the same batch.
  - `jobs/jobWorker.ts` was edited outside the granted scope, but mechanically:
    `DEFAULT_TIMEOUTS_MS` is a fully-populated `Record<JobType, number>`, so a new
    `JobType` member forces it. `index.ts` needed no change —
    `createAmfDeliveryImportHandlers` is already spread into the handler map.
  - **Double hash read deliberately retained.** Dropping the validation pass
    would mean minting catalog/song/release rows from an unverified hash before
    the copy proves the bytes, or changing `MediaStore`'s contract; its hash pass
    is a TOCTOU guard. Verification strength is unchanged.
  - **F6 resolved**: unsupported-format deliveries carry
    `{amfClassification: "UNSUPPORTED_FORMAT", amfUnsupportedExtension}` in
    delivery metadata *and* an `AMF_UNSUPPORTED_FORMAT:` `import_error` prefix.
    `finishBatch` buckets them as warnings, not attention, so the batch reaches
    `COMPLETED_WITH_WARNINGS` instead of stranding. `markUnsupportedFormat` will
    not downgrade an item that already needs genuine review.
  - Verified on top of MC-S16: 484 tests passed (+6), 23 skipped, tsc exit 0.

- **2026-07-26 — MC-S13 `b5e9044`** *feat(music): poll the AMF provider job graph* — **F1 closed**
  - New table `anime_music_request_batch_jobs` (migration
    `0017_amf_provider_job_graph`), one row per `(batch, provider job)`, root
    included. Chosen over per-item job links because the root covers *all* items
    (a per-item link has no row for it) and the live controller already shows
    **two children sharing one `parent_item_index`** (job `520003af` delegates
    items 1, 5 and 6 twice) — a per-item link cannot represent that.
  - `file_index_offset = ordinal * 10_000` gives each job a disjoint delivery
    window, because sibling follow-ups both number files from 0 and
    `anime_music_request_deliveries` is keyed `(item_id, file_index)`. **Root
    ordinal 0 → offset 0, so every pre-existing delivery row keeps its
    identity.** 64 × 10 000 < the 1 000 000 base `releaseTrackDisplayOrder` uses.
  - New `requests/providerGraph.ts`: `projectProviderJobEvidence` rewrites a
    child's evidence into batch coordinates *before* the repository sees it.
    `recordProviderEvidence` gained an optional 4th `ProviderEvidenceScope`;
    **omitting it is byte-identical to the old behaviour** and roots call the
    3-arg form.
  - `identityConflict` kept meaningful: still fires on duplicate indexes, unknown
    items, kind/number mismatch, and now an out-of-window `file_index`. Only the
    "items with no matching result" clause changed — evaluated against the
    *covered* slice. Conflict marking and delivery deactivation are scoped to the
    job, so one bad follow-up cannot disturb siblings.
  - Bounds: depth 8, `AMF_MAX_PROVIDER_JOBS_PER_BATCH = 64`. The visited set is
    the cycle guard, so a follow-up naming an ancestor/sibling/itself is inert.
    At cap, adoption stops with a warning; the batch never fails.
  - **Ladder stayed per-batch** (MC-S16 interaction). Reasoning: the scheduler
    unit is the queue job `POLL_AMF_MUSIC_BATCH:{batchId}`; one timer can only
    honour the earliest-due member, which *is* min-over-jobs. A queue job per
    provider job would multiply queue rows 4.4× live and break atomic
    graph-terminality evaluation. Fast 5s if **any** member is machine-active;
    **any** member changing resets to step 0. Per-job `provider_status` +
    `manifest_evidence` are persisted anyway, so MC-S19 can render per-job
    cadence with no migration.
  - **Verified against the live controller read-only**: all 10 roots walked,
    **35 follow-up adoptions, 0 destination mismatches, 0 identity mismatches**.
    The 35th is real and interesting — root `35d535d6` is listed as a follow-up
    of root `b4d97229` (same anime, same destination), i.e. a job that is both a
    root we submitted and a child AMF claims. `(batch_id, amf_job_id)` uniqueness
    plus the cycle guard make it inert.
  - Destination containment **confirmed live, not assumed**, and
    `sharesBatchDestination` now asserts it — a job claiming a destination
    outside the batch has its evidence refused entirely.
  - `delegated` items are now `PENDING`, not `ATTENTION`. `ATTENTION` is sticky,
    so the old value would have outlived the child actually delivering.
  - Verified: 506 passed (+22) / 30 skipped, tsc exit 0. The agent additionally
    ran the whole suite against a throwaway PostgreSQL 16 container —
    **61 files passed / 1 skipped, 534 passed / 2 skipped**, every env-gated
    integration file green including migration `0017`. Container stopped
    afterwards; nothing on the AMF controller was mutated.

- **2026-07-26 — tranche paused.** MC-S15 was started and hit a session usage
  limit during its reading phase, before writing anything. Working tree left
  clean at `b5e9044`; no partial work exists and none needs unpicking. See §4b
  to resume.

- **2026-07-27 — MC-S13/MC-S18 deployed and Erin partial import recovered.**
  Request `452ae72b-9756-44cd-91f1-00d2b02d8293` exposed a deployment-drift
  regression: the database had migration `0017`, but the remote source and
  container still used root-only polling (`include=item_results,media`). The
  retained root therefore showed seven delegated items while Anime Ongaku had
  persisted only the root provider job and one ready opening.
  - Live sparse-v2 probes confirmed the delegated OST child
    `98bba32e-1c23-4633-9cf7-9eed451cf56f` was `completed`/`delivered` with 46
    media songs; no AMF mutation or re-request was needed.
  - The complete tracked server tree at `4d1fcdd` was deployed, including
    MC-S13 `b5e9044` and MC-S18 `41e5aba`, replacing the earlier selective-file
    deployment. Startup recovery adopted all eight provider jobs and imported
    46/46 OST deliveries while leaving the six still-incomplete children under
    normal polling.
  - Release `277`, **Erin, the Beast Tamer Original Soundtrack**, was published
    with 46 ordered, English-first tracks. Focused server verification passed
    128 tests; the full serial suite passed 515 tests with 32 environment-gated
    skips, and TypeScript typecheck passed.
  - The current debug Android app was rebuilt, its unit tests passed, and it was
    installed on the Pixel 7 Pro. Device smoke verified Erin's **Related Music**
    section, the 46-track album page, ordered English titles beginning with
    **Ancient Gods**, and successful streaming playback. No app crash was
    present in logcat.

## 4b. Resuming — read this first

State at pause: **HEAD `b5e9044`**, working tree clean, nothing uncommitted.
Verify you are still there before starting:

```powershell
cd F:\Users\Nolan\repos\animeonkaku\server
git log --oneline -5          # expect b5e9044 at the top
git status --porcelain        # expect only artifacts/ and .planning/ untracked
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
# expect 52 files passed | 10 skipped, 506 passed | 30 skipped
```

**Next action: MC-S15.** Its full brief is ticket MC-S15 in
`18-amf-fetch-robustness-review.md` plus finding F3. Everything it must do is
already written down; the six work items are:

1. `CLOSE_REQUEST` / `ABANDON_BATCH` operator actions + routes. Must free the
   anime (`completed_at`) **without** deleting or detaching
   `anime_music_request_batch_jobs` rows — those keep being polled forever.
2. The three-way state split (operator-must-act / dormant-keep-watching /
   provider-gone). MC-S14 deliberately deferred this; it is now load-bearing for
   UI correctness — see §5, an archived job currently makes Android read "Needs
   operator review" when nothing is required. This *does* mean adding a
   `MusicBatchState` value and following the ripple into `service.ts`'s
   exhaustive switch and `db/schema.ts`'s `AnimeMusicBatchState`.
3. Prove a late import into a *closed* request still publishes, does not reopen
   it, and does not duplicate the song when a newer request exists (the
   `reserveCatalog` content-hash dedupe path — test it, don't assume it).
4. Migrate MC-S18's `import_error LIKE 'AMF_UNSUPPORTED_FORMAT:%'` discriminator
   into a real classification column and delete the `LIKE` (§5).
5. Android: `MusicRequestCoordinator.request()` returns early unless `Idle` or
   `SubmissionError` — allow re-request from terminal-attention. Keep debug
   gating exactly as-is.
6. Derive `pollAfterSeconds` in `toSummary` from the batch's `poll_not_before`
   instead of the hardcoded 5 (§5).

Plus the open question in §5 about whether the ~30 pre-existing `ATTENTION` rows
heal — decide it with reasoning, and carry a corrective statement in migration
**`0018`** if they do not.

MC-S15 touches `src/`, so it needs the **Android Gradle gate** in §1 as well as
the server gate. That suite was 503/503 across 78 suites at last acceptance and
is slow — budget for it.

After MC-S15: **MC-S19** (diagnostics; depends on S13's graph table, which is
done and already persists per-job `provider_status` + `manifest_evidence`, so no
migration is needed to render per-job cadence), then **MC-Q02** (live
re-acceptance — its five-step script is in the review doc, and step 1 is now
mostly pre-validated: MC-S13's agent already walked all 10 roots read-only and
confirmed 35 adoptions with 0 destination and 0 identity mismatches).

## 5. Standing risks / things not yet resolved

- ~~**Sweep vs. ladder (MC-S16)** — needs verification.~~ **RESOLVED
  2026-07-26 — and the answer is worse than feared. MC-S16 must design around
  this.**

  `PgJobRepository.enqueue` (`server/src/jobs/pgJobRepository.ts:23`) is an
  upsert whose conflict clause does:

  ```sql
  ON CONFLICT (dedupe_key) DO UPDATE
    SET state = 'QUEUED',
        attempts = 0,
        next_run_at = LEAST(jobs.next_run_at, EXCLUDED.next_run_at),
        ...
    WHERE jobs.state IN ('QUEUED','FAILED','DONE','CANCELLED')
  ```

  and `JobQueue.enqueue` defaults `nextRunAt` to `now()`
  (`server/src/jobs/jobQueue.ts:39`). Two independent consequences:

  1. **`next_run_at = LEAST(future, now)` pulls any scheduled future poll
     forward to now.** So the 15-minute `recheckIncomplete()` sweep does *not*
     no-op against a pending poll — it reschedules it immediately. The ladder is
     hard-floored at 15 minutes and the 20-minute cap is unreachable.
  2. **`attempts = 0` on every re-enqueue.** So the ladder position **cannot**
     live in the job row's `attempts` column — the obvious
     `backoffMs(attempts)` implementation would silently reset on every sweep,
     every operator action, and every other enqueue against the same dedupe key.

  **Therefore MC-S16 must persist ladder state on the batch, not on the job.**
  Add something like `poll_backoff_step` + `poll_not_before` to
  `anime_music_request_batches` (`recordProviderState` already writes on every
  poll and is the natural home), have the handler compute its delay from that,
  and make the poll a no-op that reschedules itself when it fires before
  `poll_not_before`. Do not change the shared `ON CONFLICT` clause — other job
  types depend on pull-forward semantics.
- **`AWAITING_OPERATOR` is now overloaded — MC-S15 must split it.** After
  MC-S14, three very different situations all map to `AWAITING_OPERATOR`:
  a genuine operator wait (`awaiting_selection`, `awaiting_file_selection`),
  dormant provider bookkeeping (`archived`, unknown status), and provider-gone
  (poll 404). Because `toSummary` derives `requiresOperatorAction` from
  `counts.awaitingOperator > 0`, an archived job makes the Android debug action
  read **"Needs operator review"** when nothing is in fact required. This was a
  deliberate scope call in MC-S14 (a new domain state would have rippled into
  `service.ts`'s exhaustive switch and `db/schema.ts`'s `AnimeMusicBatchState`).
  MC-S15 owns fixing it — its three-way split is now load-bearing for UI
  correctness, not just tidiness.

- **Reuse, don't redefine, the machine-active status set.** MC-S14 added
  `AMF_MACHINE_ACTIVE_STATUSES` to `requests/handlers.ts`. MC-S16's backoff
  ladder needs exactly that set to decide fast-vs-slow cadence — import it
  rather than writing a second copy that can drift.

- ~~**Unsupported-format deliveries are classified but not yet closable.**~~
  **Resolved by MC-S18 `41e5aba`.** But note the mechanism: the closable-vs-
  blocking distinction is carried by an `import_error LIKE
  'AMF_UNSUPPORTED_FORMAT:%'` string-prefix match inside `finishBatch`'s SQL.
  That works and is tested, but a free-text column is doing the job of a state
  discriminator. **MC-S15 should formalise it** into a real classification
  column/enum while it is already reworking terminal states, and delete the
  `LIKE`. Match on the exported `AMF_UNSUPPORTED_FORMAT_ERROR_PREFIX` or the
  `amfClassification` metadata key — do not re-invent the string.

- **The Android-facing poll cadence is a separate, still-flat 5s.** MC-S16's
  ladder governs the *server → AMF* job cadence. `toSummary` in
  `requests/service.ts` still returns a hardcoded `pollAfterSeconds: 5` for any
  active request, and `MusicRequestCoordinator.observe` on Android polls at that
  rate for as long as the anime screen is open — including for a batch that is
  now known to be dormant for the next 20 minutes. Not wrong, but wasteful and
  inconsistent once the ladder exists. MC-S19 (or MC-S15, whichever touches
  `toSummary` first) should derive `pollAfterSeconds` from the batch's
  `poll_not_before` instead of a constant.

- **⚠️ Pre-existing `ATTENTION` rows on the live database may not self-heal —
  MC-Q02 must check this explicitly.** MC-S13 changed `delegated` items to
  `PENDING` going forward, but `import_state` is deliberately sticky
  (`CASE WHEN import_state IN ('READY','ATTENTION') THEN import_state ELSE …`),
  and the ~30 delegated items on the live database were already written as
  `ATTENTION` by the old code. Migration `0017` inserts graph rows only; it does
  **not** reset those items.

  There *is* a recovery path — `recordProviderEvidence` resets an `ATTENTION`
  item back to `PENDING` once its `result_status` is `delivered` and it has a
  clean `PENDING` delivery — so once a child actually delivers, the item should
  heal. But this depends on the projected child result reaching the item, and on
  ordering against the parent job (still reporting `delegated` for that index)
  not flipping `result_status` back. **Verify on real data before assuming**; if
  it does not heal, MC-S15 should carry a one-off corrective statement in its
  migration rather than leaving 30 items stranded.

- **Existing stuck requests.** Every live request is currently non-terminal
  (delegated items, `AWAITING_OPERATOR`), so those anime cannot be re-requested
  until MC-S15 ships a close action. Expect to need a one-off adoption/backfill
  pass after MC-S13 to attach the 34 existing children to their batches.
- **Env-gated tests.** The 10 skipped files need `TEST_DATABASE_URL` against a
  real PostgreSQL. Tickets touching `repository.ts` / `deliveryService.ts` have
  their real coverage in those files — running them locally is strongly
  preferred before committing S13/S15/S18.
