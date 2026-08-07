CREATE TABLE IF NOT EXISTS anime_music_request_batch_jobs (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"amf_job_id" text NOT NULL,
	"role" text DEFAULT 'FOLLOW_UP' NOT NULL,
	"ordinal" integer NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"parent_amf_job_id" text,
	"parent_item_index" integer,
	"item_index" integer,
	"file_index_offset" integer DEFAULT 0 NOT NULL,
	"provider_status" text,
	"destination" text,
	"manifest_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gone_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anime_music_request_batch_jobs_batch_job_unique" UNIQUE("batch_id","amf_job_id"),
	CONSTRAINT "anime_music_request_batch_jobs_batch_ordinal_unique" UNIQUE("batch_id","ordinal")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE anime_music_request_batch_jobs ADD CONSTRAINT anime_music_request_batch_jobs_batch_id_anime_music_request_batches_id_fk FOREIGN KEY ("batch_id") REFERENCES anime_music_request_batches("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anime_music_request_batch_jobs_job_idx" ON anime_music_request_batch_jobs ("amf_job_id");
--> statement-breakpoint
-- Adopt every batch that already has a submitted provider job as the ROOT of
-- its own graph. This is what makes the live backfill work without a script:
-- the next poll of each of the 10 existing root jobs discovers and adopts its
-- follow-up children instead of requiring a fresh request (MC-Q02).
INSERT INTO anime_music_request_batch_jobs
	(id, batch_id, amf_job_id, role, ordinal, depth, parent_amf_job_id, parent_item_index, item_index, file_index_offset,
	 provider_status, destination, manifest_evidence, created_at, updated_at)
SELECT b.id || ':' || b.amf_job_id, b.id, b.amf_job_id, 'ROOT', 0, 0, NULL, NULL, NULL, 0,
	b.manifest_evidence->>'status', b.amf_request_body->>'destination', COALESCE(b.manifest_evidence, '{}'::jsonb),
	b.created_at, b.updated_at
FROM anime_music_request_batches b
WHERE b.amf_job_id IS NOT NULL
ON CONFLICT DO NOTHING;
