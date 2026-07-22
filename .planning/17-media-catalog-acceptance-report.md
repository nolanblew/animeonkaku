# Media catalog acceptance report

Date: 2026-07-22
Branch: `feature/media-catalog-initiative`

## MC-Q01R — AMF controller and staging

- Deployed state: `MUSIC_CATALOG_ENABLED=true` and
  `MUSIC_DISCOVERY_ENABLED=false`. Both Docker Compose projects are healthy.
- Mount contract: AMF owns `/library` read-write; Anime Ongaku mounts the same
  host library at `/mnt/amf-library` read-only. Anime Ongaku alone owns
  `/data/media` read-write. AMF config and downloads remain separate mounts.
- Live request `7dc3570c-a628-4ed1-97f4-1449f09bc908` for Kitsu `48649`
  completed with warnings. Eight requested artifact groups yielded 31 READY
  deliveries: three exact Full Size songs and 28 soundtrack tracks. Four
  unsupported/not-found groups remained operator-visible and were not seeded.
- Every delivery's observed byte count and hash matched the verified values.
  Canonical files exist under `audio/songs/{id}/original.flac`; staging remains
  under the request/batch-scoped AMF path. Listener projection exposes only
  READY records.
- Live restart/outage proof: before and after stopping AMF and restarting the
  API, database counts remained `1 request / 1 batch / 31 deliveries / 33
  songs / 1918 READY media rows`; all 31 canonical request files remained.
  Anime Ongaku `/healthz` stayed 200 while AMF was stopped, and both services
  returned healthy after restart.
- Debug-device proof: an unrequested anime displayed `Request music`; the
  attention request displayed `Some music is ready` with Full and Related
  content on the same screen. The action is gated in both Compose and the
  ViewModel, and release Kotlin compilation passed.
- Automated contracts cover deterministic `<=12` batching, replay/double-tap
  protection, restart recovery, ambiguity, outage handling, reprocessing, and
  PostgreSQL concurrency. The live request was not re-submitted merely to
  repeat large downloads.
- Server gate: 52 test files passed, 10 environment-gated files skipped; 444
  tests passed, 21 skipped. TypeScript `--noEmit` passed.
- Independent review: Sol/Medium PASS. Independent QA: Terra/High PASS after
  the request terminal-state catalog refresh was added and verified 9/9.

## MC-Q01 — integrated Android and rollout acceptance

- The Pixel 7 Pro was upgraded in place from Room schema 22 to 23; app data was
  not cleared. The debug request action appeared only for an unrequested anime,
  and a completed request refreshed into Full Size and Related Music without a
  reinstall or manual catalog seed.
- Home All included eligible OST rows; OP and ED filters excluded Related Music
  and selected only their respective theme types. A soundtrack row played as a
  Related song in Now Playing.
- TV Size and Full Size both played. Direct Video rendered frames through the
  shared Media3 controller in portrait and landscape, exposed labeled controls,
  and produced no playback exception. Device orientation settings were restored.
- Acceptance exposed a real Full-only download defect because song IDs 1–3 were
  represented in `theme_modes` but not the `songs` projection. Enqueue and worker
  resolution now fall back to the canonical Full URL from the theme mode while
  preferring a normal song row when present. The final worker succeeded and
  created `files/downloads/songs/1/original.flac`.
- With Wi-Fi and mobile data disabled and DNS resolution unavailable, the newly
  downloaded 2:59 Full Size track played locally after an app restart. Network,
  orientation, and system settings were restored afterward.
- Server verification passed: 52 test files passed and 10 environment-gated
  files skipped; 444 tests passed and 21 skipped. TypeScript typecheck passed.
- Android verification passed: 503/503 unit tests across 78 suites, lint, debug
  APK assembly, release Kotlin compilation, and Android-test Kotlin compilation.
  Sol/Medium review and Terra/High QA passed with no remaining blocker.
- Intentionally unobserved live: the device had no pre-existing legacy TV file
  before upgrade, so physical old-file preservation could not be demonstrated.
  In-place database migration was demonstrated and legacy compatibility remains
  automated. Large-batch/replay/ambiguity/reprocess behavior was covered by the
  server test suite rather than triggering another costly live download.
- Final rollout state is deliberately conservative: catalog exposure is on,
  automatic discovery is off, and both Compose stacks are healthy.
