import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DrizzleClientApiService } from "../src/api/drizzleClientApiService.js";
import { runMigrations } from "../src/db/migrate.js";
import type { JobQueue } from "../src/jobs/index.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const queue = { enqueue: async () => ({ id: 1 }) } as unknown as JobQueue;

describe.skipIf(!adminDatabaseUrl)("ready-only listener music catalog (PostgreSQL)", () => {
  it("publishes only READY Related tracks and exact READY Full modes", async () => {
    await withDatabase(async (pool) => {
      await seedCatalog(pool);
      const service = new DrizzleClientApiService(drizzle(pool), queue, undefined, undefined, true);

      const music = await service.getAnimeMusic("user-1", "kitsu-1");
      expect(music?.releases).toHaveLength(1);
      expect(music?.releases[0]).toMatchObject({
        id: 200,
        relationshipType: "SOUNDTRACK",
        tracks: [{ id: 100, discNumber: 1, trackNumber: 1, displayOrder: 0, audioUrl: "/v1/media/songs/100/audio" }],
      });

      const library = await service.getLibrary("user-1", null);
      expect(library.themes[0]).toMatchObject({
        audioUrl: "/v1/media/audio/10",
        videoUrl: null,
        mediaModes: {
          tvSize: { url: "/v1/media/audio/10" },
          fullSize: { songId: 100, sourceReleaseId: 200, url: "/v1/media/songs/100/audio" },
          video: { url: "https://example.invalid/video.webm", spoiler: false, nsfw: false },
        },
      });
      expect(library.themes.find((theme) => theme.id === 11)?.mediaModes.fullSize).toBeNull();

      const changes = await service.getChanges("user-1", Date.now() + 60_000);
      expect(changes.musicCatalog).toBeUndefined();
      expect(changes.themes).toEqual([]);
      const search = await service.searchMusic("user-1", "ready artist");
      expect(search.tracks).toHaveLength(1);
      expect(search.releases).toHaveLength(1);
      expect((await service.searchMusic("user-1", "catalog_anime 100%")).releases).toHaveLength(1);
      expect(await service.searchMusic("user-1", "%_")).toEqual({ releases: [], tracks: [] });
    });
  });

  it("returns empty catalog surfaces when the feature flag is disabled", async () => {
    await withDatabase(async (pool) => {
      await seedCatalog(pool);
      const service = new DrizzleClientApiService(drizzle(pool), queue);
      expect(await service.getAnimeMusic("user-1", "kitsu-1")).toBeNull();
      expect(await service.getMusicRelease("user-1", 200)).toBeNull();
      expect(await service.searchMusic("user-1", "ready")).toEqual({ releases: [], tracks: [] });
      const disabledChanges = await service.getChanges("user-1", Date.now() + 60_000);
      expect(disabledChanges.musicCatalog).toBeUndefined();
      expect(disabledChanges.themes).toEqual([]);
      expect((await service.getLibrary("user-1", null)).themes[0]?.mediaModes).toMatchObject({ fullSize: null, video: null });
    });
  });

  it("orders release tracks by their album track number when delivery order was scrambled", async () => {
    await withDatabase(async (pool) => {
      await seedCatalog(pool);
      await pool.query(`
        INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist) VALUES
          (104,'Track Five','track five','Ready Artist','ready artist'),
          (105,'Track Seventeen','track seventeen','Ready Artist','ready artist');
        INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order) VALUES
          (200,104,1,5,99),(200,105,1,17,2);
        INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,byte_size,content_type,source_file_name) VALUES
          ('AUDIO','song:104','ORIGINAL','provider-import:five.flac','READY','audio/songs/104/original.flac',1234,'audio/flac','five.flac'),
          ('AUDIO','song:105','ORIGINAL','provider-import:seventeen.flac','READY','audio/songs/105/original.flac',1234,'audio/flac','seventeen.flac');
      `);
      const service = new DrizzleClientApiService(drizzle(pool), queue, undefined, undefined, true);

      const release = await service.getMusicRelease("user-1", 200);

      expect(release?.tracks.map((track) => track.trackNumber)).toEqual([1, 5, 17]);
    });
  });

  it("emits descriptor-only media changes and themes for a newly mapped library anime", async () => {
    await withDatabase(async (pool) => {
      await seedCatalog(pool);
      const service = new DrizzleClientApiService(drizzle(pool), queue, undefined, undefined, true);
      const mediaCursor = Date.now();
      await tick();
      await pool.query(`
        INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,byte_size)
          VALUES ('AUDIO','10','SHORT','https://example.invalid/tv.ogg','READY','audio/10.ogg',321);
        UPDATE theme_video_sources SET link='https://example.invalid/video-new.webm' WHERE theme_id=10;
        UPDATE music_acquisitions SET state='FAILED' WHERE purpose='FULL_SIZE' AND theme_id=10;
      `);

      const mediaChanges = await service.getChanges("user-1", mediaCursor);
      expect(mediaChanges.themes.find((theme) => theme.id === 10)?.mediaModes).toMatchObject({
        tvSize: { fileSize: 321 },
        fullSize: null,
        video: { url: "https://example.invalid/video-new.webm" },
      });

      const mappingCursor = Date.now();
      await tick();
      await pool.query("INSERT INTO library_entries (user_id,kitsu_id,watching_status) VALUES ('user-1','kitsu-2','current')");
      const mappingChanges = await service.getChanges("user-1", mappingCursor);
      expect(mappingChanges.themes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 12, animeThemesAnimeId: 2 }),
      ]));
    });
  });

  it("atomically refreshes the ready catalog when a previously hidden release becomes READY", async () => {
    await withDatabase(async (pool) => {
      await seedCatalog(pool);
      const service = new DrizzleClientApiService(drizzle(pool), queue, undefined, undefined, true);
      const cursor = Date.now();
      await tick();
      await pool.query(`
        INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,byte_size,content_type,source_file_name) VALUES
          ('AUDIO','song:101','ORIGINAL','provider-import:metadata.flac','READY','audio/songs/101/original.flac',1234,'audio/flac','metadata.flac');
        INSERT INTO music_acquisitions (provider,animethemes_anime_id,purpose,release_id,state) VALUES
          ('test',1,'RELATED_RELEASE',201,'READY');
      `);

      const changes = await service.getChanges("user-1", cursor);
      expect(changes.musicCatalog?.[0]?.releases.map((release) => release.id)).toEqual([200, 201]);
    });
  });

  it("searches accent- and width-folded anime titles in PostgreSQL", async () => {
    await withDatabase(async (pool) => {
      await seedCatalog(pool);
      await pool.query("UPDATE kitsu_anime SET title='Café Anime' WHERE kitsu_id='kitsu-1'");
      const service = new DrizzleClientApiService(drizzle(pool), queue, undefined, undefined, true);

      const result = await service.searchMusic("user-1", "Ｃａｆｅ　Ａｎｉｍｅ");

      expect(result.releases).toHaveLength(1);
      expect(result.tracks).toHaveLength(1);
    });
  });
});

async function seedCatalog(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO users (kitsu_user_id,username) VALUES ('user-1','listener');
    INSERT INTO animethemes_anime (id,name,name_en) VALUES (1,'Catalog Anime','Catalog Anime');
    INSERT INTO animethemes_anime (id,name,name_en) VALUES (2,'Mapped Later','Mapped Later');
    INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,title_en,mapping_state) VALUES
      ('kitsu-1',1,'Catalog_Anime 100%','Catalog Anime','MAPPED'),
      ('kitsu-2',2,'Mapped Later','Mapped Later','MAPPED');
    INSERT INTO library_entries (user_id,kitsu_id,watching_status) VALUES ('user-1','kitsu-1','current');
    INSERT INTO themes (id,animethemes_anime_id,title,audio_origin_url,duration_seconds) VALUES
      (10,1,'Opening','https://example.invalid/tv.ogg',90),
      (11,1,'Deleted Release Opening','https://example.invalid/tv-deleted.ogg',90),
      (12,2,'Mapped Later Opening','https://example.invalid/later.ogg',90);
    INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist,duration_seconds) VALUES
      (100,'Ready Song','ready song','Ready Artist','ready artist',240),
      (101,'Metadata Only','metadata only','Hidden Artist','hidden artist',180),
      (102,'Failed Song','failed song','Hidden Artist','hidden artist',181),
      (103,'Deleted Release Song','deleted release song','Hidden Artist','hidden artist',220);
    INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type,deleted_at) VALUES
      (200,'test','ready-release','Ready OST','ready ost','Ready Artist','SOUNDTRACK',NULL),
      (201,'test','metadata-release','Metadata OST','metadata ost','Hidden Artist','SOUNDTRACK',NULL),
      (202,'test','failed-release','Failed OST','failed ost','Hidden Artist','SOUNDTRACK',NULL),
      (203,'test','deleted-release','Deleted Single','deleted single','Hidden Artist','THEME',now());
    INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order) VALUES
      (200,100,1,1,0),(201,101,1,1,0),(202,102,1,1,0);
    INSERT INTO anime_music_releases (animethemes_anime_id,release_id,relationship_type,confidence,evidence) VALUES
      (1,200,'SOUNDTRACK',0.99,'{}'),(1,201,'SOUNDTRACK',0.99,'{}'),(1,202,'SOUNDTRACK',0.99,'{}');
    INSERT INTO theme_full_songs (theme_id,song_id,source_release_id,confidence,evidence) VALUES
      (10,100,200,0.99,'{}'),(11,103,203,0.99,'{}');
    INSERT INTO music_acquisitions (provider,animethemes_anime_id,purpose,theme_id,song_id,release_id,state) VALUES
      ('test',1,'RELATED_RELEASE',NULL,NULL,200,'READY'),
      ('test',1,'RELATED_RELEASE',NULL,NULL,202,'FAILED'),
      ('test',1,'FULL_SIZE',10,100,200,'READY'),
      ('test',1,'FULL_SIZE',11,103,203,'READY');
    INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,byte_size,content_type,source_file_name) VALUES
      ('AUDIO','song:100','ORIGINAL','provider-import:ready.flac','READY','audio/songs/100/original.flac',1234,'audio/flac','ready.flac'),
      ('AUDIO','song:102','ORIGINAL','provider-import:failed.flac','READY','audio/songs/102/original.flac',1235,'audio/flac','failed.flac'),
      ('AUDIO','song:103','ORIGINAL','provider-import:deleted.flac','READY','audio/songs/103/original.flac',1236,'audio/flac','deleted.flac');
    INSERT INTO theme_video_sources (animethemes_video_id,animethemes_entry_id,theme_id,entry_version,link,mime_type,preference_rank)
      VALUES (500,501,10,1,'https://example.invalid/video.webm','video/webm',0);
  `);
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_catalog_api_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
