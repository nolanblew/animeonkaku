ALTER TABLE media_files
  ADD COLUMN IF NOT EXISTS loudness_state text,
  ADD COLUMN IF NOT EXISTS loudness_sha256 text,
  ADD COLUMN IF NOT EXISTS integrated_lufs double precision,
  ADD COLUMN IF NOT EXISTS true_peak_dbtp double precision,
  ADD COLUMN IF NOT EXISTS loudness_range_lu double precision,
  ADD COLUMN IF NOT EXISTS loudness_gain_db double precision,
  ADD COLUMN IF NOT EXISTS loudness_policy_version integer,
  ADD COLUMN IF NOT EXISTS loudness_error text,
  ADD COLUMN IF NOT EXISTS loudness_analyzed_at timestamptz;

CREATE INDEX IF NOT EXISTS media_files_audio_loudness_backfill_idx
  ON media_files (state, kind, loudness_state)
  WHERE kind = 'AUDIO' AND state = 'READY';
