import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/errors.js";
import { DrizzleClientApiService } from "../src/api/drizzleClientApiService.js";
import { runMigrations } from "../src/db/migrate.js";
import type { JobQueue } from "../src/jobs/index.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const queue = { enqueue: async () => ({ id: 1 }) } as unknown as JobQueue;

describe.skipIf(!adminDatabaseUrl)("mixed playlist persistence (PostgreSQL)", () => {
  it("round-trips stable mixed occurrences and protects enhanced data from legacy writes", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      const service = new DrizzleClientApiService(drizzle(pool), queue, () => new Date("2026-07-20T12:00:00Z"));
      const created = await service.createPlaylist("user-1", {
        name: "Mixed",
        defaultMode: "FULL_SIZE",
        opTs: 1_000,
        items: [
          { itemType: "THEME", itemId: 10, modeOverride: "FULL_SIZE" },
          { itemType: "SONG", itemId: 100, modeOverride: null },
          { itemType: "SONG", itemId: 100, modeOverride: null },
        ],
      });
      expect(created.entries).toEqual([10]);
      expect(created.items.map((item) => [item.itemType, item.itemId])).toEqual([["THEME", 10], ["SONG", 100], ["SONG", 100]]);
      const ids = created.items.map((item) => item.entryId);
      const replayed = await service.createPlaylist("user-1", {
        name: "Mixed",
        defaultMode: "FULL_SIZE",
        opTs: 1_000,
        items: [
          { itemType: "THEME", itemId: 10, modeOverride: "FULL_SIZE" },
          { itemType: "SONG", itemId: 100, modeOverride: null },
          { itemType: "SONG", itemId: 100, modeOverride: null },
        ],
      });
      expect(replayed.items.map((item) => item.entryId)).toEqual(ids);

      const updated = await service.updatePlaylist("user-1", created.id, {
        opTs: 2_000,
        items: [
          { entryId: ids[2], itemType: "SONG", itemId: 100, modeOverride: null },
          { entryId: ids[0], itemType: "THEME", itemId: 10, modeOverride: "TV_SIZE" },
          { entryId: ids[1], itemType: "SONG", itemId: 100, modeOverride: null },
        ],
      });
      expect(updated?.items.map((item) => item.entryId)).toEqual([ids[2], ids[0], ids[1]]);
      expect(updated?.defaultMode).toBe("FULL_SIZE");

      await expect(service.updatePlaylist("user-1", created.id, { opTs: 3_000, entries: [10] }))
        .rejects.toMatchObject<ApiError>({ statusCode: 409, code: "PLAYLIST_REQUIRES_NEW_CLIENT" });
      expect((await service.updatePlaylist("user-1", created.id, { opTs: 500, entries: [10] }))?.items).toHaveLength(3);
      await expect(service.updatePlaylist("user-1", created.id, {
        opTs: 4_000,
        items: [{ itemType: "SONG", itemId: 101, modeOverride: null }],
      })).rejects.toMatchObject<ApiError>({ statusCode: 422 });
      await expect(service.updatePlaylist("user-1", created.id, {
        opTs: 5_000,
        items: [{ itemType: "THEME", itemId: 11, modeOverride: null }],
      })).rejects.toMatchObject<ApiError>({ statusCode: 422 });
      expect((await service.updatePlaylist("user-1", created.id, { opTs: 4_500, name: "Clock intact" }))?.name).toBe("Clock intact");
      expect((await service.listPlaylists("user-1"))[0]?.items).toHaveLength(3);
    });
  });
});

async function seed(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO users (kitsu_user_id,username) VALUES ('user-1','listener');
    INSERT INTO animethemes_anime (id,name) VALUES (1,'Anime');
    INSERT INTO themes (id,animethemes_anime_id,title,audio_origin_url,deleted_at) VALUES
      (10,1,'Opening','https://example.invalid/tv.ogg',NULL),
      (11,1,'Deleted','https://example.invalid/deleted.ogg',now());
    INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist) VALUES
      (100,'Related','related','Artist','artist'),(101,'Full only','full only','Artist','artist');
    INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type) VALUES
      (200,'test','related','OST','ost','Artist','SOUNDTRACK');
    INSERT INTO release_tracks (release_id,song_id,display_order) VALUES (200,100,0);
    INSERT INTO anime_music_releases (animethemes_anime_id,release_id,relationship_type,confidence,evidence) VALUES (1,200,'SOUNDTRACK',0.99,'{}');
    INSERT INTO music_acquisitions (provider,animethemes_anime_id,purpose,release_id,state) VALUES ('test',1,'RELATED_RELEASE',200,'READY');
    INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,content_type) VALUES
      ('AUDIO','song:100','ORIGINAL','provider-import:related.flac','READY','audio/songs/100/original.flac','audio/flac');
  `);
}

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_playlist_modes_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
