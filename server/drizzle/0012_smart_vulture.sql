CREATE TABLE "anime_music_request_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"file_index" integer NOT NULL,
	"relative_path" text NOT NULL,
	"byte_size" bigint,
	"sha256" text,
	"verified_byte_size" bigint,
	"verified_sha256" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"import_state" text DEFAULT 'PENDING' NOT NULL,
	"import_error" text,
	"song_id" bigint,
	"release_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anime_music_request_deliveries_item_file_unique" UNIQUE("item_id","file_index")
);
--> statement-breakpoint
ALTER TABLE "anime_music_request_batches" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_music_request_batches" ADD COLUMN "manifest_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_music_request_items" ADD COLUMN "acquisition_id" bigint;--> statement-breakpoint
ALTER TABLE "anime_music_request_items" ADD COLUMN "result_status" text;--> statement-breakpoint
ALTER TABLE "anime_music_request_items" ADD COLUMN "result_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_music_request_items" ADD COLUMN "import_state" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_music_request_items" ADD COLUMN "import_error" text;--> statement-breakpoint
ALTER TABLE "anime_music_request_deliveries" ADD CONSTRAINT "anime_music_request_deliveries_item_id_anime_music_request_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."anime_music_request_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_music_request_deliveries" ADD CONSTRAINT "anime_music_request_deliveries_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_music_request_deliveries" ADD CONSTRAINT "anime_music_request_deliveries_release_id_music_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."music_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anime_music_request_deliveries_import_idx" ON "anime_music_request_deliveries" USING btree ("import_state","created_at");--> statement-breakpoint
ALTER TABLE "anime_music_request_items" ADD CONSTRAINT "anime_music_request_items_acquisition_id_music_acquisitions_id_fk" FOREIGN KEY ("acquisition_id") REFERENCES "public"."music_acquisitions"("id") ON DELETE no action ON UPDATE no action;