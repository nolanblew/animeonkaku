# Implementation Backlog — Media Catalog Initiative

**Status:** Ready for implementation sequencing

**Date:** 2026-07-19

**Product requirements:** [12-media-catalog-prd.md](12-media-catalog-prd.md)

**Technical design:** [13-media-catalog-tdr.md](13-media-catalog-tdr.md)

## 1. How to use this backlog

Tickets are written so a newer developer or agent can take one without
re-designing the initiative. The TDR is authoritative for identities,
contracts, storage, and fallback behavior.

Before starting a ticket:

1. Read the PRD requirement groups listed for the ticket in the traceability
   table.
2. Read the relevant TDR sections.
3. Inspect the named current files and their tests.
4. Confirm all dependency tickets are merged into the working branch.
5. Preserve unrelated user changes in the worktree.

Effort estimates are focused implementation days for a developer familiar with
the stack, including ticket-level tests and documentation but excluding review
wait time and device-lab scheduling.

| Size | Typical effort |
|---|---:|
| S | 0.5–1.5 days |
| M | 2–3 days |
| L | 4–5 days |
| XL | 6–8 days |

Difficulty measures reasoning and regression risk:

- **Low:** local change with established patterns.
- **Medium:** several files/layers, but a narrow contract.
- **High:** identity, persistence, asynchronous workflows, or playback state.

A newer contributor should allow approximately 1.5 times the estimate,
especially for High-difficulty Android media tickets.

## 2. Shared definition of done

Every ticket must:

- Keep existing TV Size URLs, files, downloads, and playback valid.
- Use additive server read contracts unless the TDR explicitly defines a
  guarded coordinated write migration.
- Add or update tests at the closest stable boundary.
- Avoid listener-visible searching/downloading/provider states.
- Avoid logging bearer tokens, provider API keys, or complete provider paths.
- Update the relevant planning/API/README text when a contract changes.
- Run focused tests and the containing server or Android unit suite.
- Leave no ignored or silently skipped migration/schema changes.

Any ticket touching NowPlayingManager must cover:

- duplicate items.
- single and multi-item Play Next/Add to Queue.
- shuffle/unshuffle.
- queue restoration.
- queueId identity across Media3 synchronization.

Any ticket touching downloads must cover:

- Wi-Fi-only.
- retry and pause.
- removal.
- airplane-mode playback.
- exact media-key behavior.

## 3. Product traceability

| Requirement group | Primary implementation tickets |
|---|---|
| CAT-001–CAT-011 automatic catalog/exact matching | MC-S01, MC-S02, MC-S04–MC-S09, MC-S12 |
| MOD-001–MOD-013 Now Playing modes/fallback | MC-S02, MC-S09, MC-A01–MC-A05 |
| VID-001–VID-010 direct embedded video | MC-S02, MC-S09, MC-A03–MC-A06 |
| PLY-001–PLY-012 playlist policy | MC-S01, MC-S10, MC-A01, MC-A03, MC-A08, MC-A10 |
| REL-001–REL-010 Related Music/Search/Home | MC-S01, MC-S08, MC-S09, MC-A01, MC-A02, MC-A07, MC-A11 |
| REA-001–REA-005 reactions/history | MC-S01, MC-S11, MC-A01, MC-A03, MC-A09 |
| DWN-001–DWN-010 downloads/offline | MC-S03, MC-S08, MC-S09, MC-A01, MC-A03, MC-A08, MC-A10 |
| REG-001–REG-005 compatibility | MC-S01, MC-S03, MC-S09, MC-S10, MC-A01–MC-A04, MC-A10, MC-Q01 |

MC-Q01 verifies every requirement group end to end.

## 4. Dependency map

~~~mermaid
flowchart TD
    S01["MC-S01 Server catalog schema"]
    S02["MC-S02 AnimeThemes song/video fidelity"]
    S03["MC-S03 Original-format media storage"]
    S04["MC-S04 Provider contract/config"]
    S05["MC-S05 Lidarr adapter"]
    S06["MC-S06 Query and match engine"]
    S07["MC-S07 Discovery scheduler/jobs"]
    S08["MC-S08 Reconcile and import"]
    S09["MC-S09 Ready catalog APIs"]
    S10["MC-S10 Playlist server model"]
    S11["MC-S11 Reactions and plays server"]
    S12["MC-S12 Operator/deployment surfaces"]
    A01["MC-A01 Android DTO/Room migration"]
    A02["MC-A02 Unified playable queue"]
    A03["MC-A03 Mode resolver and persistence"]
    A04["MC-A04 Media3 routing and switching"]
    A05["MC-A05 Now Playing and video UI"]
    A06["MC-A06 Browse Play Video actions"]
    A07["MC-A07 Related Music and Search UI"]
    A08["MC-A08 Playlist policy UI/sync"]
    A09["MC-A09 Reactions/history client"]
    A10["MC-A10 Device downloads v2"]
    A11["MC-A11 Home OST integration"]
    Q01["MC-Q01 End-to-end acceptance/rollout"]

    S01 --> S02
    S01 --> S03
    S01 --> S04
    S01 --> S10
    S01 --> S11
    S04 --> S05
    S02 --> S06
    S04 --> S06
    S05 --> S07
    S06 --> S07
    S03 --> S08
    S05 --> S08
    S06 --> S08
    S07 --> S08
    S02 --> S09
    S03 --> S09
    S08 --> S09
    S05 --> S12
    S07 --> S12
    S08 --> S12
    S09 --> A01
    S10 --> A01
    S11 --> A01
    A01 --> A02
    A01 --> A03
    A02 --> A03
    A02 --> A04
    A03 --> A04
    A04 --> A05
    A03 --> A06
    A05 --> A06
    A01 --> A07
    A02 --> A07
    A01 --> A08
    A03 --> A08
    A01 --> A09
    A03 --> A09
    A01 --> A10
    A03 --> A10
    A08 --> A10
    A01 --> A11
    A07 --> A11
    S12 --> Q01
    A05 --> Q01
    A06 --> Q01
    A07 --> Q01
    A08 --> Q01
    A09 --> Q01
    A10 --> Q01
    A11 --> Q01
~~~

## 5. Recommended delivery waves

| Wave | Tickets | Outcome |
|---|---|---|
| 1 | MC-S01 | Stable server identities and migration |
| 2 | MC-S02, MC-S03, MC-S04, MC-S10, MC-S11 | Parallel server foundations |
| 3 | MC-S05, MC-S06 | Provider and deterministic reasoning |
| 4 | MC-S07, MC-S08 | Automatic acquisition produces ready audio |
| 5 | MC-S09, MC-S12 | Client-facing catalog and operator readiness |
| 6 | MC-A01, then MC-A02 | Android storage and unified queue foundation |
| 7 | MC-A03, MC-A07, MC-A09 | Mode state, Related Music, reactions |
| 8 | MC-A04, MC-A08, MC-A11 | Media engine, playlists, Home |
| 9 | MC-A05, MC-A06, MC-A10 | Video UX, browse actions, downloads |
| 10 | MC-Q01 | Full-system verification and staged enablement |

Server work in Waves 2 and Android work in Waves 7–9 can be parallelized when
their direct dependencies are satisfied.

## 6. Server tickets

### MC-S01 — Add the music catalog and acquisition schema

| Field | Value |
|---|---|
| Status | ✅ Complete (2026-07-19) |
| Area | Server / PostgreSQL / Drizzle |
| Difficulty | High |
| Effort | L, 4–5 days |
| Depends on | None |
| Unlocks | Every other server ticket |

#### Context

The current server has themes, theme artists, media files, jobs, theme prefs,
and theme-only playlist entries. The TDR requires stable song/release identity
before provider or API code is written.

#### Scope

- Add Drizzle tables and indexes for songs, music_releases, release_tracks,
  anime_music_releases, theme_full_songs, theme_video_sources,
  music_discovery_state, music_acquisitions, song_prefs, and play_events.
- Add media_files content_type and source_file_name.
- Add playlists.default_mode.
- Replace playlist entry identity with entry ID plus item_type, item_id,
  mode_override, and order_index while preserving duplicates.
- Add theme_prefs disliked_tv_size and disliked_full_size.
- Generate a new migration with the repository's normal Drizzle workflow.
- Backfill existing playlists to TV_SIZE/THEME/null override.
- Keep every existing media_files row and canonical TV key unchanged.

Expected areas:

- server/src/db/schema.ts
- server/drizzle
- server/test migration/schema contract coverage
- .planning/05-server-data-model.md as a historical note or supersession link

#### Acceptance criteria

- Migration applies to a populated current schema without deleting catalog,
  playlist, preference, job, or media rows.
- Existing duplicate playlist occurrences retain order.
- Existing media uniqueness remains valid.
- New foreign keys and uniqueness rules match TDR section 4.
- Downstream TypeScript can address every new row through exported Drizzle
  symbols.

#### Verification

- Generate migration; do not hand-edit previously applied migrations.
- Run server typecheck and full Vitest.
- Add a migration fixture containing duplicate theme playlist entries and
  ready TV media.
- Apply migration twice through the normal migration runner to prove normal
  idempotent startup behavior.

#### Completion and testing notes

- Implemented the catalog, relationship, discovery, acquisition, preference,
  playback-event, media metadata, playlist mode, and polymorphic playlist-entry
  schema in Drizzle migration `0008_silent_doctor_doom.sql`.
- Updated existing playlist readers and writers to retain the legacy
  theme-only listener contract while storing independently identified `THEME`
  occurrences. Existing duplicate occurrences and order are preserved.
- Server TypeScript typecheck passed.
- Full server Vitest passed: 36 files passed, 2 skipped; 206 tests passed and 3
  skipped when the opt-in database fixture was not configured.
- The opt-in populated PostgreSQL migration test passed separately against a
  temporary PostgreSQL 16 container: 1 file and 1 test passed. It seeded
  duplicate playlist occurrences and ready `AUDIO`/raw-theme-ID/`SHORT` media,
  then ran the normal startup migrator twice and verified all rows and
  backfills were preserved.
- Independent light review found no blocking or actionable issues. The
  temporary PostgreSQL test container was removed after verification.

#### Handoff notes

Do not add provider calls or listener APIs here. Seed no fake songs. Keep
provider and relationship status columns as text with TypeScript unions, which
matches the current project's pragmatic schema style.

### MC-S02 — Preserve AnimeThemes song, entry, and video candidate metadata

| Field | Value |
|---|---|
| Status | ✅ Complete (2026-07-20) |
| Area | Server / AnimeThemes client and sync |
| Difficulty | Medium |
| Effort | M, 2–3 days |
| Depends on | MC-S01 |
| Unlocks | MC-S06, MC-S09 |

#### Context

The current parser flattens entries, selects the first usable video, omits
AnimeThemes song ID/resources, and cannot apply the approved deterministic
selection order.

#### Scope

- Expand AnimeThemes includes for song resources and complete entry/video
  fields needed by the TDR.
- Add typed song ID and video candidate models.
- Parse all entry/video candidates rather than selecting with find.
- Upsert songs by AnimeThemes song ID where possible.
- Upsert theme_video_sources and choose the preferred remote descriptor.
- Stop enumerating VIDEO as a downloadable theme media source.
- Refresh changed video links during normal anime remapping.

Expected areas:

- server/src/animethemes/types.ts
- server/src/animethemes/parse.ts
- server/src/animethemes/client.ts
- server/src/media/catalogLookup.ts
- server/src/sync/drizzleSyncRepository.ts
- existing AnimeThemes parser/client/sync tests

#### Acceptance criteria

- Multiple entries and videos survive parsing with stable IDs/flags.
- Selection follows exact theme/song, safe content, earliest version, source/
  resolution, then stable ID.
- No video media row or video fetch job is produced.
- Selected direct link and warning flags can be projected to a theme DTO.
- Existing TV audio parsing remains unchanged.

#### Verification

- Fixture with multiple safe/unsafe/spoiler/version candidates.
- Fixture with reused AnimeThemes song ID across themes.
- Fixture with changed remote video link.
- Full server suite and typecheck.

#### Completion and testing notes

- Expanded AnimeThemes includes and parsing to retain song IDs/resources and
  every stable entry/video descriptor while keeping historical TV-audio
  extraction unchanged.
- Added deterministic video selection across safe-content flags, entry
  version/order, source, resolution, and stable video ID. Regression coverage
  proves the same result when unordered upstream entries are rearranged and
  preserves warning flags when every candidate is warned.
- Normal remapping now deduplicates songs by AnimeThemes song ID, persists a
  case-insensitive MusicBrainz recording resource without erasing a previously
  known ID, refreshes changed video links, and deletes stale descriptors.
- Removed remote AnimeThemes video from downloadable media enumeration; no
  video media row or fetch job is produced.
- Server TypeScript typecheck passed. Full Vitest passed: 37 files passed, 2
  skipped; 214 tests passed and 3 environment-gated tests skipped.
- Independent light review initially found two issues (discarded MusicBrainz
  identity and unstable array-order ranking); both were corrected and covered
  by regression tests. Follow-up review found no remaining actionable issue.

#### Handoff notes

AnimeThemes Video is theme footage and a remote playback mode. Do not call it a
full-length music video and do not write it to MEDIA_ROOT.

### MC-S03 — Generalize the media store for original-format catalog songs

| Field | Value |
|---|---|
| Status | ✅ Complete (2026-07-20) |
| Area | Server / media storage and streaming |
| Difficulty | High |
| Effort | L, 4–5 days |
| Depends on | MC-S01 |
| Unlocks | MC-S08, MC-S09, MC-A10 |

#### Context

MediaStore currently downloads remote content to predetermined Ogg/image paths.
Lidarr yields local imported files in several original formats. Full Size and
Related Music must be copied without transcoding and streamed with the correct
content type.

#### Scope

- Add ORIGINAL to MediaVariant and helpers for song:{id} media refs.
- Add original-format catalog-song path generation.
- Add a local-file import path alongside fetchToMediaFile.
- Validate configured source-root containment and supported audio extension.
- Copy via temporary file, hash, verify, and atomically rename.
- Persist content type and source basename.
- Generalize streaming service/repository to serve a ready song media record.
- Keep current TV route/path/content behavior frozen.

Expected areas:

- server/src/media/types.ts
- server/src/media/mediaLayout.ts
- server/src/media/mediaStore.ts or a focused importer
- server/src/media/pgMediaFileRepo.ts
- server/src/api/mediaRoutes.ts
- server/src/api/drizzleMediaApiRepository.ts
- media store/route tests

#### Acceptance criteria

- FLAC, MP3, M4A/AAC, Ogg/Opus, and WAV fixtures retain original bytes and a
  correct safe extension/content type.
- Import is idempotent when READY file and hash still exist.
- A missing READY file is importable again.
- Paths outside the mounted provider root are rejected.
- TV Size route and audio/{themeId}.ogg tests are unchanged and green.

#### Verification

- Real temporary-file tests for copy/hash/atomic move.
- GET/HEAD and valid/invalid Range tests for at least MP3 and FLAC.
- Run full server suite and typecheck.

#### Completion and testing notes

- Added stable `song:{id}`/`ORIGINAL` media descriptors and
  `audio/songs/{id}/original.{extension}` paths without changing canonical TV
  `audio/{themeId}.ogg` identity or routes.
- Added original-byte local imports for FLAC, MP3, M4A, AAC, Ogg, Opus, and
  WAV with provider-root containment, temporary copy, SHA-256 hashing, atomic
  publication, persisted content type/source filename, READY idempotency, and
  missing/corrupt-file recovery.
- Added canonical managed-media path checks for both imports and streaming so
  symlink/junction escapes beneath `MEDIA_ROOT` are rejected. Extension-changing
  reimports publish and mark the replacement READY before safely removing only
  the prior allowlisted path for that same song.
- Added authenticated ready-only catalog-song GET/HEAD streaming with ETag,
  immutable caching, source filename, valid/invalid Range behavior, and no
  proxy or on-demand provider fallback.
- Focused MC-S03 tests passed: 41/41. Server TypeScript typecheck passed. Full
  Vitest passed: 38 files passed, 2 skipped; 237 tests passed and 3
  environment-gated tests skipped.
- Independent light review found two medium issues (managed-path symlink escape
  and stale files after an extension change). Both were fixed with regression
  tests; targeted follow-up review cleared the ticket with no remaining
  actionable findings.

#### Handoff notes

Do not make the server infer quality tiers or transcode. Only basic format
allowlisting/path safety is required.

### MC-S04 — Define provider-neutral acquisition contracts and configuration

| Field | Value |
|---|---|
| Status | ✅ Complete (2026-07-20) |
| Area | Server / integration boundary |
| Difficulty | Medium |
| Effort | M, 2–3 days |
| Depends on | MC-S01 |
| Unlocks | MC-S05, MC-S06 |

#### Context

Lidarr is the first provider, but matching and listener behavior must not depend
on Lidarr concepts.

#### Scope

- Define MusicCatalogResolver inputs/outputs and evidence types.
- Define MusicAcquisitionProvider health, lookup, ensure, start, status, file
  listing, and cleanup methods.
- Define normalized provider release/track/file records.
- Add conditional environment configuration from TDR section 7.2.
- Add disabled provider implementation.
- Wire config validation without requiring Lidarr variables when discovery is
  disabled.
- Add provider-specific upstream HTTP instance using existing retry/breaker
  patterns.

Expected areas:

- server/src/config.ts
- new server/src/music domain/integration modules
- server/src/index.ts
- server/.env.example
- config/runtime wiring tests

#### Acceptance criteria

- Server starts unchanged with music discovery disabled.
- Enabling LIDARR fails fast with a clear message when required config is
  missing.
- Provider records contain no listener DTO types.
- API key is not included in structured URLs or logs.
- A fake provider can drive later matcher/job tests.

#### Verification

- Config tests for disabled, valid Lidarr, and missing-field cases.
- Fake-provider contract test.
- Typecheck and full server suite.

#### Completion and testing notes

- Added provider-neutral catalog resolver and acquisition contracts, normalized
  release/track/imported-file records, match evidence/reasons, season release
  classification, and a disabled provider implementation.
- Ensure/cleanup contracts carry durable provider ownership, prior monitoring
  state, and opaque cleanup context so later reconciliation remains safe after
  process restarts. Imported records distinguish provider and server-readable
  paths and expose the title/artist/duration/MusicBrainz evidence needed for
  exact-track validation.
- Added conditional catalog/discovery/Lidarr environment configuration. Existing
  startup remains unchanged with music disabled; selecting Lidarr fails fast
  when required fields are absent, and optional path prefixes must be paired.
- Added a dedicated Lidarr upstream HTTP instance using the existing retry,
  background token-bucket lane, and circuit-breaker patterns. The API key is
  injected only through `X-Api-Key`; tests prove it is absent from URLs and
  structured logs.
- Focused contract/config tests passed: 7/7. Server TypeScript typecheck passed.
  Full Vitest passed: 40 files passed, 2 skipped; 244 tests passed and 3
  environment-gated tests skipped.
- Independent light review found four downstream contract/wiring gaps. All were
  corrected and the targeted follow-up review cleared the ticket with no
  remaining actionable findings.

#### Handoff notes

Do not install a Lidarr SDK. The current fetch/Zod/upstream stack is enough and
keeps the adapter small.

### MC-S05 — Implement the thin Lidarr acquisition adapter

| Field | Value |
|---|---|
| Status | ✅ Complete (2026-07-20) |
| Area | Server / Lidarr |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-S04 |
| Unlocks | MC-S07, MC-S08, MC-S12 |

#### Context

Lidarr searches and acquires releases, not individual tracks. Anime Ongaku must
control ownership, poll asynchronously, and validate the exact imported file.

#### Scope

- Implement X-Api-Key authentication and Zod parsing for required endpoints.
- Support album lookup, existing album detection, add/monitor, AlbumSearch
  command, command status, queue/history, track, and track-file reads.
- Record adapter-created IDs, ownership tag, and prior monitoring state.
- Implement path-prefix mapping from Lidarr paths to the read-only shared
  mount.
- Implement cleanup only for adapter-created temporary albums/resources.
- Expose deterministic adapter errors and retryability.

Expected areas:

- new server/src/music/providers/lidarr modules
- server/src/index.ts
- injected HTTP/fake-fetch tests
- README provider setup notes may be finished in MC-S12

#### Acceptance criteria

- Existing operator albums are reused and never deleted.
- Adapter-created albums are identifiable and cleanup-safe.
- AlbumSearch command IDs and terminal states are parsed.
- Imported track records expose MusicBrainz recording ID, title, artist,
  duration, and mapped readable file path.
- Provider failures are typed; secrets are redacted.

#### Verification

- Fixture tests for lookup miss/hit, add, search, running/completed/failed,
  imported files, path mapping, and cleanup ownership.
- Test unexpected/missing fields and 401/404/429/500 handling.
- Typecheck and full server suite.

#### Completion and testing notes

- Added the Lidarr v1 adapter for health, album lookup, existing-album reuse,
  OpenAPI-shaped artist/album creation, monitoring, `AlbumSearch`, command
  status, queue/history diagnostics, and imported track/file reads.
- Provider context durably records the numeric Lidarr album ID, MusicBrainz
  release-group identity, adapter ownership, created artist identity/tag, and
  prior monitoring state.
  Existing operator albums are never deleted; temporary monitoring is restored
  only when requested, and adapter-created cleanup rechecks both durable IDs
  before deleting the Lidarr resource without deleting media files. A created
  artist is removed only after its exact identity/tag is rechecked and the
  temporary owned album is proven to be its only album.
- Imported files expose the exact MusicBrainz recording ID, album artist,
  title, duration, content type, provider path, and mapped server-readable path.
  Windows and POSIX path mapping rejects prefix lookalikes, dot segments, and
  paths outside the configured shared root.
- Added typed/retryable handling for malformed payloads, network failures, and
  401/404/429/5xx responses. API-key authentication remains header-only and
  redacted by the provider HTTP boundary established in MC-S04.
- Focused OpenAPI-faithful Lidarr fixture tests passed: 23/23. Server TypeScript
  typecheck passed. Full Vitest passed: 41 files passed, 2 skipped; 267 tests
  passed and 3 environment-gated tests skipped.
- Independent review initially found six contract and safety issues: invalid
  album creation shape/ownership proof, incomplete imported metadata,
  dot-segment path escape, missing monitoring restoration, unhandled `orphaned`
  command state, and release/release-group identity conflation. Follow-up review
  then found orphaned adapter-created artists; safe artist cleanup and
  preservation cases were added. All findings are covered by regression tests,
  and final review found no remaining actionable issue.

#### Handoff notes

Prefer AlbumSearch for the first implementation. Do not add immediate release
grab complexity unless a fixture proves it is required.

### MC-S06 — Implement multilingual query generation and conservative matching

| Field | Value |
|---|---|
| Area | Server / catalog reasoning |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-S01, MC-S02, MC-S04 |
| Unlocks | MC-S07, MC-S08 |

#### Context

This ticket is the main false-positive control. It must produce explainable
evidence and keep ambiguous candidates invisible.

#### Scope

- Implement Unicode NFKC/title/artist normalization and token comparison.
- Generate deduplicated English, romaji, Japanese, song, artist, and release
  queries.
- Merge provider candidates by stable provider/MusicBrainz identity.
- Implement Full Size hard gates, exclusions, score, threshold, and margin.
- Implement Related Release anime-season gate, classification, score, and
  margin.
- Produce compact evidence and rejection reasons.
- Create accepted song/release/link intents without acquiring files.

Expected areas:

- new server/src/music/matching modules
- AnimeThemes/domain types from MC-S02
- extensive table-driven fixtures

#### Acceptance criteria

- Instrumental, karaoke, off-vocal, live, remix, cover, TV edit, and alternate
  performer fixtures never pass Full Size.
- Artist-only relationship never passes Related Music.
- Exact MusicBrainz recording identity wins unless conflicting evidence exists.
- Candidates below 85/80 or within the 10-point margin remain AMBIGUOUS.
- Evidence identifies which fields contributed or rejected.

#### Verification

- Curated multilingual fixtures including punctuation, width/case, Japanese,
  romaji, translated titles, and reused releases.
- Golden tests for score/evidence stability.
- Full server suite and typecheck.

#### Handoff notes

Do not lower thresholds merely to make fixtures pass. A missing option is valid
product behavior.

### MC-S07 — Add automatic discovery scheduling and durable job workflows

| Field | Value |
|---|---|
| Area | Server / scheduler and jobs |
| Difficulty | High |
| Effort | L, 4–5 days |
| Depends on | MC-S05, MC-S06 |
| Unlocks | MC-S08, MC-S12 |

#### Context

Discovery is automatic, bounded, and invisible to listeners. Long provider
downloads must not occupy a worker.

#### Scope

- Add MUSIC_CATALOG_SCAN, DISCOVER_ANIME_MUSIC, and
  RECONCILE_MUSIC_ACQUISITION job types/timeouts/handlers.
- Create discovery-state repository methods and dedupe keys.
- Enqueue immediate discovery after a new anime mapping.
- Implement daily due selection: recent weekly, missing Full Size monthly,
  oldest first, maximum 25.
- Persist attempts, success, next scan, ambiguity, and operational errors.
- Requeue acquisition polling through next_run_at without sleeping a worker.
- Respect disabled discovery/catalog feature switches.

Expected areas:

- server/src/jobs/types.ts
- server/src/jobs/jobWorker.ts timeout map
- server/src/sync pipeline hook
- new server/src/music jobs/scheduler/repository
- server/src/index.ts

#### Acceptance criteria

- Repeated scans/jobs dedupe correctly.
- Recent and missing schedules follow the TDR.
- A provider acquisition lasting hours causes short polling jobs, not a held
  worker promise.
- Provider outage does not consume infinite attempts or block normal sync/media.
- No listener route changes in this ticket.

#### Verification

- Fake-clock scheduler tests.
- Job repository/handler tests for dedupe, requeue, failure, and restart.
- Test new mapping immediate enqueue.
- Full server suite and typecheck.

#### Handoff notes

Use the current database queue. Do not introduce cron containers, webhooks,
Redis, or another worker service.

### MC-S08 — Reconcile acquisitions and import only validated audio

| Field | Value |
|---|---|
| Area | Server / acquisition completion |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-S03, MC-S05, MC-S06, MC-S07 |
| Unlocks | MC-S09 |

#### Context

The provider reporting a completed album is not proof that the correct Full
Size track exists. Anime Ongaku must validate imported tracks, copy only
allowed files, and publish atomically.

#### Scope

- Add IMPORT_MUSIC_AUDIO handler and acquisition state transitions.
- For Full Size, choose exactly one track by recording ID or strong
  title/artist/duration evidence.
- For Related Music, choose only tracks belonging to the accepted release.
- Import through MC-S03 and create/update song, release, release-track, anime
  link, and theme Full Size link rows.
- Publish readiness only after media_files is READY.
- Clean adapter-created provider resources after successful copy.
- Make retry/idempotency safe around crashes between copy, DB write, and
  cleanup.

Expected areas:

- new server/src/music acquisition/import service
- new repositories
- media importer from MC-S03
- job handlers and integration-style tests

#### Acceptance criteria

- Full acquisition copies one validated track and no unrelated album tracks.
- Related acquisition copies its validated in-scope track set.
- Same recording reused by two themes produces one song media file.
- Crash/retry does not duplicate rows/files or delete operator-owned media.
- Failed or ambiguous import never becomes listener-ready.
- Successful readiness bumps affected theme/catalog updated timestamps.

#### Verification

- Temp-directory fake Lidarr end-to-end fixtures.
- Crash-point/idempotency tests around READY and cleanup boundaries.
- Reused-song and multi-release tests.
- Full server suite and typecheck.

#### Handoff notes

Provider cleanup is best effort after Anime Ongaku owns a validated copy.
Failure to clean must not unpublish otherwise valid audio.

### MC-S09 — Expose ready modes, Related Music, Search, and song streaming

| Field | Value |
|---|---|
| Area | Server / client API |
| Difficulty | High |
| Effort | L, 4–5 days |
| Depends on | MC-S01, MC-S02, MC-S03, MC-S08 |
| Unlocks | MC-A01, MC-A07, MC-A10 |

#### Context

Android needs additive ready-only catalog contracts. Existing clients must keep
using audioUrl without seeing background states.

#### Scope

- Add mediaModes to theme DTO/service mapping.
- Add musicCatalog snapshot to /v1/changes.
- Add anime music and release detail routes.
- Add ready track/release sections to existing Search.
- Add GET/HEAD /v1/media/songs/{songId}/audio with current auth/Range behavior.
- Bump theme/catalog timestamps on visible changes.
- Omit unready, failed, metadata-only, and ambiguous media.
- Keep legacy theme fields unchanged.

Expected areas:

- server/src/api/clientRoutes.ts
- server/src/api/drizzleClientApiService.ts
- server/src/api/mediaRoutes.ts
- server/src/api/drizzleMediaApiRepository.ts
- server/src/api/proxyRoutes.ts or focused music route module
- route/contract tests

#### Acceptance criteria

- Ready Full Size produces a complete fullSize descriptor.
- Missing Full Size and offline-only operational state produce null/absence.
- Video descriptor uses direct AnimeThemes URL and flags.
- Related releases with zero ready tracks are absent.
- Search results include owning anime context.
- Song audio supports 200/206/416 and correct content type.
- Older DTO fields and TV tests remain green.

#### Verification

- Route fixtures for every availability combination.
- Additive JSON parsing/contract tests.
- Range tests across original formats.
- Full server suite and typecheck.

#### Handoff notes

Do not add listener request/progress endpoints. Search can use simple ILIKE and
small result limits.

### MC-S10 — Upgrade server playlists for defaults, overrides, and Related songs

| Field | Value |
|---|---|
| Area | Server / playlists and sync |
| Difficulty | High |
| Effort | L, 4–5 days |
| Depends on | MC-S01 |
| Unlocks | MC-A01, MC-A08 |

#### Context

Playlists need a shared TV/Full default, per-theme override, and Related SONG
items without storing Video.

#### Scope

- Add defaultMode and items to playlist DTOs and writes.
- Preserve legacy entries theme-ID projection for reads.
- Support THEME and SONG item validation, duplicate occurrences, order, and
  mode overrides.
- Update dynamic/auto playlist materialization to emit THEME/null overrides and
  TV_SIZE default unless explicitly changed.
- Include new data in delta sync/LWW behavior.
- Reject destructive legacy updates with PLAYLIST_REQUIRES_NEW_CLIENT.

Expected areas:

- server/src/api/clientRoutes.ts
- server/src/api/drizzleClientApiService.ts
- server/src/playlists
- server/src/sync
- playlist contract/LWW/dynamic tests

#### Acceptance criteria

- Default and every override round-trip across create/read/update/changes.
- Related SONG entries retain order and duplicates.
- Video is rejected as a stored mode.
- Legacy reads remain useful for theme-only playlists.
- Legacy write cannot erase SONG/override data.
- Auto/dynamic playlist behavior remains stable.

#### Verification

- Create/update/delete/LWW contract tests.
- Duplicate mixed-entry fixtures.
- Auto/dynamic refresh regression tests.
- Full server suite and typecheck.

#### Handoff notes

Cross-account playlist sharing/ACLs are not added. Preserve the existing
ownership model; the new policy fields travel wherever the playlist already
travels.

### MC-S11 — Add mode-specific theme reactions, song prefs, and actual-mode plays

| Field | Value |
|---|---|
| Area | Server / user state |
| Difficulty | Medium |
| Effort | L, 4–5 days |
| Depends on | MC-S01 |
| Unlocks | MC-A01, MC-A09 |

#### Context

Existing theme prefs contain one broad dislike and play aggregate. The new
product needs TV-only/Full-only dislikes, Related song reactions, and actual
mode history.

#### Scope

- Extend theme preference DTO/write/LWW fields.
- Define broad-versus-specific update semantics.
- Add song preference read/write routes and a songPrefs updated-at/tombstone
  delta array in /v1/changes.
- Extend play batches with itemType/itemId/actualMode.
- Store play_events and continue existing theme aggregate updates.
- Map legacy themeId-only play events to THEME/TV_SIZE.
- Ensure like clears incompatible broad/specific dislikes consistently.

Expected areas:

- server/src/api/clientRoutes.ts
- server/src/api/drizzleClientApiService.ts
- server/src/sync/lww.ts
- server user-state tests

#### Acceptance criteria

- Broad theme dislike suppresses all modes.
- TV-only and Full-only flags can be set/cleared independently of the other
  audio mode.
- Related song like/dislike round-trips independently.
- Play event records actual mode and updates compatible aggregates once.
- New play events carry a client-generated UUID clientEventId; the server
  deduplicates on user plus clientEventId so offline retries are idempotent.

#### Verification

- LWW and like/dislike interaction matrix.
- Legacy/new play contract tests.
- Related song preference tests.
- Full server suite and typecheck.

#### Handoff notes

There is no video-only dislike and no anime-wide default dislike.

### MC-S12 — Add operator diagnostics, cache removal, and Lidarr deployment docs

| Field | Value |
|---|---|
| Area | Server / operations |
| Difficulty | Medium |
| Effort | M, 2–3 days |
| Depends on | MC-S05, MC-S07, MC-S08, MC-S09 |
| Unlocks | MC-Q01 |

#### Context

Listeners see ready/absent only, so the operator needs a basic way to inspect
failures, retry, and remove Anime Ongaku's cache. This remains intentionally
small.

#### Scope

- Add authenticated operator acquisition list/retry routes consistent with
  existing job admin access.
- Add operator song-media cache deletion that marks media missing without
  deleting catalog/user state or provider media.
- Add provider reachability to diagnostics, not main health failure.
- Document env variables, path mapping, read-only mount, dedicated-root
  recommendation, and enablement switches.
- Update Docker compose examples with optional Lidarr music mount/config.
- Ensure logs redact API key and avoid full provider paths.

Expected areas:

- server/src/jobs/adminRoutes.ts or new admin music routes
- server/src/app.ts and index wiring
- server/README.md
- server/.env.example
- server/docker-compose files

#### Acceptance criteria

- Operator can identify FAILED/AMBIGUOUS/stuck acquisitions and requeue failed
  work.
- Cache deletion removes only the selected Anime Ongaku file and readiness.
- Lidarr outage does not fail /healthz.
- A fresh operator can configure the integration from README instructions.

#### Verification

- Admin auth/route tests.
- Cache deletion temp-file test.
- Config example validation.
- Full server suite and typecheck.

#### Handoff notes

Do not build a full admin UI or manual match approval in this ticket.

## 7. Android tickets

### MC-A01 — Add API DTOs, Room music models, and migration

| Field | Value |
|---|---|
| Area | Android / Retrofit / Room / sync |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-S09, MC-S10, MC-S11 |
| Unlocks | Every other Android ticket |

#### Context

Android must cache songs/releases/modes and migrate playlists/downloads without
losing current TV data.

#### Scope

- Add DTOs for mediaModes, musicCatalog, release detail/search, playlist items,
  new prefs, and play events.
- Add Room entities/DAOs from TDR section 9.1.
- Add AppDatabase migration and schema snapshot.
- Extend LibraryPullMapper/cache transaction for music snapshot replacement.
- Resolve all server media URLs against the active base; preserve direct video
  URLs.
- Migrate legacy playlists/downloads/settings exactly as TDR specifies.
- Keep compatibility fields during transition.

Expected areas:

- data/remote/OngakuModels.kt and OngakuApi.kt
- data/local entities, DAOs, AppDatabase.kt
- sync/LibraryPullMapper and RoomLibraryPullCache
- Room schema snapshots and unit tests

#### Acceptance criteria

- Full current DB migrates without data loss.
- Existing playlist rows become THEME entries with stable entry IDs and
  TV_SIZE default.
- Existing completed downloads become exact TV media keys.
- Ready music snapshot replaces junctions transactionally.
- Old server responses with no new fields still parse safely.
- Direct video URL remains external and is not rebased.

#### Verification

- API deserialization fixtures for old and new contracts.
- Room migration test from current schema snapshot.
- Mapper/merge/tombstone tests.
- Android unit suite and lint/assemble as appropriate.

#### Handoff notes

Do not expose UI yet. Independent download entities must not be deleted when a
music snapshot changes.

### MC-A02 — Generalize the queue from ThemeEntity to PlayableItem

| Field | Value |
|---|---|
| Area | Android / queue and persistence |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-A01 |
| Unlocks | MC-A03, MC-A04, MC-A07 |

#### Context

Related Music cannot enter the current ThemeEntity-only queue safely. This is a
foundational refactor with strict existing queue invariants.

#### Scope

- Introduce PlayableKey and Theme/RelatedSong PlayableItem domain types.
- Change QueueEntry to hold PlayableItem plus base mode policy.
- Generalize play, Play Next, Add to Queue, shuffle, history, suggestions,
  unskip, and display metadata.
- Persist queueId plus typed item reference.
- Restore legacy themeId-only persisted queues.
- Load related song/release/anime context through DAOs.
- Keep convenience adapters for existing theme-only UI call sites during
  migration.

Expected areas:

- media/NowPlayingManager.kt
- media/NowPlayingPersistence.kt
- media/QueueDiff.kt
- player Up Next/UI display helpers
- NowPlayingManager and persistence tests

#### Acceptance criteria

- THEME and SONG entries can mix in one queue.
- Duplicate occurrences retain distinct queueIds through every operation.
- Existing single/multi insertion order rules remain.
- Restore skips deleted catalog items without corrupting current index.
- Legacy persisted queue restores as THEME entries.
- No synthetic ThemeEntity is created for Related Music.

#### Verification

- Expand NowPlayingManagerTest with mixed and duplicate item matrices.
- Persistence round-trip and legacy fixture.
- QueueDiff and Media3 identity-focused tests where possible.
- Full Android unit suite.

#### Handoff notes

Do not implement mode switching here. Keep queue identity independent from
playback source identity.

### MC-A03 — Implement mode policy, preference, fallback, and offline resolver

| Field | Value |
|---|---|
| Area | Android / playback domain |
| Difficulty | High |
| Effort | L, 4–5 days |
| Depends on | MC-A01, MC-A02 |
| Unlocks | MC-A04, MC-A06, MC-A08, MC-A09, MC-A10 |

#### Context

Mode selection must distinguish playlist policy, remembered preference,
session override, actual fallback, availability, and exact offline state.

#### Scope

- Add PlaybackMode, ThemeModePolicy, playback intent/state, and
  ResolvedPlaybackItem.
- Add device-local remembered audio mode and Show OST setting storage.
- Implement queue replacement/reset semantics.
- Implement playlist precedence and manual session override.
- Implement exact fallback ordering.
- Resolve server versus local MediaKey URI.
- Hide/disable modes based on ready metadata and connectivity.
- Expose subtle retained-intent reason to the ViewModel.

Expected areas:

- new media resolver/policy classes
- NowPlayingManager integration
- preference storage/repository
- ConnectivityMonitor and download DAO integration

#### Acceptance criteria

- Exhaustive preferred/availability/connectivity matrix matches PRD.
- Full preference persists; Video does not survive restart/context replacement.
- Manual mode does not mutate playlist rows.
- Related song always resolves RELATED_AUDIO.
- Offline requires exact media key and never substitutes.
- Fallback preserves preferred intent for the next item.

#### Verification

- Pure table-driven resolver tests.
- Playlist precedence tests.
- preference persistence/reset tests.
- exact offline matrix.
- Full Android unit suite.

#### Handoff notes

This resolver is the only place UI, Media3, and downloads should ask which
source/mode to use.

### MC-A04 — Route authenticated audio and uncached video through Media3

| Field | Value |
|---|---|
| Area | Android / Media3 engine |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-A02, MC-A03, MC-S09 |
| Unlocks | MC-A05 |

#### Context

Current Media3 items are theme/audio-only and all HTTP uses an authenticated
CacheDataSource. Direct video must neither receive the bearer token nor enter
SimpleCache.

#### Scope

- Add origin-aware DataSource routing for server audio, direct video, and local
  files.
- Refactor PlaybackMediaItems for PlayableItem and ResolvedPlaybackItem.
- Keep MediaItem.mediaId equal to queueId; put playable/mode data in extras.
- Replace/rebuild current and upcoming MediaItems on intent change while
  preserving queue index and occurrence identity.
- Start Full Size/Video at zero and preserve play/pause intent.
- Handle direct-video failure with finite TV fallback.
- Ensure next/previous, notification, Bluetooth, and resumption use actual
  mode metadata.

Expected areas:

- media/AudioCacheProvider.kt
- media/PlaybackMediaItems.kt
- media/MediaControllerManager.kt
- media/MediaPlaybackService.kt
- network media header helpers
- focused Media3/unit tests

#### Acceptance criteria

- Server audio has bearer header and cache.
- AnimeThemes video has neither bearer header nor cache.
- Mode switch keeps queueId/current queue position.
- Video error falls back same entry and retains Video preference.
- RELATED_AUDIO metadata uses release/anime context.
- media notification and external controls identify actual mode when needed.

#### Verification

- Routing/header/cache unit tests.
- Media item replacement and queue-sync tests.
- Failure/fallback test with fake player/controller boundary.
- Full Android unit suite and debug assemble.

#### Handoff notes

Do not solve UI rotation here. Prove source routing and identity before
attaching PlayerView.

### MC-A05 — Build the Now Playing selector and embedded video experience

| Field | Value |
|---|---|
| Area | Android / Compose / Media3 UI |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-A04 |
| Unlocks | MC-A06, MC-Q01 |

#### Context

This implements the approved YouTube Music-style compact selector, actual-mode
highlighting, portrait embedded video, and landscape full-screen controls.

#### Scope

- Add Media3 UI dependency.
- Add top-center segmented pill above media region.
- Bind available modes, preferred intent, actual mode, and fallback status.
- Host PlayerView with AndroidView when actual mode is Video.
- Implement portrait edge-to-edge media region.
- Implement landscape full-screen, hideable controls, system bar behavior, and
  orientation/configuration handling.
- Add content warning confirmation before marked video.
- Keep artwork swipe as queue navigation outside Video interaction.
- Add accessibility labels and non-gesture control access.

Expected areas:

- gradle version catalog/app dependencies
- ui/player/PlayerScreen.kt and PlayerViewModel.kt
- new focused composables
- player Compose tests

#### Acceptance criteria

- Pill is compact/top-centered and selects actual mode.
- Unavailable Video is absent offline/no-link.
- Retained preference appears subtly during fallback.
- Portrait video replaces artwork without leaving Now Playing.
- Landscape video fills screen; controls hide/show and contain approved actions.
- Audio and video never overlap.
- Exit/resume follows PRD D13.

#### Verification

- Compose state tests for availability/fallback.
- Instrumented rotation/control tests where stable.
- Real-device portrait/landscape smoke is required before closing.
- Full Android tests, lint, and debug assemble.

#### Handoff notes

Use the screenshot-inspired interaction, not an oversized full-width tab bar.

### MC-A06 — Add Play Video browse actions and context startup

| Field | Value |
|---|---|
| Area | Android / action sheets and queue startup |
| Difficulty | Medium |
| Effort | M, 2–3 days |
| Depends on | MC-A03, MC-A05 |
| Unlocks | MC-Q01 |

#### Context

Song/theme, anime, and playlist overflow menus may start Video. Full Size has
no equivalent browse action.

#### Scope

- Add conditional Play Video to relevant action sheets.
- Single theme: require current usable video and online state.
- Anime/playlist: require at least one contained usable video.
- Start queue/context with Video preferred and normal fallback.
- Hide action offline.
- Ensure no Play Full Size browse action is introduced.

Expected areas:

- ui/common/ActionSheet.kt
- anime/playlist/theme call sites
- queue startup helpers/ViewModels
- action-sheet tests

#### Acceptance criteria

- All three approved overflow surfaces behave consistently.
- Items without Video fall back but later items retry Video.
- Queue replacement resets prior Video preference according to context rules.
- Offline/no-video menus do not show dead actions.

#### Verification

- Pure menu-availability tests.
- Queue-context startup tests.
- Compose smoke on anime and playlist surfaces.
- Full Android unit suite.

#### Handoff notes

The action starts playback. It must not open a browser.

### MC-A07 — Add Related Music browsing, nested navigation, queue actions, and Search

| Field | Value |
|---|---|
| Area | Android / repository and Compose |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-A01, MC-A02, MC-S09 |
| Unlocks | MC-A11, MC-Q01 |

#### Context

Related releases are anime-owned, globally searchable, and playable as SONG
items. There is no top-level Albums page.

#### Scope

- Add music repository over Room and remote detail/search routes.
- Add Anime Detail preview section.
- Add nested Related Music/release screen.
- Add Now Playing overflow link for owning anime.
- Add release/track result sections to global Search.
- Preserve owning anime context when navigating from Search.
- Add play, Play Next, Add to Queue, Save to Playlist, like, and Download action
  callbacks.
- Hide empty/unready sections.

Expected areas:

- data repository/DAO
- ui/library/AnimeDetail*
- new related-music screen/ViewModel
- ui/search/Search*
- navigation routes
- action sheets

#### Acceptance criteria

- Ready releases appear only under their anime.
- Search finds ready releases/tracks and returns to anime-owned experience.
- Related tracks enter queue as SONG, not ThemeEntity.
- Standard actions use stable song/media identities.
- No top-level album tab/route is added.
- Cached related data remains browsable offline; remote search failure is
  friendly.

#### Verification

- Repository query tests.
- Navigation route tests.
- Compose state/action tests.
- Mixed THEME/SONG queue tests.
- Full Android suite and debug assemble.

#### Handoff notes

Release artwork may be remote and cached by Coil normally; the no-cache rule is
for video.

### MC-A08 — Add playlist default/override policy and mixed item editing

| Field | Value |
|---|---|
| Area | Android / playlists |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-A01, MC-A03, MC-S10 |
| Unlocks | MC-A10, MC-Q01 |

#### Context

Playlist default mainly determines exact download mode, while entry overrides
and temporary playback session changes follow the approved precedence.

#### Scope

- Sync/read/write defaultMode and polymorphic items.
- Update PlaylistDetail and picker flows for THEME/SONG.
- Add Default TV Size/Default Full Size setting.
- Add Inherit playlist default, TV Size, and Full Size choices for THEME adds;
  preselect Inherit.
- Related SONG add has no mode choice.
- Add per-entry override editing without changing item identity/order.
- Ensure playback creates base policies but manual selector remains session
  only.
- Update dynamic/auto playlist local mappings.

Expected areas:

- local playlist entities/DAOs/repository
- ServerPlaylistWriter and pending writes
- PlaylistPickerSheet
- PlaylistDetailScreen/ViewModel
- playlist download resolver integration point

#### Acceptance criteria

- Default and override round-trip across offline pending write and server pull.
- Mixed/duplicate items retain stable entry IDs/order.
- Manual Now Playing switch never writes playlist policy.
- Video cannot be stored.
- Existing theme-only playlists render and play normally.

#### Verification

- Repository/pending-write conflict tests.
- picker and detail Compose tests.
- playlist precedence tests shared with MC-A03.
- Full Android unit suite.

#### Handoff notes

Do not silently rewrite every entry when playlist default changes. Null
overrides inherit dynamically.

### MC-A09 — Implement song reactions, mode-specific dislike, and actual-mode history

| Field | Value |
|---|---|
| Area | Android / user state and player actions |
| Difficulty | Medium |
| Effort | L, 4–5 days |
| Depends on | MC-A01, MC-A03, MC-S11 |
| Unlocks | MC-Q01 |

#### Context

Normal Dislike targets all modes of the current theme song. A subtle secondary
action targets TV or Full only. Related songs have independent reactions.

#### Scope

- Extend local theme preference fields, pending writes, sync mapping, and
  repository methods.
- Add SongPreferenceEntity flows and pending writes.
- Normal dislike sets broad scope.
- Add long-press and accessible overflow alternatives for TV-only/Full-only.
- Record item type and actual mode in pending play events/history.
- Keep like/dislike mutual-exclusion semantics.
- Ensure queue skip logic respects broad and mode-specific flags.

Expected areas:

- local preference/play entities/DAOs
- UserPreferencesRepository and SyncEngine
- PlayerViewModel/PlayerScreen reaction controls
- queue skip/playability resolver
- pending-write tests

#### Acceptance criteria

- Broad action affects TV, Full, and Video for current theme only.
- TV-only leaves Full eligible; Full-only leaves TV eligible.
- Related song dislike does not alter a theme preference.
- Gesture has an accessible non-gesture equivalent.
- Play event records fallback actual mode, not merely preferred mode.

#### Verification

- reaction matrix tests.
- offline pending write/upload/pull tests.
- queue eligibility tests.
- Compose long-press/overflow state tests.
- Full Android suite.

#### Handoff notes

Do not add anime-wide dislike or video-only dislike.

### MC-A10 — Generalize device downloads, exact playlist resolution, and grouping

| Field | Value |
|---|---|
| Area | Android / WorkManager and Downloads UI |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-A01, MC-A03, MC-A08, MC-S03, MC-S09 |
| Unlocks | MC-Q01 |

#### Context

The current download primary key is themeId and cannot hold TV plus Full or
Related songs. The new model must deduplicate one song file across groups while
preserving exact offline policy.

#### Scope

- Replace themeId-only requests with stable MediaKey download items.
- Keep/migrate existing TV files and compatibility reads.
- Resolve Full Size to SONG:{songId}:AUDIO.
- Add album/anime/playlist group membership independent from physical item.
- Update DownloadManager/Worker, retry/pause/remove/Wi-Fi-only flows.
- Preserve original server filename/content type where safe.
- Implement playlist exact-mode resolution and unavailable-offline state.
- Update Downloads UI with anime/theme Full grouping and expandable related
  albums with individual removal.
- Never create Video download/cache entries.

Expected areas:

- data/local download entities/DAOs
- download/DownloadManager.kt, DownloadWorker.kt, DownloadPreferences.kt
- ui/settings/DownloadManager*
- playback resolver local-file lookup
- WorkManager/download tests

#### Acceptance criteria

- TV and Full of one theme have independent availability.
- Same SONG referenced by theme and album stores one physical file.
- Removing one group relationship does not delete a file still referenced by
  another selected group unless user removes the physical item.
- Album groups expand and individual track removal works.
- Playlist Full requirement is unavailable offline with only TV downloaded.
- Existing TV download plays in airplane mode after migration.
- No Video data enters WorkManager or SimpleCache.

#### Verification

- migration and MediaKey dedupe tests.
- Wi-Fi/retry/pause/remove regression tests.
- exact offline playlist matrix.
- WorkManager integration tests where practical.
- real-device airplane-mode acceptance.

#### Handoff notes

The download item owns the physical file; groups are presentation/selection
relationships.

### MC-A11 — Integrate OSTs and liked Related Music into Home

| Field | Value |
|---|---|
| Area | Android / Home and Settings |
| Difficulty | Medium |
| Effort | M, 2–3 days |
| Depends on | MC-A01, MC-A07 |
| Unlocks | MC-Q01 |

#### Context

OSTs may enter Home by default; other Related Music appears only when
specifically liked. The setting is device-local and defaults on.

#### Scope

- Add Show OSTs on Home toggle and Settings ViewModel state.
- Default it to true on fresh install/migration.
- Extend Home repository/ViewModel candidate assembly.
- Include ready OST songs when on.
- Include non-OST Related songs only when liked.
- Keep Full Size as theme mode, not a separate Home recommendation.
- Reuse existing Home/Quick Picks layout without a new top-level music page.

Expected areas:

- settings preference storage
- ui/settings/SettingsScreen/ViewModel
- ui/home/HomeViewModel/Screen
- music repository queries

#### Acceptance criteria

- Fresh/migrated app defaults toggle on.
- Toggle removes/adds OST candidates immediately.
- Non-OST requires specific like.
- Unready and disliked songs are excluded.
- Selecting candidate queues SONG correctly.

#### Verification

- preference default/toggle tests.
- Home filtering matrix.
- Compose setting/Home state smoke.
- Full Android unit suite.

#### Handoff notes

Do not mix all Related Music into existing anime theme bulk Play/Shuffle.

## 8. Cross-system ticket

### MC-Q01 — Run migration, contract, device, and staged catalog acceptance

| Field | Value |
|---|---|
| Area | Server + Android + deployment |
| Difficulty | High |
| Effort | XL, 6–8 days |
| Depends on | MC-S12 and MC-A05 through MC-A11 |
| Unlocks | Production enablement |

#### Context

This feature crosses background acquisition, catalog sync, queue identity,
Media3, direct video, playlists, and device files. Ticket-level green tests are
not enough to enable discovery against a real library.

#### Scope

- Build a curated acceptance set:
  - exact Full Size.
  - missing Full Size.
  - excluded instrumental/live/remix.
  - reused song across themes.
  - multiple AnimeThemes video versions.
  - soundtrack and character-song release.
  - ambiguous multilingual candidate.
- Exercise migration from the current server DB and Android Room schema.
- Test real Lidarr in a dedicated/test root with discovery scheduler disabled.
- Inspect every accepted/rejected evidence record.
- Enable catalog exposure before automatic discovery.
- Run device acceptance checklist from TDR section 14.
- Enable discovery only after the curated set is correct.
- Record results and any intentionally deferred defects.

Expected artifacts:

- Server test results and typecheck.
- Android unit/lint/assemble results.
- Migration evidence.
- Device acceptance report.
- Catalog match review report.
- Updated README/operator enablement steps.

#### Acceptance criteria

- No known false-positive Full Size in curated set.
- No ambiguous/unready item appears to listener.
- All mode/fallback/playlist/download flows match PRD.
- Direct video sends no Anime Ongaku bearer and creates no cache/download.
- Existing TV Size stream and old device download still work.
- Provider outage leaves ready/server/device audio functional.
- Catalog/discovery switches provide a tested rollback.

#### Verification commands

From server:

~~~powershell
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\vitest\vitest.mjs' run
& 'E:\Users\Nolan\npm\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit
~~~

From src with the documented JDK/SDK environment:

~~~powershell
.\gradlew.bat --no-daemon test
.\gradlew.bat --no-daemon lint
.\gradlew.bat --no-daemon assembleDebug
~~~

Run real-device checks on the currently configured test server. Do not clear
the app or delete old downloads before proving the migration/compatibility path.

#### Handoff notes

If a curated match is wrong, fix matcher evidence/thresholds and rerun the set.
Do not manually seed the catalog to hide a discovery defect.

## 9. Effort summary

| Workstream | Tickets | Experienced effort |
|---|---:|---:|
| Server catalog/provider/API | 12 | approximately 50–65 days |
| Android data/playback/UI/downloads | 11 | approximately 55–75 days |
| Integrated acceptance and enablement | 1 | approximately 6–8 days |
| Total sequential | 24 | approximately 111–148 focused days |

The total is not a calendar estimate. With two contributors and the dependency
waves above, practical elapsed time can be materially shorter. The high effort
comes from the real queue/playback/download migrations and acquisition
correctness, not production-scale hardening.

## 10. Initiative completion criteria

The initiative is complete only when:

- Automatic discovery can make a confident Full Size or Related release ready
  without listener intervention.
- Android can play and switch every available current-theme mode.
- Related tracks are browseable, searchable, queueable, playlistable, liked,
  and downloadable under their anime.
- Playlist defaults/overrides resolve identically for streaming and device
  download policy.
- Offline playback requires and uses the exact resolved media key.
- Video is direct, embedded, uncached, unavailable offline, and free of bearer
  leakage.
- Existing TV Size behavior and files remain valid.
- Operator setup, diagnostics, retry, cache removal, and rollback are
  documented and tested.
