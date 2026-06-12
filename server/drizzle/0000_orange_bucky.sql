CREATE TABLE "anime_genres" (
	"kitsu_id" text NOT NULL,
	"genre_slug" text NOT NULL,
	CONSTRAINT "anime_genres_kitsu_id_genre_slug_pk" PRIMARY KEY("kitsu_id","genre_slug")
);
--> statement-breakpoint
CREATE TABLE "animethemes_anime" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text,
	"name_en" text,
	"cover_url" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_url" text
);
--> statement-breakpoint
CREATE TABLE "device_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"device_name" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "device_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"slug" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"priority" integer NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "kitsu_anime" (
	"kitsu_id" text PRIMARY KEY NOT NULL,
	"animethemes_anime_id" bigint,
	"title" text,
	"title_en" text,
	"title_romaji" text,
	"title_ja" text,
	"poster_url" text,
	"poster_url_large" text,
	"cover_url" text,
	"cover_url_large" text,
	"subtype" text,
	"start_date" date,
	"end_date" date,
	"episode_count" integer,
	"age_rating" text,
	"average_rating" double precision,
	"slug" text,
	"mapping_state" text DEFAULT 'UNMAPPED' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "library_entries" (
	"user_id" text NOT NULL,
	"kitsu_id" text NOT NULL,
	"watching_status" text,
	"user_rating" double precision,
	"library_updated_at" timestamp with time zone,
	"is_manually_added" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "library_entries_user_id_kitsu_id_pk" PRIMARY KEY("user_id","kitsu_id")
);
--> statement-breakpoint
CREATE TABLE "media_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"origin_url" text NOT NULL,
	"state" text DEFAULT 'MISSING' NOT NULL,
	"file_path" text,
	"byte_size" bigint,
	"sha256" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_files_kind_ref_id_unique" UNIQUE("kind","ref_id")
);
--> statement-breakpoint
CREATE TABLE "playlist_entries" (
	"playlist_id" bigint NOT NULL,
	"theme_id" bigint NOT NULL,
	"order_index" integer NOT NULL,
	CONSTRAINT "playlist_entries_playlist_id_theme_id_order_index_pk" PRIMARY KEY("playlist_id","theme_id","order_index")
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"is_auto" boolean DEFAULT false NOT NULL,
	"auto_kind" text,
	"gradient_seed" integer DEFAULT 0 NOT NULL,
	"dynamic_spec_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "playlists_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "theme_artists" (
	"theme_id" bigint NOT NULL,
	"artist_name" text NOT NULL,
	"as_character" text,
	"alias" text,
	CONSTRAINT "theme_artists_theme_id_artist_name_pk" PRIMARY KEY("theme_id","artist_name")
);
--> statement-breakpoint
CREATE TABLE "theme_prefs" (
	"user_id" text NOT NULL,
	"theme_id" bigint NOT NULL,
	"liked" boolean DEFAULT false NOT NULL,
	"disliked" boolean DEFAULT false NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_prefs_user_id_theme_id_pk" PRIMARY KEY("user_id","theme_id")
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"animethemes_anime_id" bigint NOT NULL,
	"title" text NOT NULL,
	"theme_type" text,
	"audio_origin_url" text NOT NULL,
	"video_origin_url" text,
	"duration_seconds" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"kitsu_user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"kitsu_access_token" text,
	"kitsu_refresh_token" text,
	"kitsu_token_expires_at" timestamp with time zone,
	"kitsu_auth_state" text DEFAULT 'OK' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_status_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anime_genres" ADD CONSTRAINT "anime_genres_kitsu_id_kitsu_anime_kitsu_id_fk" FOREIGN KEY ("kitsu_id") REFERENCES "public"."kitsu_anime"("kitsu_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_genres" ADD CONSTRAINT "anime_genres_genre_slug_genres_slug_fk" FOREIGN KEY ("genre_slug") REFERENCES "public"."genres"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_users_kitsu_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("kitsu_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitsu_anime" ADD CONSTRAINT "kitsu_anime_animethemes_anime_id_animethemes_anime_id_fk" FOREIGN KEY ("animethemes_anime_id") REFERENCES "public"."animethemes_anime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_user_id_users_kitsu_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("kitsu_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_kitsu_id_kitsu_anime_kitsu_id_fk" FOREIGN KEY ("kitsu_id") REFERENCES "public"."kitsu_anime"("kitsu_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_entries" ADD CONSTRAINT "playlist_entries_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_entries" ADD CONSTRAINT "playlist_entries_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_users_kitsu_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("kitsu_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_artists" ADD CONSTRAINT "theme_artists_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_prefs" ADD CONSTRAINT "theme_prefs_user_id_users_kitsu_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("kitsu_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_prefs" ADD CONSTRAINT "theme_prefs_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_animethemes_anime_id_animethemes_anime_id_fk" FOREIGN KEY ("animethemes_anime_id") REFERENCES "public"."animethemes_anime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "jobs" USING btree ("state","priority","next_run_at","id");