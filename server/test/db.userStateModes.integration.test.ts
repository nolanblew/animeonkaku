import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DrizzleClientApiService } from "../src/api/drizzleClientApiService.js";
import { runMigrations } from "../src/db/migrate.js";
import type { JobQueue } from "../src/jobs/index.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const queue = { enqueue: async () => ({ id: 1 }) } as unknown as JobQueue;

describe.skipIf(!adminDatabaseUrl)("mode-aware user state (PostgreSQL)", () => {
  it("keeps reaction scopes independent and deduplicates actual-mode events", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      let now = new Date("2026-07-21T12:00:00Z");
      const service = new DrizzleClientApiService(drizzle(pool), queue, () => now, undefined, true);

      const deletedThemeEvent = { clientEventId: "b5ce8c57-811e-4758-8279-c030e085afbd", itemType: "THEME" as const, itemId: 11, actualMode: "TV_SIZE" as const, playedAt: 400 };
      await expect(service.recordPlays("user-1", [deletedThemeEvent])).rejects.toMatchObject({ statusCode: 404 });
      expect((await pool.query("SELECT 1 FROM play_events WHERE client_event_id=$1", [deletedThemeEvent.clientEventId])).rowCount).toBe(0);

      expect(await service.updateThemePref("user-2", 10, { dislikedFullSize: true, opTs: 500 })).toMatchObject({
        disliked: false, dislikedTvSize: false, dislikedFullSize: true,
      });

      expect(await service.updateThemePref("user-1", 10, { disliked: true, opTs: 1_000 })).toMatchObject({
        liked: false, disliked: true, dislikedTvSize: false, dislikedFullSize: false,
      });
      expect(await service.updateThemePref("user-1", 10, { dislikedTvSize: true, opTs: 2_000 })).toMatchObject({
        liked: false, disliked: false, dislikedTvSize: true, dislikedFullSize: false,
      });
      expect(await service.updateThemePref("user-1", 10, { dislikedFullSize: true, opTs: 3_000 })).toMatchObject({
        liked: false, disliked: false, dislikedTvSize: true, dislikedFullSize: true,
      });
      expect(await service.updateThemePref("user-1", 10, { dislikedTvSize: false, opTs: 2_500 })).toMatchObject({
        dislikedTvSize: true, dislikedFullSize: true,
      });
      expect(await service.updateThemePref("user-1", 10, { dislikedTvSize: false, opTs: 4_000 })).toMatchObject({
        disliked: false, dislikedTvSize: false, dislikedFullSize: true,
      });
      expect(await service.updateThemePref("user-1", 10, { liked: true, opTs: 5_000 })).toMatchObject({
        liked: true, disliked: false, dislikedTvSize: false, dislikedFullSize: false,
      });
      expect(await service.updateThemePref("user-1", 10, { disliked: true, opTs: 4_500 })).toMatchObject({ liked: true });

      expect(await service.updateSongPref("user-1", 100, { disliked: true, opTs: 1_000 })).toMatchObject({ songId: 100, liked: false, disliked: true });
      expect(await service.updateSongPref("user-1", 100, { liked: true, opTs: 2_000 })).toMatchObject({ songId: 100, liked: true, disliked: false });
      now = new Date("2026-07-21T12:01:00Z");
      await service.deleteSongPref("user-1", 100, 3_000);
      expect(await service.getSongPrefs("user-1")).toEqual([]);
      expect(await service.getSongPrefs("user-1", Date.parse("2026-07-21T12:00:30Z"))).toEqual([
        expect.objectContaining({ songId: 100, deleted: true }),
      ]);

      const event = { clientEventId: "fd3dc12e-bf70-4f86-87e4-f04efb7ea113", itemType: "THEME" as const, itemId: 10, actualMode: "FULL_SIZE" as const, playedAt: 10_000 };
      expect(await service.recordPlays("user-1", [event, event])).toEqual({ accepted: 1 });
      expect(await service.recordPlays("user-1", [event])).toEqual({ accepted: 0 });
      await expect(service.recordPlays("user-1", [{ ...event, itemId: 999, playedAt: 99_999 }]))
        .rejects.toMatchObject({ statusCode: 409, code: "PLAY_EVENT_ID_CONFLICT" });
      expect(await service.recordPlays("user-2", [event])).toEqual({ accepted: 1 });
      expect(await service.recordPlays("user-1", [{ themeId: 10, playedAt: 11_000 }])).toEqual({ accepted: 1 });
      expect(await service.recordPlays("user-1", [{ clientEventId: "2ec24567-bf06-4d10-8bc2-a307579efc5a", itemType: "SONG", itemId: 100, actualMode: "AUDIO", playedAt: 12_000 }])).toEqual({ accepted: 1 });
      const concurrent = { ...event, clientEventId: "1c764311-a757-42dd-a472-af445c7a8cb2", playedAt: 13_000 };
      expect((await Promise.all([
        service.recordPlays("user-1", [concurrent]),
        service.recordPlays("user-1", [concurrent]),
      ])).map((result) => result.accepted).sort()).toEqual([0, 1]);
      await expect(service.recordPlays("user-1", [
        { clientEventId: "07e6703e-ad93-4f28-925b-2ec8df2dfddb", itemType: "THEME", itemId: 10, actualMode: "TV_SIZE", playedAt: 14_000 },
        { clientEventId: "0b5fdfeb-0344-4769-abdb-082248bdfdd6", itemType: "THEME", itemId: 999, actualMode: "TV_SIZE", playedAt: 14_001 },
      ])).rejects.toMatchObject({ statusCode: 404 });
      const unavailableRetry = { clientEventId: "a3958d87-087a-470d-908c-21d70b7aa450", itemType: "SONG" as const, itemId: 100, actualMode: "AUDIO" as const, playedAt: 15_000 };
      expect(await service.recordPlays("user-1", [unavailableRetry])).toEqual({ accepted: 1 });
      await pool.query("UPDATE media_files SET state='MISSING' WHERE ref_id='song:100'");
      expect(await service.recordPlays("user-1", [unavailableRetry])).toEqual({ accepted: 0 });

      const theme = (await service.getThemePrefs("user-1"))[0]!;
      expect(theme).toMatchObject({ playCount: 3, lastPlayedAt: 13_000 });
      expect((await service.getThemePrefs("user-2"))[0]).toMatchObject({ playCount: 1 });
      const song = (await service.getSongPrefs("user-1"))[0]!;
      expect(song).toMatchObject({ liked: false, disliked: false, playCount: 2, lastPlayedAt: 15_000, deleted: false });
      const events = await pool.query("SELECT client_event_id,item_type,item_id,actual_mode FROM play_events ORDER BY id");
      expect(events.rows.filter((row) => row.client_event_id === event.clientEventId)).toHaveLength(2);
      expect(events.rows.filter((row) => row.client_event_id === concurrent.clientEventId)).toHaveLength(1);
      expect(events.rows).toContainEqual(expect.objectContaining({ item_type: "THEME", item_id: "10", actual_mode: "TV_SIZE" }));
      expect(events.rows).toContainEqual(expect.objectContaining({ item_type: "SONG", item_id: "100", actual_mode: "AUDIO" }));
      expect(events.rows).not.toContainEqual(expect.objectContaining({ client_event_id: "07e6703e-ad93-4f28-925b-2ec8df2dfddb" }));
    });
  });

  it("keeps Related reactions scoped to the user and song", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      const service = new DrizzleClientApiService(drizzle(pool), queue, undefined, undefined, true);
      await service.updateSongPref("user-1", 100, { disliked: true, opTs: 1_000 });
      expect(await service.getSongPrefs("user-2")).toEqual([]);
      expect(await service.getThemePrefs("user-1")).toEqual([]);
      expect(await service.getThemePrefs("user-2")).toEqual([]);
    });
  });

  it("resolves concurrent preference writes with the newest operation timestamp", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      const service = new DrizzleClientApiService(drizzle(pool), queue, undefined, undefined, true);
      await Promise.all([
        service.updateThemePref("user-1", 10, { dislikedTvSize: true, opTs: 1_000 }),
        service.updateThemePref("user-1", 10, { liked: true, opTs: 2_000 }),
      ]);
      expect((await service.getThemePrefs("user-1"))[0]).toMatchObject({
        liked: true, disliked: false, dislikedTvSize: false, dislikedFullSize: false,
      });
      await Promise.all([
        service.updateSongPref("user-1", 100, { disliked: true, opTs: 1_000 }),
        service.updateSongPref("user-1", 100, { liked: true, opTs: 2_000 }),
      ]);
      expect((await service.getSongPrefs("user-1"))[0]).toMatchObject({ liked: true, disliked: false });

      const sharedId = "33e7f92e-86df-4e4a-ab82-9f2d39101851";
      const concurrentPlays = await Promise.allSettled([
        service.recordPlays("user-1", [{ clientEventId: sharedId, itemType: "THEME", itemId: 10, actualMode: "TV_SIZE", playedAt: 20_000 }]),
        service.recordPlays("user-1", [{ clientEventId: sharedId, itemType: "THEME", itemId: 10, actualMode: "FULL_SIZE", playedAt: 20_001 }]),
      ]);
      expect(concurrentPlays.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(concurrentPlays.filter((result) => result.status === "rejected")).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({ statusCode: 409, code: "PLAY_EVENT_ID_CONFLICT" }) }),
      ]);
      expect((await service.getThemePrefs("user-1"))[0]).toMatchObject({ playCount: 1 });
      expect((await pool.query("SELECT 1 FROM play_events WHERE user_id='user-1' AND client_event_id=$1", [sharedId])).rowCount).toBe(1);
    });
  });
});

async function seed(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO users (kitsu_user_id,username) VALUES ('user-1','listener'),('user-2','other');
    INSERT INTO animethemes_anime (id,name) VALUES (1,'Anime');
    INSERT INTO themes (id,animethemes_anime_id,title,audio_origin_url,deleted_at) VALUES
      (10,1,'Opening','https://example.invalid/tv.ogg',NULL),
      (11,1,'Deleted Opening','https://example.invalid/deleted.ogg',now());
    INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist) VALUES (100,'Related','related','Artist','artist');
    INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type) VALUES (200,'test','related','OST','ost','Artist','SOUNDTRACK');
    INSERT INTO release_tracks (release_id,song_id,display_order) VALUES (200,100,0);
    INSERT INTO anime_music_releases (animethemes_anime_id,release_id,relationship_type,confidence,evidence) VALUES (1,200,'SOUNDTRACK',0.99,'{}');
    INSERT INTO music_acquisitions (provider,animethemes_anime_id,purpose,release_id,state) VALUES ('test',1,'RELATED_RELEASE',200,'READY');
    INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,content_type) VALUES ('AUDIO','song:100','ORIGINAL','provider-import:related.flac','READY','audio/songs/100/original.flac','audio/flac');
  `);
}

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_user_state_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
