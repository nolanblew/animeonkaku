import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DrizzleMediaApiRepository } from "../src/api/drizzleMediaApiRepository.js";
import { runMigrations } from "../src/db/migrate.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("ready catalog song media publication gate (PostgreSQL)", () => {
  it("hides orphan READY media while exposing published Full and Related songs", async () => {
    await withDatabase(async (pool) => {
      await pool.query(`
        INSERT INTO animethemes_anime (id,name) VALUES (1,'Catalog Anime');
        INSERT INTO themes (id,animethemes_anime_id,title,audio_origin_url)
          VALUES (10,1,'Opening','https://example.invalid/tv.ogg');
        INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist,duration_seconds) VALUES
          (100,'Orphan','orphan','Artist','artist',180),
          (101,'Published Full','published full','Artist','artist',240),
          (102,'Published Related','published related','Composer','composer',200);
        INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type) VALUES
          (200,'test','full','Full Single','full single','Artist','THEME'),
          (201,'test','related','OST','ost','Composer','SOUNDTRACK');
        INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order) VALUES
          (200,101,1,1,0), (201,102,1,1,0);
        INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,byte_size,sha256,content_type,source_file_name) VALUES
          ('AUDIO','song:100','ORIGINAL','provider-import:orphan.flac','READY','audio/songs/100/original.flac',10,'orphan','audio/flac','orphan.flac'),
          ('AUDIO','song:101','ORIGINAL','provider-import:full.flac','READY','audio/songs/101/original.flac',11,'full','audio/flac','full.flac'),
          ('AUDIO','song:102','ORIGINAL','provider-import:related.mp3','READY','audio/songs/102/original.mp3',12,'related','audio/mpeg','related.mp3');
        INSERT INTO theme_full_songs (theme_id,song_id,source_release_id,confidence,evidence)
          VALUES (10,101,200,0.99,'{}');
        INSERT INTO anime_music_releases (animethemes_anime_id,release_id,relationship_type,confidence,evidence)
          VALUES (1,201,'SOUNDTRACK',0.98,'{}');
        INSERT INTO music_acquisitions
          (id,provider,provider_job_id,provider_release_id,animethemes_anime_id,purpose,theme_id,song_id,release_id,state,provider_metadata)
          VALUES
          (300,'test','full-job','full',1,'FULL_SIZE',10,101,200,'READY','{}'),
          (301,'test','related-job','related',1,'RELATED_RELEASE',NULL,NULL,201,'READY','{}');
      `);
      const repo = new DrizzleMediaApiRepository(drizzle(pool));

      expect(await repo.findSongAudio(100)).toBeNull();
      expect(await repo.findSongAudio(101)).toMatchObject({ songId: 101, state: "READY", contentType: "audio/flac" });
      expect(await repo.findSongAudio(102)).toMatchObject({ songId: 102, state: "READY", contentType: "audio/mpeg" });

      await pool.query("UPDATE songs SET deleted_at=now() WHERE id=101");
      expect(await repo.findSongAudio(101)).toBeNull();
      await pool.query("UPDATE songs SET deleted_at=NULL WHERE id=101");
      await pool.query("UPDATE themes SET deleted_at=now() WHERE id=10");
      expect(await repo.findSongAudio(101)).toBeNull();
      await pool.query("UPDATE themes SET deleted_at=NULL WHERE id=10");
      await pool.query("UPDATE music_releases SET deleted_at=now() WHERE id=200");
      expect(await repo.findSongAudio(101)).toBeNull();
      await pool.query("UPDATE music_releases SET deleted_at=NULL WHERE id=200");

      await pool.query("UPDATE songs SET deleted_at=now() WHERE id=102");
      expect(await repo.findSongAudio(102)).toBeNull();
      await pool.query("UPDATE songs SET deleted_at=NULL WHERE id=102");
      await pool.query("UPDATE music_releases SET deleted_at=now() WHERE id=201");
      expect(await repo.findSongAudio(102)).toBeNull();
    });
  });
});

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_catalog_media_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
