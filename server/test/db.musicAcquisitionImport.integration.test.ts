import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { MusicAcquisitionImportService, PgMusicAcquisitionImportRepository } from "../src/music/import/index.js";
import type { MusicAcquisitionProvider } from "../src/music/types.js";
import type { MediaStore } from "../src/media/mediaStore.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("legacy music acquisition import recovery (PostgreSQL)", () => {
  it("derives and durably backfills Full and Related accepted tracks/evidence created before catalogIntent", async () => {
    await withDatabase(async (pool) => {
      await pool.query(`
        INSERT INTO animethemes_anime (id,name) VALUES (1,'Legacy Anime');
        INSERT INTO themes (id,animethemes_anime_id,title,audio_origin_url) VALUES
          (10,1,'Legacy Opening','https://example.invalid/tv.ogg');
        INSERT INTO songs (id,musicbrainz_recording_id,title,normalized_title,artist_credit,normalized_artist,duration_seconds) VALUES
          (100,'recording-full','Legacy Opening','legacy opening','Legacy Artist','legacy artist',240),
          (101,'recording-related','Legacy Cue','legacy cue','Composer','composer',180);
        INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type) VALUES
          (200,'test','release-full','Legacy Single','legacy single','Legacy Artist','THEME'),
          (201,'test','release-related','Legacy OST','legacy ost','Composer','SOUNDTRACK');
        INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order) VALUES
          (200,100,1,1,0), (201,101,1,1,0);
        INSERT INTO theme_full_songs (theme_id,song_id,source_release_id,confidence,evidence) VALUES
          (10,100,200,0.97,'{"signals":["legacy-full"]}');
        INSERT INTO anime_music_releases (animethemes_anime_id,release_id,relationship_type,confidence,evidence) VALUES
          (1,201,'SOUNDTRACK',0.91,'{"signals":["legacy-related"]}');
        INSERT INTO music_acquisitions
          (id,provider,provider_job_id,provider_release_id,animethemes_anime_id,purpose,theme_id,song_id,release_id,state,provider_resource_created,provider_metadata)
        VALUES
          (300,'test','command-full','release-full',1,'FULL_SIZE',10,100,200,'IMPORTING',true,'{"adapterOwned":true}'),
          (301,'test','command-related','release-related',1,'RELATED_RELEASE',NULL,NULL,201,'IMPORTING',false,'{"monitoringChanged":true}');
      `);
      const repo = new PgMusicAcquisitionImportRepository(pool);

      const full = await repo.loadAcquisition(300);
      const related = await repo.loadAcquisition(301);

      expect(full?.expectedTracks).toEqual([expect.objectContaining({ songId: 100, musicbrainzRecordingId: "recording-full", normalizedTitle: "legacy opening" })]);
      expect(related?.expectedTracks).toEqual([expect.objectContaining({ songId: 101, musicbrainzRecordingId: "recording-related", normalizedTitle: "legacy cue" })]);
      const persisted = await pool.query<{ id: string; intent: { confidence: number; releaseType?: string; tracks: unknown[] } }>(
        "SELECT id,provider_metadata->'catalogIntent' AS intent FROM music_acquisitions WHERE id IN (300,301) ORDER BY id",
      );
      expect(persisted.rows[0]?.intent).toMatchObject({ confidence: 0.97, tracks: [expect.objectContaining({ songId: 100 })] });
      expect(persisted.rows[1]?.intent).toMatchObject({ confidence: 0.91, releaseType: "SOUNDTRACK", tracks: [expect.objectContaining({ songId: 101 })] });
      expect(Number((await pool.query<{ count: string }>("SELECT count(*) FROM theme_full_songs")).rows[0]?.count)).toBe(0);
      expect(Number((await pool.query<{ count: string }>("SELECT count(*) FROM anime_music_releases")).rows[0]?.count)).toBe(0);
    });
  });

  it("serializes concurrent last consumers and elects adapter-created ownership exactly once", async () => {
    await withDatabase(async (pool) => {
      const intent = JSON.stringify({ tracks: [{ songId: 100, providerTrackId: "track-1", normalizedTitle: "cue", normalizedArtist: "artist", durationSeconds: 180 }], confidence: 0.9, evidence: {} });
      await pool.query(`
        INSERT INTO animethemes_anime (id,name) VALUES (1,'Cleanup Anime');
        INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist,duration_seconds) VALUES
          (100,'Cue','cue','Artist','artist',180);
        INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type) VALUES
          (200,'test','release-shared','OST','ost','Artist','SOUNDTRACK');
        INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order) VALUES (200,100,1,1,0);
      `);
      await pool.query(`INSERT INTO music_acquisitions
          (id,provider,provider_job_id,provider_release_id,animethemes_anime_id,purpose,release_id,state,provider_resource_created,prior_provider_monitoring_state,provider_metadata)
        VALUES
          (400,'test','command-shared','release-shared',1,'RELATED_RELEASE',200,'READY',true,NULL,jsonb_build_object('adapterOwned',true,'catalogIntent',$1::jsonb)),
          (401,'test','command-shared','release-shared',1,'RELATED_RELEASE',200,'READY',false,'all',jsonb_build_object('monitoringChanged',true,'catalogIntent',$1::jsonb));
      `, [intent]);
      const cleanup = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { cleaned: true };
      });
      const provider = {
        provider: "test", healthCheck: vi.fn(), lookupReleases: vi.fn(), ensureRelease: vi.fn(), startAcquisition: vi.fn(),
        getAcquisitionStatus: vi.fn(), listReleaseTracks: vi.fn(), listImportedFiles: vi.fn(), cleanup,
      } satisfies MusicAcquisitionProvider;
      const repo = new PgMusicAcquisitionImportRepository(pool);
      const service = new MusicAcquisitionImportService({ repo, provider, mediaStore: {} as MediaStore });

      await Promise.all([service.importAcquisition(400), service.importAcquisition(401)]);

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({ resource: expect.objectContaining({ providerResourceCreated: true }) }));
      const markers = await pool.query<{ complete: string }>("SELECT provider_metadata->>'cleanupComplete' AS complete FROM music_acquisitions ORDER BY id");
      expect(markers.rows).toEqual([{ complete: "true" }, { complete: "true" }]);
    });
  });

  it("preserves a newer different Full Size junction while backfilling an older acquisition", async () => {
    await withDatabase(async (pool) => {
      await pool.query(`
        INSERT INTO animethemes_anime (id,name) VALUES (1,'Replacement Anime');
        INSERT INTO themes (id,animethemes_anime_id,title,audio_origin_url) VALUES (10,1,'Opening','https://example.invalid/tv.ogg');
        INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist,duration_seconds) VALUES
          (100,'Legacy Opening','legacy opening','Artist','artist',240),
          (101,'Replacement Opening','replacement opening','Artist','artist',241);
        INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type) VALUES
          (200,'test','legacy-release','Legacy','legacy','Artist','THEME'),
          (201,'test','replacement-release','Replacement','replacement','Artist','THEME');
        INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order) VALUES (200,100,1,1,0),(201,101,1,1,0);
        INSERT INTO theme_full_songs (theme_id,song_id,source_release_id,confidence,evidence) VALUES
          (10,101,201,0.99,'{"replacement":true}');
        INSERT INTO music_acquisitions
          (id,provider,provider_job_id,provider_release_id,animethemes_anime_id,purpose,theme_id,song_id,release_id,state,provider_resource_created,provider_metadata)
        VALUES (300,'test','legacy-command','legacy-release',1,'FULL_SIZE',10,100,200,'IMPORTING',true,'{"adapterOwned":true}');
      `);

      const recovered = await new PgMusicAcquisitionImportRepository(pool).loadAcquisition(300);

      expect(recovered?.expectedTracks).toEqual([expect.objectContaining({ songId: 100 })]);
      const link = await pool.query<{ song_id: string; source_release_id: string }>("SELECT song_id,source_release_id FROM theme_full_songs WHERE theme_id=10");
      expect(link.rows).toEqual([{ song_id: "101", source_release_id: "201" }]);
    });
  });

  it("rolls back premature publication, then atomically links READY media and bumps timestamps", async () => {
    await withDatabase(async (pool) => {
      const old = new Date("2020-01-01T00:00:00Z");
      const intent = JSON.stringify({ tracks: [{ songId: 100, providerTrackId: "track-1", normalizedTitle: "opening", normalizedArtist: "artist", durationSeconds: 240 }], confidence: 0.96, evidence: { exact: true } });
      await pool.query(`
        INSERT INTO animethemes_anime (id,name) VALUES (1,'Publish Anime');
        INSERT INTO themes (id,animethemes_anime_id,title,audio_origin_url,updated_at) VALUES (10,1,'Opening','https://example.invalid/tv.ogg','2020-01-01T00:00:00Z');
        INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist,duration_seconds,updated_at) VALUES (100,'Opening','opening','Artist','artist',240,'2020-01-01T00:00:00Z');
        INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type,updated_at) VALUES (200,'test','release-1','Single','single','Artist','THEME','2020-01-01T00:00:00Z');
        INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order) VALUES (200,100,1,1,0);
      `);
      await pool.query(`INSERT INTO music_acquisitions
        (id,provider,provider_job_id,provider_release_id,animethemes_anime_id,purpose,theme_id,song_id,release_id,state,provider_resource_created,provider_metadata)
        VALUES (300,'test','command-1','release-1',1,'FULL_SIZE',10,100,200,'IMPORTING',true,jsonb_build_object('catalogIntent',$1::jsonb))`, [intent]);
      const repo = new PgMusicAcquisitionImportRepository(pool);

      await expect(repo.publishReady({ acquisitionId: 300, songIds: [100] })).rejects.toThrow(/before every selected media file is READY/);
      expect((await pool.query("SELECT 1 FROM theme_full_songs")).rowCount).toBe(0);
      expect((await pool.query<{ state: string }>("SELECT state FROM music_acquisitions WHERE id=300")).rows[0]?.state).toBe("IMPORTING");

      await pool.query(`INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,byte_size,sha256,content_type,source_file_name)
        VALUES ('AUDIO','song:100','ORIGINAL','provider-import:opening.flac','READY','audio/songs/100/original.flac',12,'sha','audio/flac','opening.flac')`);
      await repo.publishReady({ acquisitionId: 300, songIds: [100] });

      const published = await pool.query<{ state: string; completed_at: Date; theme_song: string; confidence: number }>(`SELECT ma.state,ma.completed_at,
        tfs.song_id AS theme_song,tfs.confidence FROM music_acquisitions ma JOIN theme_full_songs tfs ON tfs.theme_id=10 WHERE ma.id=300`);
      expect(published.rows[0]).toMatchObject({ state: "READY", theme_song: "100", confidence: 0.96 });
      expect(published.rows[0]?.completed_at).toBeInstanceOf(Date);
      const timestamps = await pool.query<{ theme_updated: Date; song_updated: Date; release_updated: Date }>(`SELECT t.updated_at AS theme_updated,s.updated_at AS song_updated,mr.updated_at AS release_updated
        FROM themes t JOIN songs s ON s.id=100 JOIN music_releases mr ON mr.id=200 WHERE t.id=10`);
      expect(timestamps.rows[0]?.theme_updated.getTime()).toBeGreaterThan(old.getTime());
      expect(timestamps.rows[0]?.song_updated.getTime()).toBeGreaterThan(old.getTime());
      expect(timestamps.rows[0]?.release_updated.getTime()).toBeGreaterThan(old.getTime());
    });
  });

  it("serializes concurrent work for the same song with PostgreSQL advisory locks", async () => {
    await withDatabase(async (pool) => {
      const repo = new PgMusicAcquisitionImportRepository(pool);
      let active = 0;
      let maximumActive = 0;
      const work = () => repo.withSongLocks([100], async () => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active--;
      });

      await Promise.all([work(), work()]);

      expect(maximumActive).toBe(1);
    });
  });
});

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_import_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
