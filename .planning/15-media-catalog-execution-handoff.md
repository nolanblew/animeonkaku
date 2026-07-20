# Media Catalog execution handoff

Last updated: 2026-07-20

## Branch and completed ticket commits

- Branch: `feature/media-catalog-initiative`
- MC-S01: `121a8c7 feat(server): add media catalog schema`
- MC-S02: `aa8eb66 feat(server): preserve AnimeThemes video catalog`
- MC-S03: `d0ae8e4 feat(server): import and stream original song audio`
- MC-S04: `1ae8bac feat(server): define music provider contracts`
- MC-S05: `5dbe22c feat(server): add Lidarr acquisition adapter`
- MC-S06: `dc673c0 feat(server): add conservative music catalog matching`
- MC-S07: completed and verified in the next ticket commit after `dc673c0`
  (use `git log -1 --oneline` for its final hash).

The pre-existing untracked `.codex-remote-attachments/` directory is unrelated
and must not be staged, modified, or deleted.

## MC-S07 completed scope

- Added bounded discovery scan, per-anime discovery, and acquisition reconcile
  jobs using the existing PostgreSQL queue.
- Added daily oldest-due scheduling (maximum 25), weekly recent-anime cadence,
  monthly missing-Full cadence, exact calendar-year/leap behavior, and orphan
  mapping exclusion.
- Added stable theme-to-AnimeThemes-song persistence and conservative concrete
  discovery across Full Size and season-scoped Related Music targets.
- Query lookups are sequential; only one conservatively selected provider
  release is ensured/enriched, then re-resolved before acquisition begins.
- Accepted intents, ambiguity/rejection evidence after provider mutation,
  provider ownership, command IDs, and acquisition state are durable and
  idempotent across normal retry/restart boundaries.
- Lidarr command recovery reuses matching queued/running/completed commands;
  older Lidarr command-list 404s allow fresh starts but fail safe during
  recovery rather than risking a duplicate POST.
- Multiple catalog intents may share one provider command ID. Related discovery
  filters already-linked provider releases so later scans can advance.
- Enabled startup recovers stale discovery/jobs, bootstraps metadata-ready
  existing mappings, and requeues acquisitions before workers start. Disabled
  discovery performs no discovery startup writes/provider work; queued jobs
  pause without consuming attempts.
- `MUSIC_CATALOG_ENABLED` remains independent and does not block hidden catalog
  prepopulation. MC-S07 added no listener routes or READY publication.

## MC-S07 verification evidence

- Independent Terra/High QA ran the populated migration plus discovery due SQL
  against an isolated PostgreSQL 16 container: 2 files, 4 tests passed. The
  exact temporary container was removed.
- Focused discovery/mapping/provider tests passed.
- Full server Vitest passed: 44 files passed, 3 environment-gated files
  skipped; 351 tests passed and 6 environment-gated tests skipped.
- TypeScript `--noEmit` passed.
- `git diff --check` passed apart from expected Windows CRLF warnings.
- Independent Sol/Medium review found no remaining functional blocker.

## Next ticket: MC-S08

Read MC-S08 in `.planning/14-media-catalog-tickets.md` plus the PRD/TDR sections
it references before editing. MC-S08 owns completed-acquisition validation,
original-format import, READY publication, theme timestamp changes, and safe
provider cleanup. Preserve these MC-S07 boundaries:

1. A healthy QUEUED/RUNNING provider state consumes zero job attempts and never
   holds a worker while downloading.
2. Provider/transport/DB failures use finite normal retry/backoff.
3. Only validated imported audio may become READY or listener-visible.
4. Full Size retains only the selected song; accepted Related releases retain
   only their classified tracks.
5. Cleanup may delete only adapter-created resources and may restore an
   operator album's prior monitoring state only from durable ownership data.
6. Shared provider command IDs are valid across distinct acquisition intents;
   MC-S08 reconciliation/import must not assume command ID uniqueness.
7. Keep `.codex-remote-attachments/` untouched and commit MC-S08 separately.

## Agent model policy

- Use `gpt-5.6-luna` for Luna-mapped work when available.
- If Luna is unavailable, use `gpt-5.6-terra` as its fallback.
- Never use Sol merely as a Luna fallback.
- Sol is allowed only where the original mapping explicitly permits it: UX and
  review at Medium, and medium/high-complexity development at the specified
  Medium/High effort.
