ALTER TABLE anime_music_requests
  ADD COLUMN scope text DEFAULT 'LEGACY_ALL' NOT NULL;
--> statement-breakpoint
UPDATE anime_music_requests
   SET scope = CASE WHEN source = 'ADMIN_REIMPORT' THEN 'FULL_SONGS' ELSE 'LEGACY_ALL' END;
--> statement-breakpoint
DROP INDEX anime_music_requests_one_active_anime_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX anime_music_requests_one_active_scope_unique
  ON anime_music_requests (animethemes_anime_id, scope)
  WHERE completed_at IS NULL;
