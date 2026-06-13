# CURRENT TASK — S2: Upstream clients (PAUSED mid-implementation)

> Snapshot for resuming work. Read `FINAL_PLAN.md` for overall context; this file describes exactly where execution stopped on 2026-06-12.

## Where we are

**Branch:** `server/s2-upstream-clients` (branched from `feature/server-initiative`).
**All S2 work is uncommitted** in the working tree — nothing on this branch is committed or pushed yet.

Completed before this branch:
- S1 (server skeleton) merged via [PR #24](https://github.com/nolanblew/animeonkaku/pull/24); checked off in `FINAL_PLAN.md` (commit `43c6109` on `feature/server-initiative`).

### S2 progress so far (TDD, vitest)

**Done and green (22 tests):** shared HTTP politeness stack in `server/src/http/`
- `types.ts` — `FetchLike` / `Sleep` injection types
- `tokenBucket.ts` — `TokenBucket` (per-host budgets) + `Semaphore` (binary hosts, for S3)
- `circuitBreaker.ts` — 5-failures→10-min-open, single half-open probe
- `retry.ts` — `fetchWithRetry`: GET/HEAD only, 408/429/5xx, backoff+jitter, honors `Retry-After` (capped)
- `upstream.ts` — `UpstreamHttp` composing breaker → bucket-per-attempt → retry; 5xx/network feed the breaker, 429 does not
- Tests: `test/http.*.test.ts` (4 files) + helpers `test/helpers/fakeTime.ts`, `test/helpers/fakeFetch.ts`

**Implemented but NOT yet run against their tests:** Kitsu auth in `server/src/kitsu/`
- `types.ts` — `KitsuTokens`, `KitsuSelfUser`, `KitsuAnimeEntry`, `KitsuGenre`
- `authParsing.ts` — tolerant /oauth/token body parsing (JSON / form-encoded / JSON:API errors / HTML / empty)
- `kitsuAuthClient.ts` — `RealKitsuAuthClient` (password + refresh grant, self-user lookup)

**Tests written, implementation MISSING (will fail):**
- `test/kitsu.authParsing.test.ts`, `test/kitsu.authClient.test.ts` — should pass once run; not yet executed
- `test/kitsu.client.test.ts` — **`src/kitsu/kitsuClient.ts` does not exist yet**; this is the exact next file to write

## Next steps (in order)

1. Run `npx vitest run test/kitsu.authParsing.test.ts test/kitsu.authClient.test.ts` — expect green; fix if not.
2. Implement `server/src/kitsu/kitsuClient.ts` to satisfy `test/kitsu.client.test.ts`:
   - `KitsuClient` class, deps `{ http: UpstreamHttp; pageLimit?: number }` (pageLimit default 500, injectable for pagination tests)
   - `getLibraryEntries(userId, {status?, accessToken?, onPage?})` — JSON:API paging via `page[offset]`, parses `data[]` + `included[]` anime, conversions (ratingTwenty÷2, averageRating string÷10, title prefs en→canonical→en_jp), then backfills entries missing title/poster via `getAnimeDetails`
   - `getLibraryEntriesUpdatedSince(userId, sinceIso, accessToken?)` — `-updatedAt` walk, stop at first entry older than cutoff (ISO string compare)
   - `getAnimeDetails(ids)` (batch 20, `filter[id]` first param — tests match on `anime?filter%5Bid%5D=`), `getAnimeMappings(ids)` (include=mappings), `getAnimeCategories(ids)` (include=categories)
   - `KitsuApiError` with status in message on non-2xx
3. AnimeThemes client (task #13, tests first — none written yet): `src/animethemes/{types,parse,client}.ts` + tests — four query shapes (Kitsu-id batch ≤50, MAL-id batch, `q=` title search, single anime `{anime:{…}}` response), `links.next` pagination, `toThemeEntries` port (audio URL resolution link→`a.animethemes.moe/`+path→video-link fallback w/ `videoFallback` flag, artist `as`/`alias` credits, kitsu external id number|string, cover facet preference, English synonym, **reject non-numeric theme ids**). Reference: doc 02 + `src/app/.../AnimeRepositoryImpl.kt`.
4. Wire real auth: `config.ts` — default `KITSU_CLIENT_ID/SECRET` to the public values from doc 02; `index.ts` — `KITSU_AUTH_MODE=real` → `RealKitsuAuthClient` (with `UpstreamHttp` w/ kitsu bucket 2/s + breaker) instead of throwing; update `.env.example` wording. Compose default stays `stub`.
5. Verify: `npm test`, `npm run typecheck`, `docker compose build` sanity.
6. Commit, push, `gh pr create --base feature/server-initiative`, open it; then add a commit checking off S2 in `FINAL_PLAN.md` with the PR number (same pattern as S1).

## Conventions in force
- TDD red→green per module; tests use injected fakes (`FakeTime`, `fakeFetch`/`routedFetch`) — no real network/DB.
- Politeness budgets (doc 06): kitsu 2 req/s, animethemes API 60/min, binary hosts 1-concurrent.
- Plan check-offs happen in `FINAL_PLAN.md` with PR links once merged/created.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
