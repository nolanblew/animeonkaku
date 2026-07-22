CREATE TEMP TABLE release_track_album_order ON COMMIT DROP AS
  SELECT
    id,
    row_number() OVER (
      PARTITION BY release_id
      ORDER BY disc_number, track_number NULLS LAST, display_order, id
    ) - 1 AS canonical_display_order
  FROM release_tracks;
--> statement-breakpoint
UPDATE release_tracks SET display_order = -id;
--> statement-breakpoint
UPDATE release_tracks AS tracks
SET display_order = ordered.canonical_display_order
FROM release_track_album_order AS ordered
WHERE tracks.id = ordered.id;
