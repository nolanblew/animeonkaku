ALTER TABLE anime_music_request_batches ADD COLUMN poll_backoff_step integer NOT NULL DEFAULT 0;
ALTER TABLE anime_music_request_batches ADD COLUMN poll_not_before timestamp with time zone;
