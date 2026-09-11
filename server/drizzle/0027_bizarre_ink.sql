CREATE TABLE "artist_catalogs" (
	"slug" text PRIMARY KEY NOT NULL,
	"artist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"full_songs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'loading' NOT NULL,
	"has_data" boolean DEFAULT false NOT NULL,
	"last_updated_at" timestamp with time zone,
	"refresh_requested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_catalogs" ADD CONSTRAINT "artist_catalogs_slug_artists_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."artists"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_catalogs_status_idx" ON "artist_catalogs" USING btree ("status","updated_at");