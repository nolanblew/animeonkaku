ALTER TABLE "library_entries" ADD COLUMN "watched_at" timestamp with time zone;
--> statement-breakpoint
-- Re-read every Kitsu entry on the next sync to populate viewing dates and all statuses.
-- Do not backfill from library_updated_at: a library edit is not viewing activity.
UPDATE "users" SET "last_status_sync_at" = NULL;
