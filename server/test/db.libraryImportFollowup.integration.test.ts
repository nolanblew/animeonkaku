import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import { MusicSearchPolicyService } from "../src/music/settings/service.js";
import { PgMusicSearchSettingsRepository } from "../src/music/settings/repository.js";
import { DrizzleSyncRepository } from "../src/sync/drizzleSyncRepository.js";
import { LibrarySyncPipeline } from "../src/sync/librarySyncPipeline.js";
import type { AnimeThemeEntry } from "../src/animethemes/types.js";
import type { KitsuAnimeEntry } from "../src/kitsu/types.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("library import follow-ups (PostgreSQL)", () => {
  it("refreshes auto-update dynamic playlists and queues eligible full songs after mapping", async () => {
    await withDatabase(async (pool) => {
      await pool.query(`INSERT INTO users
        (kitsu_user_id,username,kitsu_access_token,last_status_sync_at)
        VALUES ('u1','one','token','2026-09-18T20:00:00Z')`);
      await pool.query(`INSERT INTO kitsu_anime
        (kitsu_id,title,title_en,title_romaji,mapping_state)
        VALUES ('bookworm-4','Ascendance of a Bookworm Season 4','Ascendance of a Bookworm Season 4','Honzuki no Gekokujou Season 4','UNMAPPED')`);
      await pool.query(`INSERT INTO library_entries
        (user_id,kitsu_id,watching_status,library_updated_at)
        VALUES ('u1','bookworm-4','planned','2026-09-18T20:13:00Z')`);
      await pool.query(`INSERT INTO playlists
        (id,user_id,name,is_auto,is_dynamic,dynamic_auto_update,dynamic_spec_json,dynamic_sort_json)
        VALUES
          (41,'u1','Watching now',false,true,true,'{"type":"watching_status_in","statuses":["current"]}','{}'),
          (42,'u1','Snapshot',false,true,false,'{"type":"watching_status_in","statuses":["current"]}','{}')`);
      await pool.query(`INSERT INTO playlist_entries (playlist_id,item_type,item_id,order_index)
        VALUES (42,'THEME',999,0)`);

      const db = drizzle(pool);
      const syncRepo = new DrizzleSyncRepository(db);
      await syncRepo.upsertLibraryEntries("u1", [libraryEntry("bookworm-4", "current")]);

      const queue = new JobQueue(new FakeJobRepository());
      const settingsRepo = new PgMusicSearchSettingsRepository(pool);
      await settingsRepo.setMode("PLAYLISTS");
      const trigger = vi.fn().mockResolvedValue(undefined);
      const musicPolicy = new MusicSearchPolicyService({
        repo: settingsRepo,
        queue,
        requests: { trigger },
      });
      const mappedTheme = theme();
      const pipeline = new LibrarySyncPipeline({
        repo: syncRepo,
        kitsu: {} as never,
        animeThemes: {
          fetchByKitsuIds: async () => ({
            mappings: new Map([["bookworm-4", 4001]]),
            themes: [mappedTheme],
          }),
        },
        queue,
        onLibraryChanged: async () => {
          await musicPolicy.enqueueImportReconciliation();
        },
      });

      const mapJob = await queue.enqueue({
        type: "MAP_THEMES",
        priority: JobPriority.NORMAL,
        payload: { kitsuIds: ["bookworm-4"], userId: "u1" },
        dedupeKey: "MAP_THEMES:u1:bookworm-4",
      });
      const claimed = (await queue.claimNext())!;
      expect(claimed.id).toBe(mapJob.id);
      await pipeline.runMapThemes({
        kitsuIds: ["bookworm-4"],
        userId: "u1",
        job: claimed,
      });

      const autoEntries = await pool.query<{ item_id: number }>(
        "SELECT item_id FROM playlist_entries WHERE playlist_id=41 ORDER BY order_index",
      );
      const snapshotEntries = await pool.query<{ item_id: number }>(
        "SELECT item_id FROM playlist_entries WHERE playlist_id=42 ORDER BY order_index",
      );
      expect(autoEntries.rows.map((row) => Number(row.item_id))).toEqual([400101]);
      expect(snapshotEntries.rows.map((row) => Number(row.item_id))).toEqual([999]);

      expect((await queue.list("QUEUED")).some((job) => job.type === "RECONCILE_MUSIC_SEARCH_POLICY")).toBe(true);
      await expect(musicPolicy.reconcile()).resolves.toMatchObject({ mode: "PLAYLISTS", queued: 1 });
      expect(trigger).toHaveBeenCalledWith("u1", "bookworm-4", "AUTOMATIC");

      // A status-only sync for an already-mapped anime must re-materialize
      // auto-update playlists and remove the theme when it no longer matches.
      // Snapshot playlists remain untouched by the normal refresh path.
      const statusPipeline = new LibrarySyncPipeline({
        repo: syncRepo,
        kitsu: {
          getLibraryEntries: async () => [],
          getLibraryEntriesUpdatedSince: async () => [libraryEntry("bookworm-4", "completed")],
          getAnimeCategories: async () => new Map(),
        },
        animeThemes: {},
        queue,
        onLibraryChanged: async () => {
          await musicPolicy.enqueueImportReconciliation();
        },
      });
      const statusJob = await queue.enqueue({
        type: "KITSU_DELTA_SYNC",
        priority: JobPriority.NORMAL,
        payload: { userId: "u1", full: false },
        dedupeKey: "KITSU_DELTA_SYNC:u1",
      });
      await statusPipeline.runKitsuSync({ userId: "u1", full: false, job: statusJob });

      const removedAutoEntries = await pool.query<{ item_id: number }>(
        "SELECT item_id FROM playlist_entries WHERE playlist_id=41 ORDER BY order_index",
      );
      const preservedSnapshotEntries = await pool.query<{ item_id: number }>(
        "SELECT item_id FROM playlist_entries WHERE playlist_id=42 ORDER BY order_index",
      );
      expect(removedAutoEntries.rows).toEqual([]);
      expect(preservedSnapshotEntries.rows.map((row) => Number(row.item_id))).toEqual([999]);
      await expect(musicPolicy.reconcile()).resolves.toMatchObject({ mode: "PLAYLISTS", queued: 0 });
    });
  }, 30_000);
});

function theme(): AnimeThemeEntry {
  return {
    animeId: 4001,
    animeName: "Ascendance of a Bookworm Season 4",
    animeNameEn: "Ascendance of a Bookworm Season 4",
    animeSlug: "ascendance-of-a-bookworm-season-4",
    animeSynonyms: [],
    kitsuId: "bookworm-4",
    coverUrl: null,
    themeId: 400101,
    animeThemesSongId: 4001001,
    title: "Bookworm OP",
    artistName: "Artist",
    audioUrl: "https://a.animethemes.moe/bookworm-4.op1.ogg",
    videoUrl: null,
    themeType: "OP1",
    artists: [{ name: "Artist", asCharacter: null, alias: null }],
    songResources: [],
    videoCandidates: [],
    videoFallback: false,
  };
}

function libraryEntry(id: string, watchingStatus: KitsuAnimeEntry["watchingStatus"]): KitsuAnimeEntry {
  return {
    id,
    title: "Ascendance of a Bookworm Season 4",
    titleEn: "Ascendance of a Bookworm Season 4",
    titleRomaji: "Honzuki no Gekokujou Season 4",
    titleJa: null,
    abbreviatedTitles: [],
    posterUrl: null,
    posterUrlLarge: null,
    coverUrl: null,
    coverUrlLarge: null,
    watchingStatus,
    subtype: "TV",
    startDate: "2026-01-01",
    endDate: null,
    episodeCount: 12,
    ageRating: "PG",
    averageRating: 8,
    userRating: null,
    libraryUpdatedAt: "2026-09-18T20:13:00.000Z",
    watchedAt: null,
    slug: "ascendance-of-a-bookworm-season-4",
  };
}

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_library_followup_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
    await admin.query("DROP DATABASE IF EXISTS \"" + databaseName + "\"");
    await admin.end();
  }
}
