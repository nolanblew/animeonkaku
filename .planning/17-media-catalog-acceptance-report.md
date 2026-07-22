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

