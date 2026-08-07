import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { PgMusicSearchSettingsRepository } from "../src/music/settings/repository.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("music search settings (PostgreSQL)", () => {
  it("persists the singleton mode and selects only the configured user-owned scope", async () => {
    await withDatabase(async (pool) => {
      await seedEligibility(pool);
      const repo = new PgMusicSearchSettingsRepository(pool);

      await expect(repo.getMode()).resolves.toMatchObject({ mode: "MANUAL" });
      await expect(repo.setMode("FAVORITES")).resolves.toMatchObject({ mode: "FAVORITES" });
      await expect(repo.listEligibleAnime("FAVORITES")).resolves.toEqual([{ userId: "u1", kitsuId: "k1" }]);
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([{ userId: "u1", kitsuId: "k2" }]);
      await expect(repo.listEligibleAnime("EVERYTHING")).resolves.toEqual([{ userId: "u1", kitsuId: "k3" }]);
    });
  });

  it("ignores play activity, avoids already-requested themes, and notices a newly mapped theme", async () => {
    await withDatabase(async (pool) => {
      await seedEligibility(pool);
      const repo = new PgMusicSearchSettingsRepository(pool);
      // Theme 2 has play_count but is not liked; it must not enter FAVORITES.
      await expect(repo.listEligibleAnime("FAVORITES")).resolves.toEqual([{ userId: "u1", kitsuId: "k1" }]);

      await pool.query(`INSERT INTO anime_music_requests
        (id,requested_by_user_id,kitsu_id,animethemes_anime_id,source,completed_at)
        VALUES ('request-1','u1','k1',1,'AUTOMATIC',now())`);
      await pool.query(`INSERT INTO anime_music_request_batches
        (id,request_id,batch_index,amf_request_body,idempotency_key,state,completed_at)
        VALUES ('batch-1','request-1',0,'{}','automatic-1','COMPLETED',now())`);
      await pool.query(`INSERT INTO anime_music_request_items
        (id,batch_id,item_index,kind,number,theme_id) VALUES ('item-1','batch-1',0,'OP',1,11)`);
      await expect(repo.listEligibleAnime("FAVORITES")).resolves.toEqual([]);

      await pool.query(`INSERT INTO themes
        (id,animethemes_song_id,animethemes_anime_id,title,theme_type,audio_origin_url)
        VALUES (14,104,1,'New Song','ED1','https://audio.invalid/new.webm')`);
      await expect(repo.listEligibleAnime("FAVORITES")).resolves.toEqual([{ userId: "u1", kitsuId: "k1" }]);
    });
  });
});

async function seedEligibility(pool: Pool): Promise<void> {
  await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('u1','one')");
  await pool.query("INSERT INTO animethemes_anime (id,name) VALUES (1,'Favorite'),(2,'Playlist'),(3,'Library')");
  await pool.query(`INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,mapping_state)
    VALUES ('k1',1,'Favorite','MAPPED'),('k2',2,'Playlist','MAPPED'),('k3',3,'Library','MAPPED')`);
  await pool.query(`INSERT INTO themes (id,animethemes_song_id,animethemes_anime_id,title,theme_type,audio_origin_url) VALUES
    (11,101,1,'Liked','OP1','https://audio.invalid/1.webm'),
    (12,102,2,'Played','OP1','https://audio.invalid/2.webm'),
    (13,103,3,'Library','OP1','https://audio.invalid/3.webm')`);
  await pool.query(`INSERT INTO theme_prefs (user_id,theme_id,liked,play_count)
    VALUES ('u1',11,true,0),('u1',12,false,9)`);
  await pool.query("INSERT INTO playlists (id,user_id,name,is_auto) VALUES (21,'u1','My mix',false),(22,'u1','Automatic',true)");
  await pool.query(`INSERT INTO playlist_entries (playlist_id,item_type,item_id,order_index)
    VALUES (21,'THEME',12,0),(22,'THEME',13,0)`);
  await pool.query("INSERT INTO library_entries (user_id,kitsu_id,watching_status) VALUES ('u1','k3','current')");
}

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_music_settings_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const admin = new Client({ connectionString: adminDatabaseUrl });
  const databaseUrl = new URL(adminDatabaseUrl!);
  databaseUrl.pathname = `/${databaseName}`;
  let pool: Pool | undefined;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    pool = new Pool({ connectionString: databaseUrl.toString() });
    await runMigrations(drizzle(pool));
    await run(pool);
  } finally {
    await pool?.end();
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]);
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
}
