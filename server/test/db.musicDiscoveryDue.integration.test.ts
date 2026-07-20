import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { PgMusicDiscoveryRepository } from "../src/music/discovery/pgRepository.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("music discovery due selection (PostgreSQL)", () => {
  it("uses a closed calendar-year window and keeps weekly recent precedence over missing Full Size", async () => {
    await withDatabase(async (pool) => {
      const now = new Date("2024-03-01T12:00:00Z");
      const repo = new PgMusicDiscoveryRepository(pool);
      await seedAnime(pool, [
        { id: 1, startDate: "2023-03-01" }, // exact one calendar year boundary
        { id: 2, startDate: "2023-02-28" }, // outside during leap year
        { id: 3, startDate: "2024-03-02" }, // future
        { id: 4, startDate: null }, // unknown release date
        { id: 5, startDate: "2022-03-01" }, // old complete
        { id: 6, startDate: null }, // orphan: no Kitsu mapping
        { id: 7, startDate: "2024-02-28" }, // recent and missing: weekly wins
        { id: 8, startDate: "2022-03-01" }, // old active mapping; deleted recent row must not revive it
      ]);
      await pool.query(`INSERT INTO kitsu_anime
        (kitsu_id,animethemes_anime_id,title,start_date,mapping_state,deleted_at)
        VALUES ('kitsu-8-deleted',8,'Anime 8 deleted mapping','2024-02-28','MAPPED',$1)`, [now]);
      await pool.query(`INSERT INTO music_discovery_state
        (animethemes_anime_id,status,next_scan_at,missing_full_count)
        VALUES
          (1,'COMPLETE',$1,0), (2,'COMPLETE',$1,0), (3,'COMPLETE',$1,0),
          (4,'COMPLETE',$1,0), (5,'COMPLETE',$1,0), (6,'COMPLETE',$1,0),
          (7,'COMPLETE',$1,1), (8,'COMPLETE',$1,0)`, [new Date("2024-03-01T00:00:00Z")]);

      const due = await repo.listDue(now, 25);
      expect(due.map((row) => row.animethemesAnimeId)).toEqual([1, 7]);

      await repo.markSucceeded(7, { missingFullCount: 1, ambiguous: false }, now);
      const result = await pool.query<{ next_scan_at: Date }>(
        "SELECT next_scan_at FROM music_discovery_state WHERE animethemes_anime_id=7",
      );
      expect(result.rows[0]?.next_scan_at).toEqual(new Date("2024-03-08T12:00:00Z"));
    });
  });

  it("returns the deterministic oldest 25 due rows", async () => {
    await withDatabase(async (pool) => {
      const now = new Date("2026-07-20T12:00:00Z");
      const ids = Array.from({ length: 27 }, (_, index) => 100 + index);
      await seedAnime(pool, ids.map((id) => ({ id, startDate: null })));
      for (const [index, id] of ids.entries()) {
        await pool.query(`INSERT INTO music_discovery_state
          (animethemes_anime_id,status,next_scan_at,last_attempt_at,missing_full_count)
          VALUES ($1,'COMPLETE',$2,$2,1)`, [id, new Date(now.getTime() - (27 - index) * 60_000)]);
      }

      const due = await new PgMusicDiscoveryRepository(pool).listDue(now, 25);
      expect(due).toHaveLength(25);
      expect(due.map((row) => row.animethemesAnimeId)).toEqual(ids.slice(0, 25));
    });
  });

  it("clamps leap-day calendar-year eligibility to February 28", async () => {
    await withDatabase(async (pool) => {
      const now = new Date("2024-02-29T12:00:00Z");
      const repo = new PgMusicDiscoveryRepository(pool);
      await seedAnime(pool, [
        { id: 20, startDate: "2023-02-28" },
        { id: 21, startDate: "2023-02-27" },
      ]);
      await pool.query(`INSERT INTO music_discovery_state
        (animethemes_anime_id,status,next_scan_at,missing_full_count)
        VALUES (20,'COMPLETE',$1,0), (21,'COMPLETE',$1,0)`, [new Date("2024-02-29T00:00:00Z")]);

      const due = await repo.listDue(now, 25);
      expect(due.map((row) => row.animethemesAnimeId)).toEqual([20]);
    });
  });
});

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_discovery_due_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [databaseName]);
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
}

async function seedAnime(
  pool: Pool,
  rows: Array<{ id: number; startDate: string | null }>,
): Promise<void> {
  for (const { id, startDate } of rows) {
    await pool.query("INSERT INTO animethemes_anime (id,name) VALUES ($1,$2)", [id, `Anime ${id}`]);
    if (id === 6) continue;
    await pool.query(`INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,start_date,mapping_state)
      VALUES ($1,$2,$3,$4,'MAPPED')`, [`kitsu-${id}`, id, `Anime ${id}`, startDate]);
  }
}
