CREATE TABLE "anime_music_releases" (
	"animethemes_anime_id" bigint NOT NULL,
	"release_id" bigint NOT NULL,
	"relationship_type" text NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anime_music_releases_animethemes_anime_id_release_id_pk" PRIMARY KEY("animethemes_anime_id","release_id")
);
--> statement-breakpoint
CREATE TABLE "music_acquisitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_job_id" text,
	"provider_release_id" text,
	"animethemes_anime_id" bigint NOT NULL,
	"purpose" text NOT NULL,
	"theme_id" bigint,
	"song_id" bigint,
	"release_id" bigint,
	"state" text DEFAULT 'REQUESTED' NOT NULL,
	"provider_resource_created" boolean DEFAULT false NOT NULL,
	"prior_provider_monitoring_state" text,
	"next_retry_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "music_acquisitions_provider_job_unique" UNIQUE("provider","provider_job_id")
);
--> statement-breakpoint
CREATE TABLE "music_discovery_state" (
	"animethemes_anime_id" bigint PRIMARY KEY NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"next_scan_at" timestamp with time zone,
	"status" text DEFAULT 'NEVER' NOT NULL,
	"missing_full_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_releases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_release_id" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"artist_credit" text NOT NULL,
	"release_type" text NOT NULL,
	"release_date" date,
	"artwork_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "music_releases_provider_release_unique" UNIQUE("provider","provider_release_id")
);
--> statement-breakpoint
CREATE TABLE "play_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_event_id" text NOT NULL,
	"item_type" text NOT NULL,
	"item_id" bigint NOT NULL,
	"actual_mode" text NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "play_events_user_client_event_unique" UNIQUE("user_id","client_event_id")
);
--> statement-breakpoint
CREATE TABLE "release_tracks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"release_id" bigint NOT NULL,
	"song_id" bigint NOT NULL,
	"disc_number" integer DEFAULT 1 NOT NULL,
	"track_number" integer,
	"display_order" integer NOT NULL,
	CONSTRAINT "release_tracks_release_display_order_unique" UNIQUE("release_id","display_order")
);
--> statement-breakpoint
CREATE TABLE "song_prefs" (
	"user_id" text NOT NULL,
	"song_id" bigint NOT NULL,
	"liked" boolean DEFAULT false NOT NULL,
	"disliked" boolean DEFAULT false NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp with time zone,
	"liked_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "song_prefs_user_id_song_id_pk" PRIMARY KEY("user_id","song_id")
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"animethemes_song_id" bigint,
	"musicbrainz_recording_id" text,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"artist_credit" text NOT NULL,
	"normalized_artist" text NOT NULL,
	"duration_seconds" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "songs_animethemes_song_id_unique" UNIQUE("animethemes_song_id"),
	CONSTRAINT "songs_musicbrainz_recording_id_unique" UNIQUE("musicbrainz_recording_id")
);
--> statement-breakpoint
CREATE TABLE "theme_full_songs" (
	"theme_id" bigint PRIMARY KEY NOT NULL,
	"song_id" bigint NOT NULL,
	"source_release_id" bigint,
	"confidence" double precision NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theme_video_sources" (
	"animethemes_video_id" bigint PRIMARY KEY NOT NULL,
	"animethemes_entry_id" bigint NOT NULL,
	"theme_id" bigint NOT NULL,
	"entry_version" integer,
	"entry_order" integer,
	"link" text NOT NULL,
	"mime_type" text,
	"resolution" integer,
	"source" text,
	"spoiler" boolean DEFAULT false NOT NULL,
	"nsfw" boolean DEFAULT false NOT NULL,
	"creditless" boolean DEFAULT false NOT NULL,
	"subbed" boolean DEFAULT false NOT NULL,
	"lyrics" boolean DEFAULT false NOT NULL,
	"preference_rank" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playlist_entries" RENAME COLUMN "theme_id" TO "item_id";--> statement-breakpoint
ALTER TABLE "playlist_entries" DROP CONSTRAINT "playlist_entries_theme_id_themes_id_fk";
--> statement-breakpoint
DROP INDEX "playlist_entries_theme_id_idx";--> statement-breakpoint
ALTER TABLE "playlist_entries" DROP CONSTRAINT "playlist_entries_playlist_id_theme_id_order_index_pk";--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "source_file_name" text;--> statement-breakpoint
ALTER TABLE "playlist_entries" ADD COLUMN "id" bigserial PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "playlist_entries" ADD COLUMN "item_type" text DEFAULT 'THEME' NOT NULL;--> statement-breakpoint
ALTER TABLE "playlist_entries" ADD COLUMN "mode_override" text;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "default_mode" text DEFAULT 'TV_SIZE' NOT NULL;--> statement-breakpoint
ALTER TABLE "theme_prefs" ADD COLUMN "disliked_tv_size" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "theme_prefs" ADD COLUMN "disliked_full_size" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "anime_music_releases" ADD CONSTRAINT "anime_music_releases_animethemes_anime_id_animethemes_anime_id_fk" FOREIGN KEY ("animethemes_anime_id") REFERENCES "public"."animethemes_anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_music_releases" ADD CONSTRAINT "anime_music_releases_release_id_music_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."music_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_acquisitions" ADD CONSTRAINT "music_acquisitions_animethemes_anime_id_animethemes_anime_id_fk" FOREIGN KEY ("animethemes_anime_id") REFERENCES "public"."animethemes_anime"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_acquisitions" ADD CONSTRAINT "music_acquisitions_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_acquisitions" ADD CONSTRAINT "music_acquisitions_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_acquisitions" ADD CONSTRAINT "music_acquisitions_release_id_music_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."music_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_discovery_state" ADD CONSTRAINT "music_discovery_state_animethemes_anime_id_animethemes_anime_id_fk" FOREIGN KEY ("animethemes_anime_id") REFERENCES "public"."animethemes_anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_events" ADD CONSTRAINT "play_events_user_id_users_kitsu_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("kitsu_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tracks" ADD CONSTRAINT "release_tracks_release_id_music_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."music_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tracks" ADD CONSTRAINT "release_tracks_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_prefs" ADD CONSTRAINT "song_prefs_user_id_users_kitsu_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("kitsu_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_prefs" ADD CONSTRAINT "song_prefs_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_full_songs" ADD CONSTRAINT "theme_full_songs_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_full_songs" ADD CONSTRAINT "theme_full_songs_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_full_songs" ADD CONSTRAINT "theme_full_songs_source_release_id_music_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."music_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_video_sources" ADD CONSTRAINT "theme_video_sources_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anime_music_releases_release_id_idx" ON "anime_music_releases" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "music_acquisitions_state_retry_idx" ON "music_acquisitions" USING btree ("state","next_retry_at");--> statement-breakpoint
CREATE INDEX "music_acquisitions_anime_id_idx" ON "music_acquisitions" USING btree ("animethemes_anime_id");--> statement-breakpoint
CREATE INDEX "music_acquisitions_theme_id_idx" ON "music_acquisitions" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "music_acquisitions_song_id_idx" ON "music_acquisitions" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "music_acquisitions_release_id_idx" ON "music_acquisitions" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "music_discovery_state_due_idx" ON "music_discovery_state" USING btree ("status","next_scan_at");--> statement-breakpoint
CREATE INDEX "music_releases_normalized_title_idx" ON "music_releases" USING btree ("normalized_title");--> statement-breakpoint
CREATE INDEX "music_releases_updated_at_idx" ON "music_releases" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "play_events_user_played_at_idx" ON "play_events" USING btree ("user_id","played_at");--> statement-breakpoint
CREATE INDEX "play_events_item_idx" ON "play_events" USING btree ("item_type","item_id");--> statement-breakpoint
CREATE INDEX "release_tracks_release_order_idx" ON "release_tracks" USING btree ("release_id","display_order");--> statement-breakpoint
CREATE INDEX "release_tracks_song_id_idx" ON "release_tracks" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "song_prefs_user_updated_idx" ON "song_prefs" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "song_prefs_user_deleted_idx" ON "song_prefs" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "song_prefs_user_liked_active_idx" ON "song_prefs" USING btree ("user_id","liked","song_id") WHERE "song_prefs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "songs_normalized_title_artist_idx" ON "songs" USING btree ("normalized_title","normalized_artist");--> statement-breakpoint
CREATE INDEX "songs_updated_at_idx" ON "songs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "theme_full_songs_song_id_idx" ON "theme_full_songs" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "theme_full_songs_source_release_id_idx" ON "theme_full_songs" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "theme_video_sources_theme_rank_idx" ON "theme_video_sources" USING btree ("theme_id","preference_rank");--> statement-breakpoint
CREATE INDEX "theme_video_sources_entry_id_idx" ON "theme_video_sources" USING btree ("animethemes_entry_id");--> statement-breakpoint
CREATE INDEX "playlist_entries_item_idx" ON "playlist_entries" USING btree ("item_type","item_id");