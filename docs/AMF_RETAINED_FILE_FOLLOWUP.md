# AMF retained-file recovery follow-up

This is a separate AnimeMusicFetcher fix. The Ongaku sync recovery change does
not modify AMF or relax delivery validation.

## Verified production failure

On 2026-10-21, the existing Hanaori request's AMF job
`cc989a58-26d6-4fac-a748-5f2178a6ded7` exposed five source-file records and was
waiting for file selection. Full-length OP and ED records could be distinguished
from the TV edits and instrumental by their filenames, embedded title/artist,
and durations. Selecting those two records through `/files/select` persisted
the correct `operator_file_selections` and briefly returned `processing`.

Processing then returned to `awaiting_file_selection`, with an empty source
manifest and the warning `no extracted audio files were found`. Both original
torrent content paths were absent, both torrent hashes were absent from
qBittorrent, and no matching FLAC was found under AMF's downloads or library
mounts. The processing workspace was empty. The original download records still
reported completion from August.

The deployed `BeetsProcessor.process` deletes the existing job workspace before
rebuilding source files from the original download paths. It does not first
prove those paths are available. Missing source paths yield no extracted files;
the worker replaces the source manifest with an empty result and asks for file
selection again. The existing file records alone did not prove that their
staged bytes were still present before this attempt, so prior byte availability
must not be inferred from the old manifest.

## Required AMF fix and regression

Validate readable source inputs before replacing a retained workspace. Build a
replacement workspace separately and preserve the previous workspace and
manifest when rebuilding fails. For an operator reviewing retained files,
consume validated retained staged files when the original download is gone;
preserve selection keys, CUE segments, per-item metadata, and version checks.
Missing bytes should produce an explicit recoverable missing-source reason,
rather than an empty file picker.

Regression: process a download into retained source files, remove the original
download, and submit a valid operator selection. The retained full vocal track
must import with the same job/item attribution. If retained bytes are also
missing, the operation must preserve existing evidence, explain what is missing,
and permit reacquisition without creating a new Ongaku request. Cover TV edits,
instrumentals, CUE files, and a failed replacement attempt that must not destroy
usable staged bytes.

## Safe recovery using the existing deployed API

Back up AMF state before mutation and preserve the existing job ID and Ongaku
batch. A SQLite backup preserves state and manifests; it does not back up audio.

For `awaiting_file_selection` with missing original data, use
`POST /api/v1/jobs/{job_id}/research?selection_mode=review` without a body. The
deployed endpoint accepts this state, retains the request identity/destination,
and pauses the fresh search for review. Wait for `awaiting_selection`, verify
fresh candidate identity and coverage, then use the supported `/select`
operator flow. Candidate indexes must be checked again after a fresh search.
Verify downloaded source bytes, file assignments, delivery, and Ongaku import.

The deployed `/stop-download` route rejects `awaiting_file_selection`, even
though the worker's internal stop method accepts it. Do not assume the public
route inherits the worker's allowed states. `/discard-and-redownload` accepts
this state but starts an automatic search; use the review flow when the new
release choice must be checked. Avoid cancel-then-select: Ongaku can observe
the temporary cancelled state and terminate its batch before reselection.

Never mark `found` results delivered, approve a TV edit or instrumental as the
full vocal track, or create a duplicate acquisition to bypass the missing data.
