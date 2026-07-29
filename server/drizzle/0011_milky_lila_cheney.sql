CREATE TABLE "anime_music_request_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"batch_index" integer NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"amf_request_body" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"amf_job_id" text,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anime_music_request_batches_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "anime_music_request_batches_amf_job_id_unique" UNIQUE("amf_job_id"),
	CONSTRAINT "anime_music_request_batches_request_index_unique" UNIQUE("request_id","batch_index")
);
--> statement-breakpoint
CREATE TABLE "anime_music_request_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"item_index" integer NOT NULL,
	"kind" text NOT NULL,
	"number" integer,
	"theme_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anime_music_request_items_batch_index_unique" UNIQUE("batch_id","item_index")
);
--> statement-breakpoint
CREATE TABLE "anime_music_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"kitsu_id" text NOT NULL,
	"animethemes_anime_id" bigint NOT NULL,
	"source" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anime_music_request_batches" ADD CONSTRAINT "anime_music_request_batches_request_id_anime_music_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."anime_music_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_music_request_items" ADD CONSTRAINT "anime_music_request_items_batch_id_anime_music_request_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."anime_music_request_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_music_request_items" ADD CONSTRAINT "anime_music_request_items_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_music_requests" ADD CONSTRAINT "anime_music_requests_requested_by_user_id_users_kitsu_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("kitsu_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_music_requests" ADD CONSTRAINT "anime_music_requests_kitsu_id_kitsu_anime_kitsu_id_fk" FOREIGN KEY ("kitsu_id") REFERENCES "public"."kitsu_anime"("kitsu_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_music_requests" ADD CONSTRAINT "anime_music_requests_animethemes_anime_id_animethemes_anime_id_fk" FOREIGN KEY ("animethemes_anime_id") REFERENCES "public"."animethemes_anime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anime_music_request_batches_recovery_idx" ON "anime_music_request_batches" USING btree ("completed_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "anime_music_requests_one_active_anime_unique" ON "anime_music_requests" USING btree ("animethemes_anime_id") WHERE "anime_music_requests"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "anime_music_requests_anime_latest_idx" ON "anime_music_requests" USING btree ("animethemes_anime_id","created_at");