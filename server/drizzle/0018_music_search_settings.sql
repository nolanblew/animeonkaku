CREATE TABLE IF NOT EXISTS "music_search_settings" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"mode" text DEFAULT 'MANUAL' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "music_search_settings_singleton_check" CHECK ("singleton_id" = 1),
	CONSTRAINT "music_search_settings_mode_check" CHECK ("mode" IN ('MANUAL','FAVORITES','PLAYLISTS','EVERYTHING'))
);
--> statement-breakpoint
INSERT INTO "music_search_settings" ("singleton_id","mode") VALUES (1,'MANUAL') ON CONFLICT ("singleton_id") DO NOTHING;
