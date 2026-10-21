# Library sync and recovery

Kitsu library freshness and music availability are separate outcomes. A successful import commits the Kitsu library rows, removal tombstones, sync watermark, and downstream job requests in one database transaction. Catalog, playlist, or music failures after that commit do not roll back the import.

## Stages and triggers

| Stage | Durable work | Trigger and recovery |
| --- | --- | --- |
| Kitsu library import | `KITSU_FULL_SYNC`, `KITSU_DELTA_SYNC` | Login/manual sync, server startup, and periodic reconciliation. The default `SYNC_INTERVAL_MINUTES` is 10. Periodic full reads reconcile removals while avoiding unchanged catalog work. Explicit Re-sync all requests fresh catalog checks. |
| Theme catalog matching | Per-anime `MAP_THEMES` | Import commits catalog work for individual anime. Fetches category metadata and matches AnimeThemes; each anime retries separately. Mapping keys hash their identifiers so large libraries cannot exceed PostgreSQL's btree index-entry limit. |
| Automatic playlists | `AUTO_PLAYLIST_REFRESH` | Requested by imported changes/removals and committed catalog results. Refreshes auto and dynamic playlists independently, then requests music eligibility work. Daily maintenance also refreshes auto playlists. |
| Music search eligibility | `MUSIC_POLICY_SYNC`, user-scoped `RECONCILE_MUSIC_SEARCH_POLICY` | Playlist completion schedules policy scanning. The scan plans eligible anime and durable per-anime reconciliation. A successful queue request does not mean music is downloaded. |
| Music acquisition | Existing discovery, provider, import, and request records | Music requests remains the source for discovery, acquisition, missing song metadata, exclusions, and operator review. Sync-stage retry does not submit or approve downloads awaiting review. Feature flags and the existing search policy still apply. |

Weekly maintenance requests a full catalog refresh and retries failed theme media. Missing or unmatched catalog data is checked again on a later reconciliation after its catalog check ages out (24 hours), or through Re-sync all. Completed/cancelled job history is retained for 30 days by default; status is a view of retained work, not an audit log.

## Status and client compatibility

`GET /v1/sync/status` requires the user's bearer session. It adds `libraryState`, `libraryLastCompletedAt`, and `stages` (`library`, `catalog`, `playlists`, `musicPolicy`). Each stage reports state counts, last update/completion, next automatic retry, the latest relevant error, failed job IDs, and unmatched/missing song metadata attention counts. The library stage describes the current import, so a retained old failure cannot poison a later success. Queries are scoped to the authenticated user and separately bounded to 10,000 jobs per stage; `truncated` indicates that bound was reached. They do not include other users' work or unscoped global scans. The music stage's completed label means checks were queued or completed; Music requests carries acquisition outcomes and operator decisions.

`libraryLastCompletedAt` is the persisted Kitsu import watermark and remains available while the next import runs. It does not claim that catalog or music processing has finished. The web Sync page shows independent background progress and opens the library when import finishes, while continuing to poll active background stages.

New imports mark their progress with `independentlyRetryableStages`. For those imports, the legacy top-level `state`/`phase` describe library import and `mapping`/`upstreamBlocked` do not turn a downstream catalog failure into a fatal import failure. This lets existing Android clients finish their initial library pull. The actual catalog errors remain visible in `stages.catalog`. Historical unmarked jobs retain their prior response semantics until a new import runs. A skipped import requiring Kitsu reauthentication is not a successful new library import.

## Recovery actions

1. Read authenticated `/v1/sync/status` and the affected Music requests entries. Check the import watermark first, then identify the failed or retrying stage. A current Kitsu import with failed catalog work still contains the latest watching status and removals.
2. Queued jobs retain their attempts, error and retry schedule when reconciliation requests the same work again. Transient failures use exponential backoff, capped at 30 minutes plus jitter. Server restart recovers running jobs to the queue. Repeated requests during a running dependent stage preserve one follow-up run so new changes are not lost.
3. To retry terminal failures, use the stage's Retry button or authenticated `POST /v1/sync/stages/{stage}/retry` with an empty JSON object. Only failed jobs for that user's allowlisted stage are retried. Running and queued work retain their schedule; provider submissions and operator review are outside this endpoint. Replacement per-anime intents supersede old queued/failed mapping jobs only when they cover every original anime ID, preventing obsolete aggregate failures from reappearing as current work.
4. Use Sync now for a Kitsu delta import, or confirm Re-sync all for a complete Kitsu read and fresh catalog requests. Reauthentication-required results require reconnecting the Kitsu account. Missing upstream metadata is an attention condition rather than proof of a failed import.
5. For an AnimeThemes block or unavailable music provider, inspect the error and configured service/network path before retrying. Re-running Kitsu import is unnecessary to recover a catalog or music stage that already has durable work.

## Deployment, backup and verification

Before applying the database migration, take a PostgreSQL custom-format dump (`pg_dump -Fc`) and preserve the current application revision/image, Compose configuration and private environment file in the deployment's protected backup directory. Check that the dump is readable with `pg_restore --list`; do not put tokens or environment contents in issue/PR artifacts. Back up managed media as required by the existing deployment procedure. The new catalog-check column and job types are additive; restoring an older application alone does not undo database or provider changes.

Run server typechecking, API/sync/job/music tests and the PostgreSQL migration/integration tests against an isolated test database. Build/typecheck the web app and run its Sync page tests. Use `scripts/deploy-server.ps1` with the existing deployment target and environment configuration, then verify `/healthz`, authenticated sync status, import watermark, changed Kitsu status/removals, automatic playlists and representative music-request outcomes. A health check alone does not establish that sync recovered. Retain the backup and capture unresolved upstream blocks or items awaiting review alongside the deployed revision.
