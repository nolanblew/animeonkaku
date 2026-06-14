# Spike 06 — Priority Download/Job Queue Design

Requirement: a *not-too-complex* queue where slow background work (binary backfill, metadata maintenance) yields to on-demand requests (someone presses play on a track we don't have yet).

## Model

DB-backed queue (`jobs` table, doc 05) + one async worker loop in the Node process. DB-backed because: survives restarts, inspectable with SQL, no extra infra. Single worker because: total upstream budget is tiny (90 req/min AnimeThemes) and one-at-a-time is itself a politeness feature.

### Priorities
| Value | Name | Used for |
|---|---|---|
| 0 | URGENT | on-demand audio (user pressed play, file missing) |
| 10 | HIGH | user-initiated: manual sync, explicit offline-download request, manual add |
| 20 | NORMAL | scheduled per-user delta syncs, post-sync mapping |
| 30 | MAINTENANCE | audio/image backfill, reconciliation scans |

### Job types
| Type | Payload | Work |
|---|---|---|
| `KITSU_FULL_SYNC` / `KITSU_DELTA_SYNC` | `{userId, full}` | port of `SyncManager.doSync` phases 1–3 (Kitsu fetch, status delta, genre backfill) then enqueues `MAP_THEMES` |
| `MAP_THEMES` | `{kitsuIds:[…]}` | AnimeThemes batch mapping + MAL fallback + title fallback (port of phases 4–7); writes catalog; enqueues `BACKFILL_SCAN` |
| `FETCH_AUDIO` | `{themeId}` | download `audio_origin_url` → media store (tmp + atomic move + sha256), update `media_files` |
| `FETCH_IMAGE` | `{kind, refId}` | same for posters/covers/artist images |
| `BACKFILL_SCAN` | `{userId?}` | diff: themes referenced by any library vs `media_files.state=READY` → enqueue missing as MAINTENANCE `FETCH_AUDIO` (dedupe_key prevents duplicates) |
| `AUTO_PLAYLIST_REFRESH` | `{userId}` | recompute Kitsu Library / Currently Watching / Liked Songs rows |

`dedupe_key` (`'{type}:{refId}'`) is UNIQUE → enqueuing an existing queued/running job is a no-op, **except** a higher-priority enqueue *updates* the existing row's priority (this is the "bump to top" mechanic):

```sql
INSERT INTO jobs (type, priority, payload, dedupe_key)
VALUES ('FETCH_AUDIO', 0, '{"themeId":4567}', 'FETCH_AUDIO:4567')
ON CONFLICT (dedupe_key) DO UPDATE
  SET priority = LEAST(jobs.priority, EXCLUDED.priority),
      next_run_at = LEAST(jobs.next_run_at, now())
  WHERE jobs.state IN ('QUEUED','FAILED');
```

## Worker loop

```
loop:
  job = SELECT * FROM jobs
        WHERE state='QUEUED' AND next_run_at <= now()
        ORDER BY priority, next_run_at, id
        LIMIT 1 FOR UPDATE SKIP LOCKED      -- safe even if we later add workers
  if none: delay(1s); continue
  mark RUNNING; run with per-type timeout; mark DONE
  on failure: attempts++; if attempts >= max_attempts → FAILED (kept for admin retry)
              else → QUEUED, next_run_at = now() + backoff(attempts)
```

- `backoff(n) = min(2^n * 30s, 30min) + jitter(0..30s)`.
- Per-type timeouts: FETCH_AUDIO 5 min; syncs 30 min; others 2 min.
- Crash recovery: on boot, `UPDATE jobs SET state='QUEUED' WHERE state='RUNNING'` (jobs are idempotent: media fetch re-checks file, sync re-runs safely).

### Preemption ("pause background work when an on-demand request arrives")

Granularity = one job. Audio files are 3–12 MB, so the longest a URGENT job waits is one in-flight transfer (seconds). Two mechanisms, both cheap:

1. The worker re-queries by priority after every job — an URGENT row naturally jumps the line.
2. Inside long jobs (`MAP_THEMES`, syncs, `BACKFILL_SCAN`), between batches the job calls `checkpoint()`: if an URGENT job is queued, the current job re-enqueues itself with its remaining cursor in `payload` and yields. (Mirrors `SyncManager.checkPause()`.)

No thread interruption, no partial-file cancellation — deliberately simple.

### Rate limiting (politeness)

Per-host token buckets owned by the upstream HTTP clients (not the queue):
| Host | Budget |
|---|---|
| `api.animethemes.moe` | 60 req/min (limit is 90; headroom for other consumers), honor `Retry-After`/429 by sleeping the bucket |
| `a.animethemes.moe` / `i.animethemes.moe` | 1 concurrent transfer + `AUDIO_BACKFILL_DELAY_SECONDS` (default 8 s) spacing **for MAINTENANCE jobs only**; URGENT/HIGH skip the spacing (still 1 concurrent) |
| `kitsu.io` | ≤2 req/s |

Backfill math: 8 s spacing ≈ 450 tracks/hour ⇒ a 2,000-track library drains in ~4.5 h of queue time, spread harmlessly.

### Circuit breaker

Per host: 5 consecutive failures → open for 10 min (all jobs for that host get `next_run_at += 10min`, state stays QUEUED); half-open single probe after cool-down. Prevents hammering a down origin and burning `attempts` on outages. `media_files.state=FAILED` only after `max_attempts` of the *job*, and a weekly scan re-queues FAILED media once (in case origin URLs healed or changed after AnimeThemes re-encodes).

### Failure surfaces
- `GET /v1/jobs?status=failed` + `POST /v1/jobs/{id}/retry` for the operator.
- `library` feed exposes per-theme `audioState` so clients can show "not yet on server" instead of failing silently.
- Sync job stores progress JSON on its row → `GET /v1/sync/status` streams the same phase/progress UX the Android Import screen shows today.
