import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { PgMusicRequestRepository } from "../src/music/requests/repository.js";
import type { NewMusicRequest } from "../src/music/requests/types.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("anime music requests (PostgreSQL)", () => {
  it("serializes cross-user creation, replays the active request, and recovers committed batches", async () => {
    await withDatabase(async (pool) => {
      await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('u1','one'),('u2','two')");
      await pool.query("INSERT INTO animethemes_anime (id,name) VALUES (42,'Show')");
      await pool.query("INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,mapping_state) VALUES ('k1',42,'Show','MAPPED'),('k2',42,'Show Alias','MAPPED')");
      const repo = new PgMusicRequestRepository(pool);

      const [first, second] = await Promise.all([
        repo.createOrReplay(newRequest("request-a", "batch-a", "item-a", "u1", "k1")),
        repo.createOrReplay(newRequest("request-b", "batch-b", "item-b", "u2", "k2")),
      ]);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      expect(first.request.id).toBe(second.request.id);
      expect((await pool.query("SELECT id FROM anime_music_requests")).rowCount).toBe(1);

      const recoverable = await repo.listRecoverableBatches();
      expect(recoverable).toHaveLength(1);
      expect(recoverable[0]).toMatchObject({ requestId: first.request.id, amfJobId: null });

      await repo.recordProviderState(recoverable[0]!.id, { state: "COMPLETED", amfJobId: "amf-finished" }, new Date());
      const next = await repo.createOrReplay(newRequest("request-c", "batch-c", "item-c", "u2", "k2"));
      expect(next).toMatchObject({ created: true, request: { id: "request-c" } });
      expect((await pool.query("SELECT id FROM anime_music_requests ORDER BY created_at")).rows).toHaveLength(2);
    });
  });
});

function newRequest(id: string, batchId: string, itemId: string, userId: string, kitsuId: string): NewMusicRequest {
  return { id, requestedByUserId: userId, kitsuId, animeThemesAnimeId: 42, source: "DEBUG_USER", batches: [{
    id: batchId, index: 0, idempotencyKey: `anime-ongaku:${id}:0`,
    body: { titles: { romaji: "Show" }, items: [{ kind: "OST" }], destination: `anime-ongaku-staging/request-${id}/batch-0` },
    items: [{ id: itemId, itemIndex: 0, kind: "OST", number: null, themeId: null }],
  }] };
}

async function withDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `ongaku_music_requests_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
