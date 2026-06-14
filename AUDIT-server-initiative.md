# Audit — Anime Ongaku Server Initiative

**Date:** 2026-06-13
**Branch audited:** `feature/server-initiative` (HEAD `6c497ad`)
**Scope:** Server + Android client work delivered against `.planning/FINAL_PLAN.md` (milestones S1–S5, A1, I1, I2) and the QA cycle in `.planning/`.
**Method:** Read the plan + spike docs (`.planning/01–08`, `FINAL_PLAN.md`) and both QA reports (`.planning/QA-report.md`, `QA-retest-report.md`); cross-checked the actual server and Android source; independently re-ran the server test suite and typecheck.

---

## TL;DR

The initiative is **substantially complete and faithfully executed.** Every milestone the plan claims done (PRs #24–#31) is reflected in real code: the server exists with the full queue/media/sync/API surface, the Android client is a thin server client, and the doc 07 deletion list and doc 08 opportunistic bug fixes were actually carried out. The retest report's "Pass" claims line up with what's in the tree.

The findings below are **not** "the work wasn't done" — they're a handful of real fragilities and hygiene gaps that should be tracked. The one that genuinely matters operationally is the **AnimeThemes Cloudflare 403** (Finding 1): the entire theme/media pipeline depends on a header-spoof workaround that can silently re-break the whole product.

---

## Resolution status (addressed on `feature/fixes`)

| Finding | Status | What changed |
|---|---|---|
| 1 — AnimeThemes 403 single point of failure | **Addressed** | `UpstreamHttp.breakerStatuses` now opens the circuit on repeated AnimeThemes `403`/`451` (stops hammering); `/v1/sync/status` exposes `mapping` + `upstreamBlocked` so a 0-themes library is diagnosable; new `ANIMETHEMES_BASE_URL` egress lever; documented as the #1 risk in `server/README.md` + `.env.example`. Health-endpoint surfacing intentionally left out (would need breaker plumbing into `/healthz`) — sync-status is the client-visible path. |
| 2 — image routes enqueue jobs on unauth miss | **Verified already mitigated; no code change** | `sendImage` calls `findImage` first, which returns `null` (→404) for any `refId` without a real catalog row, so unauthenticated callers cannot seed arbitrary `FETCH_IMAGE` jobs. The recommended "validate refId before enqueue" guard already exists. Unauthenticated image *reads* remain deliberate (Coil can't send a bearer) and within the LAN threat model. |
| 3 — hard-coded media Content-Type | **Addressed (audio)** | Video-fallback audio (doc 08 #11) is now served as `video/webm` via the existing `media_files.video_fallback` flag instead of `audio/ogg`. Image content-type stays `image/jpeg` (fixing it properly needs a stored-content-type column / migration; deferred as genuinely Low). |
| 4 — video URLs dropped | **No action (intentional per plan)** | Confirmed correct; webm-only themes remain playable through the audio route. |
| 5 — stale `CURRENT_TASK.md` + misspelled folder | **Addressed** | Deleted the stale `CURRENT_TASK.md`; consolidated the typo'd `.planing/` into `.planning/` and updated all path references repo-wide. |

> The original finding text below is preserved as written at audit time; the table above is the as-resolved view.

---

## What I independently verified (green)

| Check | Result |
|---|---|
| Server `vitest run` | **111 passed, 2 skipped** (24 files passed, 1 skipped — the live-network test) |
| Server `tsc --noEmit` | **Clean** (exit 0) |
| doc 07 deletion list removed from Android main src | ✅ `KitsuApi`, `KitsuAuthApi`, `KitsuAuthInterceptor`, `KitsuAuthRepository`, `LibraryStatusSyncManager`, `StatusSyncService`, `RateLimitInterceptor`, `AnimeRepositoryImpl`, `SyncManager` all gone |
| No direct upstream hosts in Android main src | ✅ no `kitsu.io` / `animethemes.moe` / `oauth/token` references |
| Bug #2 (PreCache partial-span) | ✅ fixed — `isCached` now uses `cache.isCached(key, 0, contentLength)` + `isCacheComplete()` (`media/PreCacheManager.kt`) |
| Bug #3 (DownloadWorker FAILED-vs-retry) | ✅ fixed — `downloadFailureStatus()` returns `STATUS_RETRYING` → `Result.retry()` until final attempt, then `markFailed` → `Result.failure()` (`download/DownloadWorker.kt`) |
| Bug #4 (non-numeric theme id) | ✅ server rejects — `parse.ts` throws `AnimeThemesParseError` on non-numeric id; client no longer mints hash ids |
| `KitsuTokenStore` trimmed | ✅ replaced by `data/auth/ServerTokenStore.kt` |
| I1/I2 Android plumbing | ✅ `LibraryPullManager`, `OngakuApi`, `OngakuBaseUrlInterceptor`, `OngakuAuthInterceptor`, `PendingPlay*` + `pending_plays` table, `ServerMigrationManager`, 6 h `LibraryPullWorker` (`work/LibraryPullScheduler.kt`), pull cadence triggers (cold 5 min / warm 60 min / foreground 2 h in `MainActivity.kt`) |
| Room schema | ✅ `@Database(version = 20)`, migration chain present, `schemas/20.json` snapshot checked in |
| Server scheduler tickers (S4 #6) | ✅ delta-sync interval + daily maintenance + weekly maintenance timers in `sync/scheduler.ts` |
| Title/synonym fallback guard (doc 08 #9) | ✅ ported — `titleCandidateMatches()` does normalized exact title-set matching in `sync/librarySyncPipeline.ts` |
| QA retest evidence dirs | ✅ `artifacts/qa-retest-fixes/` and `artifacts/qa-retest-final/` exist as cited |

> Not independently re-run: the Android Gradle unit suite (`./gradlew test`). The QA reports claim it passes; I did not re-execute it (build cost). Server side I confirmed first-hand.

---

## Findings & needed fixes

### 1. AnimeThemes Cloudflare 403 — single point of failure, silent when it breaks  🔴 High

The first full QA run (`QA-report.md`) had **QA-01 through QA-09 fail or blocked** for one reason: AnimeThemes returned **HTTP 403 / Cloudflare block**, so `MAP_THEMES` never completed → library had "30 anime, 0 themes" → no playback, no downloads, no likes, no search. The retest passed only because the "fix" in commit `1caef48` made it through.

**What the fix actually is:** browser-like request headers on every AnimeThemes call (`server/src/animethemes/client.ts:25–29`):

```ts
const REQUEST_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "AnimeOngaku/0.1 (+https://github.com/...; personal self-hosted server)",
};
```

**Why this is fragile:**
- A 403 is **not retried and not fed to the circuit breaker** — the HTTP stack only handles 408/429/5xx (`http/retry.ts`, `http/upstream.ts`). A hard 403 fails immediately and permanently for that job.
- Cloudflare can re-block on IP reputation / TLS-JA3 fingerprint / heuristics at any time, regardless of headers. The workaround addresses *one* heuristic.
- **The failure is silent to the user**: the UI just shows "0 themes." There is no banner, no `/healthz` signal, and no surfacing in `/v1/sync/status` distinguishing "blocked by upstream" from "nothing to map."

**Recommendations (in priority order):**
1. Make the failure *visible*: surface a distinct upstream-blocked state on the job row and bubble it into `GET /v1/sync/status` (and ideally `/healthz`) so a 0-themes library is diagnosable without reading server logs.
2. Treat repeated 403s from AnimeThemes as a breaker-eligible condition (open the circuit, stop hammering, report state) rather than spinning on per-job failures.
3. Make the upstream reachable through a configurable outbound proxy / alternate egress (env-driven) so the operator has a recovery lever when an IP gets blocked.
4. Document this as the #1 operational risk in `server/README.md`.

---

### 2. Image media routes are unauthenticated and enqueue jobs on unauth misses  🟡 Medium (within stated LAN threat model)

`registerMediaRoutes` (`server/src/api/mediaRoutes.ts:215–266`) attaches `requireAuth` to the **audio** routes but deliberately omits it from the **image** routes:

- `GET /v1/media/images/anime/:kitsuId/:variant` — no auth
- `GET /v1/media/images/artists/:slug` — no auth

This was an intentional fix for Coil not being able to attach a bearer token (the original QA-01/QA-03 401 artwork failures). The trade-offs:

- **(a)** Any caller who can reach the server can fetch any cached image. For a LAN-only personal service this is explicitly accepted in doc 08 §Auth ("LAN-only personal service… good enough").
- **(b)** More notably, `sendImage()` calls `enqueueImageFetch(kind, refId, …)` on **every cache miss**, with `refId` taken straight from the URL path. An unauthenticated caller can therefore seed arbitrary `FETCH_IMAGE` jobs with attacker-chosen `refId` values — a minor job-queue amplification / pollution vector.

**Recommendation:** before enqueuing on a miss, validate `refId` against an existing catalog row and return `404` for unknown ids instead of enqueuing. That removes the unauth job-seeding without re-introducing the Coil 401. (Leaving the GET itself unauthenticated is fine for the LAN threat model.)

---

### 3. Hard-coded `Content-Type` on served media  🟢 Low

In `sendReadyFile` the audio content type is hard-coded `audio/ogg` (`mediaRoutes.ts:79`) and images `image/jpeg` (`mediaRoutes.ts:112`), regardless of what was actually stored.

- The `video_fallback=true` case (doc 08 #11 — a webm video track stored and served as audio) is still labelled `audio/ogg`. ExoPlayer container-sniffs so playback works, but the header is inaccurate.
- Stored PNG/WebP artwork is labelled `image/jpeg`.

Low severity (clients sniff / don't care today), but worth persisting the real content type on the `media_files` row at fetch time and echoing it here, so the headers stop lying.

---

### 4. Video is intentionally dropped — confirm this is acceptable for v1  🟢 Low / informational

Per the retest's upstream-boundary audit and confirmed in code: server theme DTOs return `videoUrl: null` and the Android mapping discards upstream video URLs. This is **per plan** (video storage is explicit v1 backlog). Recording it here only so it isn't later mistaken for a regression: themes whose only playable source was a webm (`video_fallback`) are still playable via the audio route, which serves the webm-as-audio — so "no video URL" does not mean "unplayable."

---

### 5. Planning-doc hygiene: stale `CURRENT_TASK.md` and a misspelled folder  🟡 Medium (will mislead the next dev)

- `.planning/CURRENT_TASK.md` still says **"S2: Upstream clients (PAUSED mid-implementation)"** as of 2026-06-12, with "all S2 work is uncommitted." This is now badly out of date — S2 through I2 are all merged (PRs #25–#31) and S2's "next steps" (write `kitsuClient.ts`, AnimeThemes client, wire real auth) are all done. A future dev/agent who reads `CURRENT_TASK.md` first (as it instructs) will be actively misled. **Fix:** delete it, or rewrite it to "all milestones merged; see QA reports."
- The plan/spike folder was named **`.planing`** (one `n`, a typo) while the QA folder was **`.planning`**. Two near-identical sibling directories is a footgun. Consolidate to one correctly-spelled `.planning/`. *(Resolved on `feature/fixes`.)*

---

## Gaps vs intended behavior — none material found in code

I specifically looked for the high-risk porting gaps the plan called out, and they are present and correct:

- **N:1 season-collapse mapping** (doc 05 decision 2) — sync pipeline maps multiple Kitsu entries to one AnimeThemes anime; tests cover the N:1 season case (`sync.mapping.test.ts`).
- **Non-numeric theme id rejection** (doc 08 #4) — enforced at parse, no hash-fallback ids.
- **`Retry-After` honored** (doc 08 #5) — in `http/retry.ts`, covered by tests.
- **Atomic media writes / no partial READY** (doc 08 §B) — `media/mediaStore.ts` tmp→validate→sha256→atomic move; tested.
- **Range/206 streaming + 302-on-miss + URGENT enqueue** (S5) — `mediaRoutes.ts`, tested in `api.mediaRoutes.test.ts`.
- **Pending-writes flush (plays + prefs), LWW prefs, additive plays** (doc 07 §6) — `PendingWritesFlusher` + `pending_plays`; QA-08/QA-12 exercised offline→reconnect recovery.
- **Title/synonym exact-match fallback guard** (doc 08 #9) — ported as `titleCandidateMatches`.

The only behavioral risk is **runtime/operational** (Finding 1), not a missing port.

---

## Suggested next actions

1. ✅ **(High)** Finding 1 — done: blocked-state is now visible (`upstreamBlocked` on `/v1/sync/status`), repeated 403s open the breaker, and `ANIMETHEMES_BASE_URL` gives an egress lever. Remaining option for later: surface breaker state in `/healthz` too, and consider a full forward-proxy (needs an `undici` dependency).
2. ✅ **(Medium)** Finding 2 — verified already mitigated by the `findImage`→404 gate; no change needed.
3. ✅ **(Medium)** Finding 5 — done: stale `CURRENT_TASK.md` deleted, `.planing/` consolidated into `.planning/`.
4. ◑ **(Low)** Finding 3 — audio webm fallback fixed; image content-type left as `image/jpeg` (proper fix needs a stored-content-type column).
5. ⏳ Re-run the Android Gradle suite locally to independently confirm the client-side test claim (server suite verified first-hand; Android build cost was out of scope for this pass).
