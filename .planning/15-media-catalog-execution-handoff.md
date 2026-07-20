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
- MC-S07: `f6f849e feat(server): add automatic music discovery workflows`
- MC-S08: completed and verified in the next ticket commit after `f6f849e`
  (use `git log -1 --oneline` for its final hash).

The pre-existing untracked `.codex-remote-attachments/` directory is unrelated
and must not be staged, modified, or deleted.

## MC-S08 completed scope

- Added durable `IMPORT_MUSIC_AUDIO` jobs, dedupe keys, bounded timeouts,
  disabled-discovery pause behavior, finite failure handling, and direct
  startup recovery for IMPORTING and READY-cleanup-pending acquisitions.
- Provider completion transitions to IMPORTING and enqueues import work;
  `completed_at` is reserved for final READY publication.
- Full Size imports exactly one accepted provider file. Related imports require
  the complete accepted release-track set. Provider/release/track identity,
  recording conflicts, normalized title/artist/duration evidence, and mapped
  readable paths are validated before copying.
- Imports use `MediaStore.importLocalSongFile`. Per-song advisory locks,
  verified READY reuse, and source-hash orphan recovery cover concurrent,
  rename-before-DB, and cross-extension retry boundaries on Windows.
- Catalog links, acquisition READY/completion, and song/release/theme timestamp
  bumps publish in one PostgreSQL transaction only after all required
  `media_files` rows are READY. Related albums therefore cannot become partly
  listener-visible through the acquisition boundary.
- Cleanup is serialized per provider release and elects authoritative durable
  ownership/monitoring metadata across sibling acquisitions. Terminal siblings
  release a READY peer; cleanup markers prevent replay; Lidarr cleanup is
  idempotent when an owned album and/or artist was deleted before a crash.
  Cleanup failure is best effort and never unpublishes READY media.
- Legacy MC-S07 rows without `providerMetadata.catalogIntent` derive and
  backfill expected tracks/evidence transactionally. Only their exact premature
  theme/release junction is retracted before validated republishing, preserving
  any newer different READY link.
- Runtime passes `LIDARR_PATH_PREFIX_TO ?? LIDARR_SHARED_ROOT` as the provider
  import containment root. Hidden population remains independent of
  `MUSIC_CATALOG_ENABLED`.

## MC-S08 verification evidence

- Independent Terra/High QA focused matrix: 142/142 passed.
- Isolated PostgreSQL 16 opt-in matrix: 9/9 passed, including populated legacy
  recovery, publication readiness/rollback/link/timestamp behavior, shared
  cleanup ownership/serialization, and song-lock serialization. The exact
  temporary container was removed; `server-db-1` was verified untouched.
- Full default server Vitest: 45 files passed, 4 environment-gated files
  skipped; 373 tests passed and 11 skipped. The 9 PostgreSQL skips were run
  separately and passed; the other 2 are external AnimeThemes live tests.
- TypeScript `--noEmit` passed.
- `git diff --check` passed apart from expected Windows CRLF notices.
- Independent Sol/Medium review found no remaining blocker after multiple
  targeted cleanup, upgrade, concurrency, and crash-boundary re-reviews.

## Next ticket: MC-S09

Read MC-S09 in `.planning/14-media-catalog-tickets.md` plus the PRD/TDR sections
it references before editing. MC-S09 owns ready-only listener API contracts,
Related Music browsing, catalog Search, and authenticated song streaming.
Preserve these MC-S08 boundaries:

1. Existing clients keep using the existing TV Size `audioUrl`; all catalog API
   changes are additive.
2. A song is streamable only when its `media_files` ORIGINAL row is READY and
   the relevant Full/Related acquisition/link publication is READY.
3. Never expose REQUESTED, ACQUIRING, IMPORTING, FAILED, AMBIGUOUS, partial
   Related imports, provider paths, ownership metadata, or cleanup state.
4. Full Size is global per theme. Related releases/tracks are global per anime,
   ordered deterministically, and never widened beyond accepted release tracks.
5. Reuse the authenticated media streaming/range/HEAD behavior from MC-S03;
   do not proxy Lidarr or provider files.
6. Keep `MUSIC_CATALOG_ENABLED` as the listener visibility switch. Discovery
   may continue prepopulating hidden READY data while catalog APIs stay hidden.
7. Preserve `.codex-remote-attachments/` and commit MC-S09 separately.

## Agent model policy

- Use `gpt-5.6-luna` for Luna-mapped work when available.
- If Luna is unavailable, use `gpt-5.6-terra` as its fallback.
- Never use Sol merely as a Luna fallback.
- Sol is allowed only where the original mapping explicitly permits it: UX and
  review at Medium, and medium/high-complexity development at the specified
  Medium/High effort.
