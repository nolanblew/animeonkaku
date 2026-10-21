# Automatic music recovery

Automatic music policy scans run on startup and every 15 minutes. Playlist
completion also schedules a scan through the durable library sync stages. A
policy mode change or an import completing during a running scan records a
durable replay, so a queue deduplication collision cannot lose the new work.

The scan creates a separate `RECONCILE_MUSIC_SEARCH_POLICY` job for each eligible
user and Kitsu anime. Each job rechecks the current mode, playlist exclusion,
and membership before creating or replaying a full-song request. One anime's
failure does not block the other anime. Failures keep their attempt count,
`last_error`, and `next_run_at` when periodic scans encounter them again.
Automatic recovery uses the queue's exponential backoff capped at 30 minutes
and a large retry budget, rather than requiring a manual retry after five
failures. An enqueue failure fails the scan after the other anime have been
offered to the queue, preserving a durable reason for retry.

Request persistence and provider submission remain separate. If a request was
persisted before enqueueing its provider batch failed, the targeted policy job
may replay that active request. Request identity and the provider idempotency
key stay the same. Already-requested completed themes do not become new
acquisitions merely because a delayed policy job runs. Shared acquisition
locking continues to serialize requests when multiple users qualify.

`MUSIC_POLICY_SYNC` completion means the automatic policy check persisted its
eligible anime's request preparation jobs.
It does not mean audio has downloaded. Per-anime policy jobs expose preparation
failures through the durable job queue. Music requests expose provider progress,
import failures, and operator review.

## Metadata and review boundaries

Automatic eligibility continues to require mapped anime, an eligible opening or
ending, and the upstream AnimeThemes song identity. Metadata recovery should
refresh that identity before playlist reconciliation and music policy checks;
missing identity is not permission to bypass validity checks.

Provider results such as `found` or `awaiting_file_selection` are not delivered
audio. The existing incomplete-request sweep rechecks those requests after an
operator resolves the provider selection. Recovery must not mark those items
delivered or create a second acquisition to bypass the review state.

For retained downloads, inspect source filenames, embedded title and artist,
duration, and alternate versions before assigning files through the provider's
operator API. A full vocal track must not be confused with its TV edit or
instrumental. Back up provider state before any operator mutation, preserve
the current request/provider job identity, and verify the subsequent delivery
and canonical media import.
