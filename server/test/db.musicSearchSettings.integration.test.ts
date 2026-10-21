import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { PgMusicSearchSettingsRepository } from "../src/music/settings/repository.js";
import { PgAdminDashboardService } from "../src/admin/service.js";
import { RecentLogStore } from "../src/logging.js";
import { PgMusicRequestRepository } from "../src/music/requests/repository.js";
import { MusicRequestService } from "../src/music/requests/service.js";
import { MusicSearchPolicyService } from "../src/music/settings/service.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("music search settings (PostgreSQL)", () => {
  it("persists exclusions, respects ownership, and retains eligibility from other playlists", async () => {
    await withDatabase(async (pool) => {
      await seedEligibility(pool);
      const admin = new PgAdminDashboardService({ pool, queue: {} as never, requests: {} as never,
        operator: {} as never, mediaRoot: process.cwd(), logs: new RecentLogStore() });
      const repo = new PgMusicSearchSettingsRepository(pool);
      await admin.setPlaylistMusicSearchExcluded("u1", "21", true);
      expect(await admin.listUserPlaylists("u1")).toContainEqual(expect.objectContaining({ id: "21", excludeFromMusicSearch: true, entryCount: 1 }));
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([]);
      await expect(repo.listEligibleAnime("FAVORITES")).resolves.toEqual([{ userId: "u1", kitsuId: "k1" }]);
      await expect(repo.listEligibleAnime("EVERYTHING")).resolves.toEqual([{ userId: "u1", kitsuId: "k3" }]);
      await expect(admin.setPlaylistMusicSearchExcluded("other", "21", false)).rejects.toMatchObject({ statusCode: 404 });
      await expect(admin.setPlaylistMusicSearchExcluded("u1", "22", true)).rejects.toMatchObject({ statusCode: 404 });
      await pool.query("INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist) VALUES (31,'Full song','full song','Artist','artist')");
      await pool.query("INSERT INTO theme_full_songs (theme_id,song_id,confidence) VALUES (12,31,1)");
      await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('u2','two')");
      await pool.query("INSERT INTO playlists (id,user_id,name,is_dynamic) VALUES (23,'u2','Smart mix',true)");
      await pool.query("INSERT INTO playlist_entries (playlist_id,item_type,item_id,order_index) VALUES (23,'SONG',31,0)");
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([{ userId: "u2", kitsuId: "k2" }]);
      await admin.setPlaylistMusicSearchExcluded("u2", "23", true);
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([]);
      await admin.setPlaylistMusicSearchExcluded("u1", "21", false);
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([{ userId: "u1", kitsuId: "k2" }]);
      await pool.query("UPDATE playlists SET deleted_at=now() WHERE id=21");
      await expect(admin.setPlaylistMusicSearchExcluded("u1", "21", false)).rejects.toMatchObject({ statusCode: 404 });
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([]);
    });
  });
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

      // A newly known insert song cannot create another full-song acquisition.
      await pool.query(`INSERT INTO themes
        (id,animethemes_song_id,animethemes_anime_id,title,theme_type,audio_origin_url)
        VALUES (15,105,1,'Insert Song','IN','https://audio.invalid/insert.webm')`);
      await expect(repo.listEligibleAnime("FAVORITES")).resolves.toEqual([]);

      await pool.query(`INSERT INTO themes
        (id,animethemes_song_id,animethemes_anime_id,title,theme_type,audio_origin_url)
        VALUES (14,104,1,'New Song','ED1','https://audio.invalid/new.webm')`);
      await expect(repo.listEligibleAnime("FAVORITES")).resolves.toEqual([{ userId: "u1", kitsuId: "k1" }]);
    });
  });

  it("replays an active persisted request after an enqueue failure while respecting exclusions and completion", async () => {
    await withDatabase(async (pool) => {
      await seedEligibility(pool);
      const repo = new PgMusicSearchSettingsRepository(pool);
      const target = { userId: "u1", kitsuId: "k2" };
      await pool.query(`INSERT INTO anime_music_requests
        (id,requested_by_user_id,kitsu_id,animethemes_anime_id,source,scope)
        VALUES ('active-request','u1','k2',2,'AUTOMATIC','FULL_SONGS')`);
      await pool.query(`INSERT INTO anime_music_request_batches
        (id,request_id,batch_index,amf_request_body,idempotency_key)
        VALUES ('active-batch','active-request',0,'{}','active-key')`);
      await pool.query(`INSERT INTO anime_music_request_items
        (id,batch_id,item_index,kind,number,theme_id) VALUES ('active-item','active-batch',0,'OP',1,12)`);
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([]);
      await expect(repo.listEligibleAnime("PLAYLISTS", target)).resolves.toEqual([target]);
      await pool.query("UPDATE playlists SET exclude_from_music_search=true WHERE id=21");
      await expect(repo.listEligibleAnime("PLAYLISTS", target)).resolves.toEqual([]);
      await pool.query("UPDATE playlists SET exclude_from_music_search=false WHERE id=21");
      await pool.query("UPDATE anime_music_requests SET completed_at=now() WHERE id='active-request'");
      await expect(repo.listEligibleAnime("PLAYLISTS", target)).resolves.toEqual([]);
    });
  });

  it("requires upstream song identity and becomes eligible after metadata recovery fills it", async () => {
    await withDatabase(async (pool) => {
      await seedEligibility(pool);
      const repo = new PgMusicSearchSettingsRepository(pool);
      await pool.query("UPDATE themes SET animethemes_song_id=NULL WHERE id=12");
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([]);
      await pool.query("UPDATE themes SET animethemes_song_id=102 WHERE id=12");
      await expect(repo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([{ userId: "u1", kitsuId: "k2" }]);
    });
  });

  it("recovers a restart after request persistence without creating another acquisition", async () => {
    await withDatabase(async (pool) => {
      await seedEligibility(pool);
      const policyRepo = new PgMusicSearchSettingsRepository(pool);
      await policyRepo.setMode("PLAYLISTS");
      let failEnqueue = true;
      const offered: Array<Record<string, unknown>> = [];
      const queue = { enqueue: async (job: Record<string, unknown>) => {
        if (failEnqueue) throw new Error("crash after request commit");
        offered.push(job);
        return {};
      } };
      const beforeRestart = new MusicRequestService({ repo: new PgMusicRequestRepository(pool), queue: queue as never });
      await expect(beforeRestart.trigger("u1", "k2", "AUTOMATIC")).rejects.toThrow("crash after request commit");
      const committed = (await pool.query("SELECT id,idempotency_key FROM anime_music_request_batches")).rows;
      expect(committed).toHaveLength(1);
      await expect(policyRepo.listEligibleAnime("PLAYLISTS")).resolves.toEqual([]);
      failEnqueue = false;
      const afterRestart = new MusicSearchPolicyService({
        repo: policyRepo, queue: queue as never,
        requests: new MusicRequestService({ repo: new PgMusicRequestRepository(pool), queue: queue as never }),
      });
      await afterRestart.reconcileAnime({ userId: "u1", kitsuId: "k2" });
      expect(offered).toEqual([expect.objectContaining({ type: "SUBMIT_AMF_MUSIC_BATCH", payload: { batchId: committed[0].id } })]);
      expect((await pool.query("SELECT id,idempotency_key FROM anime_music_request_batches")).rows).toEqual(committed);
      expect((await pool.query("SELECT id FROM anime_music_requests")).rows).toHaveLength(1);
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
