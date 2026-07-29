ALTER TABLE songs
  ADD COLUMN title_english text,
  ADD COLUMN title_romaji text,
  ADD COLUMN title_japanese text,
  ADD COLUMN artist_names jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE music_releases
  ADD COLUMN title_english text,
  ADD COLUMN title_romaji text,
  ADD COLUMN title_japanese text,
  ADD COLUMN artist_names jsonb NOT NULL DEFAULT '[]'::jsonb;
