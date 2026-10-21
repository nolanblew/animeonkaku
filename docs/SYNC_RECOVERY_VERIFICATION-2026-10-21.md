# Sync recovery verification — 2026-10-21

## Baseline and scope

Work started from `origin/main` at `e226043` on `codex/kitsu-sync-recovery` in a separate worktree. The original checkout's unrelated work was preserved. Production already contained the playlist music-search exclusion migration (0029) and LAN resolver configuration; those prerequisites are included so deploying from current main does not remove existing behavior. The deployed 0029 migration hash matched the source exactly.

The reported account's last successful Kitsu import was October 2. Repeated library import attempts failed when an aggregate mapping dedupe key exceeded PostgreSQL's btree index-entry size. Kitsu rows could already have been written without durable playlist or music follow-ups.

Affected examples:

| Anime | Kitsu | AnimeThemes | Before recovery |
| --- | --- | --- | --- |
| Hanaori-san wa Tensei Shite mo Kenka ga Shitai | 50179 | 4920 | Watching status imported; theme song identities missing; absent from playlist 7; existing provider request awaiting file selection |
| The Cold Sato-san is Only Sweet to Me | 51012 | 4995 | Watching status imported; catalog unmatched; absent from playlist 7; no music request |

Playlist 7, `6 Months & Liked`, is dynamic, automatically updated, and eligible for music search. Playlist 20 remains excluded. Global search mode is `PLAYLISTS`.

## Backup and restore proof

Protected backup directory on the deployment host: `/home/nolan/docker-data/anime-ongaku-server/backups/sync-recovery-20261021-final`.

- PostgreSQL custom dump SHA-256: `0308f4fd8b85ca1f8295770b35fbbf53791b0e2606119482a0554ab49fe53634`.
- Restore listing: 270 lines. Actual restore into an isolated PostgreSQL 16 database succeeded: 2 users, 8,927 themes, 8 playlists.
- Previous deployed source archive SHA-256: `f7e225867d27d0a11e3e9ee865a1763b92cf59386ca4b52c60263420a5da4938`. Compose files and private environment were preserved separately with restrictive permissions.
- Previous application image preserved as `animeongaku-server:pre-sync-recovery-20261021`, image ID `sha256:4e44ccb4c39f29625d1bbe6c393e25b79ec635938695404bc7c8811974cfb196`.
- AMF SQLite backup used the native connection backup API and passed `PRAGMA integrity_check`: `/config/backups/sync-recovery-20261021-final.sqlite3` in AMF. Size 26,267,648 bytes; SHA-256 `37f405f5048cd81239bed8606799f1d6294c7ee51349090beb2069827a0e3d82`.
- Migration 0030 was applied successfully to an independently restored production database before deployment. It adds nullable `kitsu_anime.catalog_checked_at`.

Rollback must account for new `MUSIC_POLICY_SYNC` jobs before running an older application. The additive column can remain; restoring the entire database would discard newer user activity and is not the default rollback procedure. Provider state and delivered files require separate consideration.

## Review

The orchestrator reviewed transaction boundaries, dedupe conflict handling, retry preservation, running-job replay, scheduler upgrades, music eligibility and request idempotency, authenticated stage retry scope, and Android's legacy sync response contract. An independent final review caught mixed failed/pending stage polling stopping prematurely; that issue was fixed with a regression test before deployment.
