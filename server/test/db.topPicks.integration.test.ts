import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DrizzleTopPicksService } from "../src/api/topPicksService.js";
import { runMigrations } from "../src/db/migrate.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("stable Top picks snapshots (PostgreSQL)", () => {
  it("keeps preview as the full snapshot prefix and applies scope and hydration safety", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      const service = new DrizzleTopPicksService(drizzle(pool), {
        now: () => new Date("2026-09-15T12:00:00Z"),
        musicCatalogEnabled: true,
      });

      const preview = await service.getTopPicks("user-1", { limit: 2, includeExtras: true, filter: "ALL" });
      const full = await service.getTopPicks("user-1", {
        limit: 60, includeExtras: true, filter: "ALL", snapshot: preview.snapshot,
      });

      expect(full.items.length).toBeGreaterThan(2);
      expect(preview.items).toEqual(full.items.slice(0, 2));
      expect(full.items.some((item) => item.itemType === "SONG" && item.itemId === 101)).toBe(true);
      expect(full.items.some((item) => item.itemType === "SONG" && item.itemId === 100)).toBe(false);
      expect(new Date(full.expiresAt).getTime() - new Date(full.generatedAt).getTime()).toBe(30 * 60 * 1000);

      const themesOnly = await service.getTopPicks("user-1", { limit: 60, includeExtras: false, filter: "ALL" });
      expect(themesOnly.items.every((item) => item.itemType === "THEME" && /^(OP|ED)/.test(item.theme.themeType ?? ""))).toBe(true);
      const endings = await service.getTopPicks("user-1", { limit: 60, includeExtras: true, filter: "ED" });
      expect(endings.items.map((item) => item.itemId)).toEqual([11]);

      await expect(service.getTopPicks("user-1", {
        limit: 60, includeExtras: false, filter: "ALL", snapshot: preview.snapshot,
      })).rejects.toMatchObject({ statusCode: 400, code: "TOP_PICKS_SNAPSHOT_SCOPE_MISMATCH" });

      const removedId = full.items[0]!.itemId;
      await pool.query("UPDATE theme_prefs SET disliked=true WHERE user_id='user-1' AND theme_id=$1", [removedId]);
      const safe = await service.getTopPicks("user-1", {
        limit: 60, includeExtras: true, filter: "ALL", snapshot: preview.snapshot,
      });
      expect(safe.items.some((item) => item.itemType === "THEME" && item.itemId === removedId)).toBe(false);
    });
  });

  it("does not reuse an empty pre-sync snapshot after library data arrives", async () => {
    await withDatabase(async (pool) => {
      await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('empty-user','empty')");
      const service = new DrizzleTopPicksService(drizzle(pool), {
        now: () => new Date("2026-09-15T12:00:00Z"),
      });
      const empty = await service.getTopPicks("empty-user", { limit: 6, includeExtras: false, filter: "ALL" });
      expect(empty.items).toEqual([]);

      await pool.query(`
        INSERT INTO animethemes_anime (id,name) VALUES (9,'Late Anime');
        INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,mapping_state) VALUES ('late',9,'Late Anime','MAPPED');
        INSERT INTO library_entries (user_id,kitsu_id) VALUES ('empty-user','late');
        INSERT INTO themes (id,animethemes_anime_id,title,theme_type,audio_origin_url) VALUES (90,9,'Late OP','OP1','https://example.invalid/late.ogg');
        INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path) VALUES ('AUDIO','90','SHORT','https://example.invalid/late.ogg','READY','audio/late.ogg');
      `);

      const populated = await service.getTopPicks("empty-user", { limit: 6, includeExtras: false, filter: "ALL" });
      expect(populated.snapshot).not.toBe(empty.snapshot);
      expect(populated.items).toHaveLength(1);
    });
  });

  it("resolves concurrent cross-instance creation to one token and enforces user ownership", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('user-2','other')");
      const options = { now: () => new Date("2026-09-15T12:00:00Z"), musicCatalogEnabled: true };
      const firstService = new DrizzleTopPicksService(drizzle(pool), options);
      const secondService = new DrizzleTopPicksService(drizzle(pool), options);
      const [first, second] = await Promise.all([
        firstService.getTopPicks("user-1", { limit: 6, includeExtras: true, filter: "ALL" }),
        secondService.getTopPicks("user-1", { limit: 60, includeExtras: true, filter: "ALL" }),
      ]);

      expect(second.snapshot).toBe(first.snapshot);
      expect(first.items).toEqual(second.items.slice(0, 6));
      await expect(firstService.getTopPicks("user-2", {
        limit: 60, includeExtras: true, filter: "ALL", snapshot: first.snapshot,
      })).rejects.toMatchObject({ statusCode: 410, code: "TOP_PICKS_SNAPSHOT_EXPIRED" });
    });
  });

  it("expires tokens, while play-count and catalog additions cannot reorder a live snapshot", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      let now = new Date("2026-09-15T12:00:00Z");
      const service = new DrizzleTopPicksService(drizzle(pool), { now: () => now, musicCatalogEnabled: true });
      const initial = await service.getTopPicks("user-1", { limit: 60, includeExtras: true, filter: "ALL" });
      const keys = initial.items.map((item) => item.key);
      const initialTheme = initial.items.find((item) => item.key === "THEME:10");
      const initialThemeRevision = initialTheme?.itemType === "THEME" ? initialTheme.theme.updatedAt : 0;
      await pool.query("UPDATE theme_prefs SET play_count=100 WHERE user_id='user-1' AND theme_id=11");
      await pool.query("UPDATE media_files SET updated_at='2099-01-01T00:00:00Z' WHERE kind='AUDIO' AND variant='SHORT' AND ref_id='10'");
      await pool.query(`
        INSERT INTO themes (id,animethemes_anime_id,title,theme_type,audio_origin_url) VALUES (14,2,'New OP','OP3','https://example.invalid/new.ogg');
        INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path) VALUES ('AUDIO','14','SHORT','https://example.invalid/new.ogg','READY','audio/14.ogg');
      `);
      const stable = await service.getTopPicks("user-1", { limit: 60, includeExtras: true, filter: "ALL", snapshot: initial.snapshot });
      expect(stable.items.map((item) => item.key)).toEqual(keys);
      const refreshedTheme = stable.items.find((item) => item.key === "THEME:10");
      expect(refreshedTheme?.itemType === "THEME" ? refreshedTheme.theme.updatedAt : 0).toBeGreaterThan(initialThemeRevision);

      now = new Date("2026-09-15T12:31:00Z");
      await expect(service.getTopPicks("user-1", {
        limit: 60, includeExtras: true, filter: "ALL", snapshot: initial.snapshot,
      })).rejects.toMatchObject({ statusCode: 410, code: "TOP_PICKS_SNAPSHOT_EXPIRED" });
      const refreshed = await service.getTopPicks("user-1", { limit: 60, includeExtras: true, filter: "ALL" });
      expect(refreshed.snapshot).not.toBe(initial.snapshot);
      expect(refreshed.items.some((item) => item.key === "THEME:14")).toBe(true);
    });
  });

  it("supports a full-only theme when enabled, respects variant dislikes, and hides catalog modes when disabled", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      await pool.query("INSERT INTO theme_prefs (user_id,theme_id,disliked_tv_size) VALUES ('user-1',13,true)");
      const enabled = new DrizzleTopPicksService(drizzle(pool), {
        now: () => new Date("2026-09-15T12:00:00Z"), musicCatalogEnabled: true,
      });
      const enabledResult = await enabled.getTopPicks("user-1", { limit: 60, includeExtras: false, filter: "ALL" });
      const fullOnly = enabledResult.items.find((item) => item.key === "THEME:13");
      expect(fullOnly?.itemType === "THEME" ? fullOnly.theme.mediaModes.fullSize?.songId : null).toBe(102);

      await pool.query("UPDATE theme_prefs SET disliked_full_size=true WHERE user_id='user-1' AND theme_id=13");
      const safe = await enabled.getTopPicks("user-1", {
        limit: 60, includeExtras: false, filter: "ALL", snapshot: enabledResult.snapshot,
      });
      expect(safe.items.some((item) => item.key === "THEME:13")).toBe(false);

      const disabled = new DrizzleTopPicksService(drizzle(pool), {
        now: () => new Date("2026-09-15T12:31:00Z"), musicCatalogEnabled: false,
      });
      const disabledResult = await disabled.getTopPicks("user-1", { limit: 60, includeExtras: true, filter: "ALL" });
      expect(disabledResult.items.every((item) => item.itemType === "THEME" && item.theme.mediaModes.fullSize === null)).toBe(true);
      expect(disabledResult.items.some((item) => item.itemType === "SONG")).toBe(false);
    });
  });

  it("omits snapshot members removed from the library or no longer playable without backfilling", async () => {
    await withDatabase(async (pool) => {
      await seed(pool);
      const service = new DrizzleTopPicksService(drizzle(pool), {
        now: () => new Date("2026-09-15T12:00:00Z"), musicCatalogEnabled: true,
      });
      const scoped = await service.getTopPicks("user-1", { limit: 60, includeExtras: false, filter: "ALL" });
      await pool.query("UPDATE themes SET theme_type='OST' WHERE id=11");
      const revalidated = await service.getTopPicks("user-1", {
        limit: 60, includeExtras: false, filter: "ALL", snapshot: scoped.snapshot,
      });
      expect(revalidated.items.some((item) => item.key === "THEME:11")).toBe(false);
      const snapshot = await service.getTopPicks("user-1", { limit: 60, includeExtras: true, filter: "ALL" });
      const originalTotal = snapshot.total;
      await pool.query("UPDATE library_entries SET deleted_at=now() WHERE user_id='user-1' AND kitsu_id='kitsu-1'");
      await pool.query("UPDATE media_files SET state='MISSING' WHERE kind='AUDIO' AND variant='SHORT' AND ref_id='12'");
      const safe = await service.getTopPicks("user-1", {
        limit: 60, includeExtras: true, filter: "ALL", snapshot: snapshot.snapshot,
      });
      expect(safe.total).toBeLessThan(originalTotal);
      expect(safe.items.some((item) => item.anime?.kitsuId === "kitsu-1")).toBe(false);
      expect(safe.items.some((item) => item.key === "THEME:12")).toBe(false);
    });
  });
});

async function seed(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO users (kitsu_user_id,username) VALUES ('user-1','listener');
    INSERT INTO animethemes_anime (id,name) VALUES (1,'Anime One'),(2,'Anime Two');
    INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,title_en,poster_url,mapping_state) VALUES
      ('kitsu-1',1,'Anime One','Anime One','https://example.invalid/one.jpg','MAPPED'),
      ('kitsu-2',2,'Anime Two','Anime Two','https://example.invalid/two.jpg','MAPPED');
    INSERT INTO library_entries (user_id,kitsu_id,watching_status) VALUES ('user-1','kitsu-1','current'),('user-1','kitsu-2','completed');
    INSERT INTO themes (id,animethemes_anime_id,title,theme_type,audio_origin_url,duration_seconds) VALUES
      (10,1,'Opening','OP1','https://example.invalid/op.ogg',90),
      (11,1,'Ending','ED1','https://example.invalid/ed.ogg',90),
      (12,2,'Score','OST','https://example.invalid/ost.ogg',90),
      (13,2,'Full-only Opening','OP2','https://example.invalid/missing.ogg',90);
    INSERT INTO theme_artists (theme_id,artist_name) VALUES (10,'Singer'),(11,'Singer'),(12,'Composer');
    INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,byte_size) VALUES
      ('AUDIO','10','SHORT','https://example.invalid/op.ogg','READY','audio/10.ogg',1000),
      ('AUDIO','11','SHORT','https://example.invalid/ed.ogg','READY','audio/11.ogg',1000),
      ('AUDIO','12','SHORT','https://example.invalid/ost.ogg','READY','audio/12.ogg',1000);
    INSERT INTO theme_prefs (user_id,theme_id,liked,play_count,last_played_at) VALUES
      ('user-1',10,true,9,'2026-09-14T00:00:00Z'),('user-1',11,false,6,'2026-09-13T00:00:00Z');
    INSERT INTO songs (id,title,normalized_title,artist_credit,normalized_artist,duration_seconds) VALUES
      (100,'Full Opening','full opening','Singer','singer',240),(101,'Extra Track','extra track','Composer','composer',180),
      (102,'Second Full Opening','second full opening','Singer','singer',250);
    INSERT INTO music_releases (id,provider,provider_release_id,title,normalized_title,artist_credit,release_type) VALUES
      (200,'test','ost','Anime One OST','anime one ost','Composer','SOUNDTRACK');
    INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order) VALUES (200,100,1,1,0),(200,101,1,2,1),(200,102,1,3,2);
    INSERT INTO anime_music_releases (animethemes_anime_id,release_id,relationship_type,confidence,evidence) VALUES (1,200,'SOUNDTRACK',1,'{}');
    INSERT INTO theme_full_songs (theme_id,song_id,source_release_id,confidence,evidence) VALUES (10,100,200,1,'{}'),(13,102,200,1,'{}');
    INSERT INTO music_acquisitions (provider,animethemes_anime_id,purpose,release_id,state) VALUES ('test',1,'RELATED_RELEASE',200,'READY');
    INSERT INTO music_acquisitions (provider,animethemes_anime_id,purpose,theme_id,song_id,release_id,state) VALUES ('test',1,'FULL_SIZE',10,100,200,'READY');
    INSERT INTO music_acquisitions (provider,animethemes_anime_id,purpose,theme_id,song_id,release_id,state) VALUES ('test',2,'FULL_SIZE',13,102,200,'READY');
    INSERT INTO media_files (kind,ref_id,variant,origin_url,state,file_path,byte_size,content_type) VALUES
      ('AUDIO','song:100','ORIGINAL','provider-import:full.flac','READY','audio/songs/100.flac',2000,'audio/flac'),
      ('AUDIO','song:101','ORIGINAL','provider-import:extra.flac','READY','audio/songs/101.flac',2000,'audio/flac'),
      ('AUDIO','song:102','ORIGINAL','provider-import:second.flac','READY','audio/songs/102.flac',2000,'audio/flac');
  `);
}

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_top_picks_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
