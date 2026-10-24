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

## Automated validation

- Final full server validation: **98 files, 833 tests passed**, with the isolated PostgreSQL database and `ANIMETHEMES_LIVE_TEST=1`; no skipped tests. The stable-code run took 327.03 seconds.
- Web: **71 files, 400 tests passed**. Existing jsdom media/scroll unimplemented warnings did not fail tests.
- Server and web TypeScript checks and production builds passed. `git diff --check` passed.
- GitHub Actions run [39656837159](https://github.com/nolanblew/animeonkaku/actions/runs/39656837159) passed server/web validation, Android debug APK build, and Android debug unit tests at commit `2f5f40d`. The subsequent commit only records final verification evidence.
- PostgreSQL tests cover a 665-entry library, atomic import/outbox rollback, independent catalog failures, retained retry backoff, restart recovery, running-job replay, full/delta upgrades, removal-driven playlist updates, missing song metadata recovery, and provider-request idempotency.
- An old integration test was updated to execute the real persisted job queue rather than assume inline playlist/materializer calls. Catalog change-cursor tests now use the database clock; the remote test database was about 24 seconds behind the Windows test runner.

The first implementation deployment used `9a55efe78e8415d375ddaea213527ffd68f468e5`. Live verification found one legacy aggregate failure containing a removed anime. Commit `be1c319a86d6805551058745b7bd44e1b05874a6` fixed that case; its 22 affected sync tests (including 12 PostgreSQL durability tests) passed. Final application commit `b03756c` also moves lightweight music eligibility scans and request preparation to HIGH priority. Its 20 focused tests passed, including a real HIGH-only worker persisting a request and batch while 665 NORMAL catalog jobs remain queued. Provider submission remains NORMAL. Later evidence-only commits do not change the deployed application.

## Production verification

Final image: `sha256:6999c46dfeab3529e8acd52b3297b6020eabac7c9e3a6403db4105617e227bc2`, started at 18:49:33 UTC. The public HTTPS health endpoint, host LAN endpoint, and container health check passed. Persistent media, read-only AMF library, and resolver mounts match the prior deployment. Migration 0030 is present.

The deployment script's original loopback probe (`127.0.0.1:48668`) returned an empty reply on this host even while the LAN/public/container checks passed. Its first invocation therefore reported a health timeout after successfully replacing the container. The follow-up deployment skipped that loopback probe and used the independently verified LAN/public/container checks; no network settings were changed.

Additional protected PostgreSQL dumps in the same backup directory are `before-legacy-recovery.dump` (SHA-256 `520dc6f39a399a6b050d6978547bbff52eef6bc5fb7daf9c4644e30ebc4a5b86`) and `before-policy-priority.dump` (SHA-256 `17c750c9d3e1d28850ea4bb2f474f6a19411d20a7e707ecc44749ee1a09d46b8`). Both passed restore-list validation; the latter preserves the recovered song/request state before the final application update.

- Startup imported the current 664-entry Kitsu library and advanced the persisted watermark to October 21. The previous library had included an anime since removed from Kitsu.
- The real ten-minute Kitsu timer completed at 18:46:14 UTC with `reconcileOnly: true` and zero changed entries, without manual triggering. After the final deployment, the previously backlogged global music scan automatically upgraded to HIGH and completed at 18:49:35 UTC; startup Kitsu reconciliation completed at 18:49:43 UTC. The final version's next ten-minute Kitsu cycle completed successfully at 18:59:49 UTC.
- The final version's real 15-minute music-policy timer completed at 19:04:35 UTC at HIGH priority, with zero retry attempts. No manual invocation or cadence change was used for either periodic-cycle check. At 19:04:51 UTC, both reported anime still had exactly one request each, playlist and music-policy follow-ups were DONE, and the public health check passed.
- Both reported anime are `current` and `MAPPED`. Hanaori has song IDs 14497/14498; Sato has 14690/14691. Themes 14599, 14600, 14800, and 14801 are all materialized in playlist 7 and visible in the signed-in web app.
- The UI's Re-sync all action completed a full import at 18:37:30 UTC. Legacy failed aggregate job 507115 was retired after atomic replacements for every still-active requested anime were committed; removed anime 50580 no longer prevents supersession. The user's failed catalog job count became zero.
- The initial catch-up generated hundreds of per-anime catalog jobs. The two reported anime and their existing request/submission/poll/import jobs were temporarily prioritized for verification using the normal deduped queue. No request rows were fabricated and no media was marked delivered manually.
- Sato received a new `AUTOMATIC` full-song request `e82e2c3a-a4f0-48f6-94fa-0fb22b3fee7d` from the playlist follow-up. Its root provider job is `42de0f61-8bd0-4c29-8a66-6e4f94975530`; the ED uses child `c51b84cc-3f1d-40e0-9e73-3e88d26445c8`. The OP was automatically delivered. The ED's Japanese title and artist matched the requested song, but the provider's title matching required operator review; the full vocal file was selected after comparing its metadata and duration against TV/instrumental alternatives.
- Hanaori retained request `4f054c17-0e0c-4405-8092-cb358f3dff8b` and provider job `cc989a58-26d6-4fac-a748-5f2178a6ded7`. Missing original downloads required fresh search/reselection within that job. Both full vocal files were reacquired and delivered; the existing request identity was preserved.
- Before final file selection, actual staged and original audio bytes were checked and separate audio archives were made in AMF's `/config/backups`: `sync-recovery-20261021-hanaori-audio.tar` (239,360,000 bytes) and `sync-recovery-20261021-sato-ed-audio.tar` (401,541,120 bytes).
- All four request items are `delivered` / `READY`, with no import errors. Both batches are `COMPLETED_WITH_WARNINGS`; provider warnings do not indicate missing imported audio. The signed-in playlist shows all four songs with Full size availability. Actual canonical FLAC sizes match the media database: Hanaori OP 50,249,479 bytes (song 39978), ED 82,552,595 bytes (39995); Sato OP 45,287,828 bytes (39977), ED 87,192,521 bytes (40194).
- All four provider-delivered files also exist through Ongaku's read-only `/mnt/amf-library/anime-ongaku-staging` mount, with sizes matching the AMF manifests and canonical copies. After restart and repeated policy checks, there remains exactly one Ongaku request for each reported anime.

The separate AMF retained-workspace preservation bug is documented in [AMF_RETAINED_FILE_FOLLOWUP.md](AMF_RETAINED_FILE_FOLLOWUP.md). At the user's direction, this PR does not modify or deploy AMF code.

The wider catalog catch-up continues independently: at 19:04:51 UTC, the reported user's retained catalog jobs included 580 DONE, 140 QUEUED, one RUNNING, two superseded CANCELLED, and none FAILED. Some upstream entries have no matching metadata. A separate policy job for Kitsu 50040, `Smoking Behind the Supermarket With You`, reports a retryable preparation error because its catalog contains two unnumbered OP and two unnumbered ED entries; the existing request builder refuses ambiguous full-song assignments. This did not block either reported anime or other policy jobs. Their completion does not imply that every upstream catalog entry or provider review is resolved.
