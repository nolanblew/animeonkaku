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
- MC-S08: `d916d43 feat(server): import validated music acquisitions`
- MC-S09: completed and verified in the next ticket commit after `d916d43`
  (use `git log -1 --oneline` for its final hash).

The pre-existing untracked `.codex-remote-attachments/` directory is unrelated
and must not be staged, modified, or deleted.

## MC-S09 completed scope

- Theme reads now include additive `mediaModes` while legacy `audioUrl`,
  `videoUrl`, `audioState`, duration, file size, timestamps, and tombstones keep
  their old semantics. TV Size mirrors legacy audio; usable Full and Video are
  nullable ready-only descriptors.
- Full descriptors require the exact active theme/song/source-release tuple,
  READY acquisition, and READY ORIGINAL media. Video uses the deterministic
  direct AnimeThemes candidate URL and its mime/spoiler/nsfw/version flags.
- Added authenticated `GET /v1/anime/{kitsuId}/music` and
  `GET /v1/music/releases/{releaseId}` contracts with deterministic ready-only
  Related releases/tracks and complete owning-anime context.
- `/v1/changes` adds a complete ready `musicCatalog` snapshot for every active
  anime in the caller's library on every pull, independent of `since`.
  Active themes replay on both catalog-flag states so false-to-true publishes
  old hidden READY modes and true-to-false clears cached modes immediately.
- Existing Search keys are preserved and composed with fresh global music
  release/track results, capped at 25 per kind, normalized for
  punctuation/width/accents, and carrying owning anime/release context.
- Existing authenticated song GET/HEAD streaming is gated by the catalog flag
  and an exact published Full/Related edge. Orphan READY media and inactive
  rows are hidden; original-format local streaming retains 200/206/416, HEAD,
  content type, cache, and path-containment behavior without provider proxying.

## MC-S09 verification evidence

- Independent Terra/High QA focused API/media/proxy/runtime matrix: 41/41.
- Isolated PostgreSQL 16 opt-in matrix: 12/12 across catalog API/media,
  migration, discovery, and acquisition SQL. It covered ready/partial/failed
  visibility, soft deletes, catalog-flag delta replay, normalized alias search,
  orphan media, and published Full/Related streaming. The exact temporary
  container was removed and `server-db-1` was verified untouched.
- Full default server Vitest: 46 files passed, 6 environment-gated files
  skipped; 379 tests passed and 14 skipped. The 12 PostgreSQL skips were run
  separately and passed; the other 2 are external AnimeThemes live tests.
- TypeScript `--noEmit` and `git diff --check` passed.
- Independent Sol/Medium review found no remaining code blocker.

## Next ticket: MC-S10

Read MC-S10 in `.planning/14-media-catalog-tickets.md` plus TDR section 8.5
before editing. MC-S10 owns playlist mode policy and mixed THEME/SONG entries.
Preserve these boundaries:

1. Existing playlist reads retain the legacy `entries` theme-ID projection;
   new clients use additive `defaultMode` and ordered `items`.
2. Stored playlist modes are only TV_SIZE/FULL_SIZE/null inheritance. Video is
   never stored as a playlist mode.
3. SONG entries represent ready Related catalog songs; Full Size remains a
   THEME mode and is not stored as a separate SONG item.
4. Preserve duplicate occurrences and exact mixed-item order. Do not dedupe by
   theme/song identity.
5. A legacy entries-only write must return 409
   `PLAYLIST_REQUIRES_NEW_CLIENT` rather than erase SONG items or overrides.
6. Dynamic/auto playlists continue producing THEME items and default TV_SIZE
   unless explicitly changed; keep existing LWW/delta behavior.
7. Preserve ownership scope, `.codex-remote-attachments/`, and commit MC-S10
   separately.

## Agent model policy

- Use `gpt-5.6-luna` for Luna-mapped work when available.
- If Luna is unavailable, use `gpt-5.6-terra` as its fallback.
- Never use Sol merely as a Luna fallback.
- Sol is allowed only where the original mapping explicitly permits it: UX and
  review at Medium, and medium/high-complexity development at the specified
  Medium/High effort.
