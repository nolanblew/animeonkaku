# S5 IMPLEMENTATION PLAN -- Read/Write API Surface

## Scope

Implement every client-facing endpoint in `.planning/04-api-spec.md` on top of the S1-S4 server foundation.

## Shape

1. Add route modules that reuse the existing Fastify/zod/auth/error conventions:
   - library/catalog reads
   - media streaming/image redirects
   - theme prefs, plays, playlists
   - sync control/status
   - search/artist proxies with short TTL cache
2. Add a Drizzle-backed API repository/service that reads the existing S1/S4 schema without changing applied migrations.
3. Keep media serving in a small service that can be tested against real temp files:
   - `GET`/`HEAD /v1/media/audio/:themeId`
   - byte-range `206` support for READY files
   - `302` to origin and `FETCH_AUDIO` enqueue for misses
   - explicit `/request` endpoint with HIGH priority enqueue
4. Wire production dependencies in `src/index.ts`.
5. Keep tests at the route/service boundary with injected fakes, plus real-file media range tests.

## Test-first checklist

- [ ] Auth is required for new `/v1/*` endpoints.
- [ ] `/v1/library?since=` returns serverTime, changed anime, changed themes, tombstones, and mapped audio state.
- [ ] Missing media `GET` returns `302` and enqueues exactly one URGENT job through queue dedupe.
- [ ] READY media supports ExoPlayer-style `Range: bytes=...` requests with `206`/`Content-Range`.
- [ ] Plays are additive, prefs are last-write-wins.
- [ ] Playlist CRUD rejects auto-playlist mutation and preserves ordered entries.
- [ ] Sync enqueue/status returns job id/progress passthrough.
- [ ] Search/artist proxy cache avoids duplicate upstream calls inside the TTL.

## Notes

- The existing untracked `.planning/CURRENT_TASK.md` is stale S2 state and is intentionally left untouched.
- This S5 branch is based on `feature/server-initiative` after PR #27 was merged.
