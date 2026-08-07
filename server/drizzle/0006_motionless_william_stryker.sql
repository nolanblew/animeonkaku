CREATE INDEX "device_sessions_user_id_idx" ON "device_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kitsu_anime_animethemes_anime_id_idx" ON "kitsu_anime" USING btree ("animethemes_anime_id");--> statement-breakpoint
CREATE INDEX "kitsu_anime_updated_at_idx" ON "kitsu_anime" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "library_entries_user_updated_idx" ON "library_entries" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "library_entries_user_deleted_idx" ON "library_entries" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "library_entries_user_status_active_idx" ON "library_entries" USING btree ("user_id","watching_status","kitsu_id") WHERE "library_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "playlist_entries_playlist_order_idx" ON "playlist_entries" USING btree ("playlist_id","order_index");--> statement-breakpoint
CREATE INDEX "playlist_entries_theme_id_idx" ON "playlist_entries" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "playlists_user_updated_idx" ON "playlists" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "playlists_user_auto_active_idx" ON "playlists" USING btree ("user_id","is_auto","name") WHERE "playlists"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "playlists_user_dynamic_active_idx" ON "playlists" USING btree ("user_id","is_dynamic","dynamic_auto_update") WHERE "playlists"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "theme_prefs_user_updated_idx" ON "theme_prefs" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "theme_prefs_user_deleted_idx" ON "theme_prefs" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "theme_prefs_user_liked_active_idx" ON "theme_prefs" USING btree ("user_id","liked","theme_id") WHERE "theme_prefs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "themes_animethemes_anime_id_idx" ON "themes" USING btree ("animethemes_anime_id","id");--> statement-breakpoint
CREATE INDEX "themes_updated_at_idx" ON "themes" USING btree ("updated_at");