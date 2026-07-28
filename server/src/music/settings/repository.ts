import type { Pool } from "pg";
import type { EligibleAnime, MusicSearchMode, MusicSearchSettingsRecord, MusicSearchSettingsRepository } from "./types.js";

export class PgMusicSearchSettingsRepository implements MusicSearchSettingsRepository {
  constructor(private readonly pool: Pool) {}

  async getMode(): Promise<MusicSearchSettingsRecord> {
    const result = await this.pool.query<{ mode: MusicSearchMode; updated_at: Date }>(
      "SELECT mode,updated_at FROM music_search_settings WHERE singleton_id=1",
    );
    const row = result.rows[0];
    return row ? { mode: row.mode, updatedAt: row.updated_at } : { mode: "MANUAL", updatedAt: new Date(0) };
  }

  async setMode(mode: MusicSearchMode): Promise<MusicSearchSettingsRecord> {
    const result = await this.pool.query<{ mode: MusicSearchMode; updated_at: Date }>(`
      INSERT INTO music_search_settings (singleton_id,mode,updated_at) VALUES (1,$1,now())
      ON CONFLICT (singleton_id) DO UPDATE SET mode=EXCLUDED.mode,updated_at=now()
      RETURNING mode,updated_at`, [mode]);
    const row = result.rows[0]!;
    return { mode: row.mode, updatedAt: row.updated_at };
  }

  async listEligibleAnime(mode: Exclude<MusicSearchMode, "MANUAL">): Promise<EligibleAnime[]> {
    const result = await this.pool.query<{ user_id: string; kitsu_id: string }>(`
      WITH song_anime AS (
        SELECT tfs.song_id,t.animethemes_anime_id
          FROM theme_full_songs tfs JOIN themes t ON t.id=tfs.theme_id AND t.deleted_at IS NULL
        UNION
        SELECT rt.song_id,amr.animethemes_anime_id
          FROM release_tracks rt JOIN anime_music_releases amr ON amr.release_id=rt.release_id
      ), eligible AS (
        SELECT tp.user_id,t.animethemes_anime_id
          FROM theme_prefs tp JOIN themes t ON t.id=tp.theme_id AND t.deleted_at IS NULL
         WHERE $1='FAVORITES' AND tp.liked=true AND tp.deleted_at IS NULL
        UNION
        SELECT sp.user_id,sa.animethemes_anime_id
          FROM song_prefs sp JOIN song_anime sa ON sa.song_id=sp.song_id
         WHERE $1='FAVORITES' AND sp.liked=true AND sp.deleted_at IS NULL
        UNION
        SELECT p.user_id,t.animethemes_anime_id
          FROM playlists p JOIN playlist_entries pe ON pe.playlist_id=p.id AND pe.item_type='THEME'
          JOIN themes t ON t.id=pe.item_id AND t.deleted_at IS NULL
         WHERE $1='PLAYLISTS' AND p.deleted_at IS NULL AND p.is_auto=false
        UNION
        SELECT p.user_id,sa.animethemes_anime_id
          FROM playlists p JOIN playlist_entries pe ON pe.playlist_id=p.id AND pe.item_type='SONG'
          JOIN song_anime sa ON sa.song_id=pe.item_id
         WHERE $1='PLAYLISTS' AND p.deleted_at IS NULL AND p.is_auto=false
        UNION
        SELECT le.user_id,ka.animethemes_anime_id
          FROM library_entries le JOIN kitsu_anime ka ON ka.kitsu_id=le.kitsu_id
         WHERE $1='EVERYTHING' AND le.deleted_at IS NULL AND ka.deleted_at IS NULL
           AND ka.mapping_state='MAPPED' AND ka.animethemes_anime_id IS NOT NULL
      ), candidates AS (
        SELECT e.user_id,ka.kitsu_id,e.animethemes_anime_id
          FROM eligible e
          JOIN kitsu_anime ka ON ka.animethemes_anime_id=e.animethemes_anime_id
            AND ka.deleted_at IS NULL AND ka.mapping_state='MAPPED'
          JOIN themes t ON t.animethemes_anime_id=e.animethemes_anime_id
            AND t.deleted_at IS NULL AND t.animethemes_song_id IS NOT NULL
         GROUP BY e.user_id,ka.kitsu_id,e.animethemes_anime_id
      )
      SELECT DISTINCT ON (c.animethemes_anime_id) c.user_id,c.kitsu_id
        FROM candidates c
       WHERE NOT EXISTS (SELECT 1 FROM anime_music_requests r WHERE r.animethemes_anime_id=c.animethemes_anime_id)
          OR EXISTS (
            SELECT 1 FROM themes current_theme
             WHERE current_theme.animethemes_anime_id=c.animethemes_anime_id
               AND current_theme.deleted_at IS NULL AND current_theme.animethemes_song_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM anime_music_request_items requested_item
                 JOIN anime_music_request_batches requested_batch ON requested_batch.id=requested_item.batch_id
                 JOIN anime_music_requests requested ON requested.id=requested_batch.request_id
                  WHERE requested.animethemes_anime_id=c.animethemes_anime_id
                    AND requested_item.theme_id=current_theme.id
               )
          )
       ORDER BY c.animethemes_anime_id,c.user_id,c.kitsu_id`, [mode]);
    return result.rows.map((row) => ({ userId: row.user_id, kitsuId: row.kitsu_id }));
  }
}
