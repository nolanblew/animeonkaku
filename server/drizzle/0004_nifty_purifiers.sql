ALTER TABLE "playlists" ADD COLUMN "dynamic_sort_json" text;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "is_dynamic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "dynamic_auto_update" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "dynamic_spec_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "theme_prefs" ADD COLUMN "liked_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "theme_prefs" ADD COLUMN "deleted_at" timestamp with time zone;