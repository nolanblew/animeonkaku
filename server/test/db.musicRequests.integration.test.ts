import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { PgMusicRequestRepository } from "../src/music/requests/repository.js";
import type { NewMusicRequest } from "../src/music/requests/types.js";
import type { AmfJob } from "../src/music/animeMusicFetcher/schemas.js";

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

      await repo.recordProviderState(recoverable[0]!.id, { state: "AWAITING_OPERATOR", amfJobId: "amf-finished", providerStatus: "awaiting_selection" }, new Date());
      await repo.recordProviderState(recoverable[0]!.id, { state: "PROCESSING", providerStatus: "processing" }, new Date());
      expect(await repo.findBatch(recoverable[0]!.id)).toMatchObject({ providerStatus: "processing", state: "PROCESSING" });

      await repo.recordProviderState(recoverable[0]!.id, { state: "COMPLETED", amfJobId: "amf-finished", providerStatus: "completed" }, new Date());
      const next = await repo.createOrReplay(newRequest("request-c", "batch-c", "item-c", "u2", "k2"));
      expect(next).toMatchObject({ created: true, request: { id: "request-c" } });
      expect((await pool.query("SELECT id FROM anime_music_requests ORDER BY created_at")).rows).toHaveLength(2);
    });
  });

  it("persists safe delivery evidence idempotently and marks a replayed identity conflict for attention", async () => {
    await withDatabase(async (pool) => {
      await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('u1','one')");
      await pool.query("INSERT INTO animethemes_anime (id,name) VALUES (42,'Show')");
      await pool.query("INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,mapping_state) VALUES ('k1',42,'Show','MAPPED')");
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(newRequest("request-evidence", "batch-evidence", "item-evidence", "u1", "k1"));
      const job = completedJob();

      await repo.recordProviderEvidence("batch-evidence", job, new Date("2026-07-21T12:01:00Z"));
      await repo.recordProviderEvidence("batch-evidence", job, new Date("2026-07-21T12:02:00Z"));

      const batch = await pool.query("SELECT warnings,manifest_evidence FROM anime_music_request_batches WHERE id='batch-evidence'");
      expect(batch.rows[0].warnings).toEqual(["minor metadata warning"]);
      expect(batch.rows[0].manifest_evidence).toMatchObject({ status: "completed_with_warnings", warnings: ["minor metadata warning"] });
      const deliveries = await pool.query("SELECT relative_path,byte_size,sha256,metadata,active,import_state FROM anime_music_request_deliveries WHERE item_id='item-evidence'");
      expect(deliveries.rows).toHaveLength(1);
      expect(deliveries.rows[0]).toMatchObject({ relative_path: "anime-ongaku-staging/request-request-evidence/batch-0/album/01.flac",
        byte_size: "321", sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        metadata: { title: "Track", album: "Album" }, active: true, import_state: "PENDING" });
      expect((await pool.query("SELECT result_status,import_state FROM anime_music_request_items WHERE id='item-evidence'")).rows[0])
        .toMatchObject({ result_status: "delivered", import_state: "PENDING" });

      const possible: AmfJob = { ...job,
        item_results: [{ ...job.item_results[0]!, status: "possible" }],
      };
      await repo.recordProviderEvidence("batch-evidence", possible, new Date("2026-07-21T12:02:30Z"));
      expect((await pool.query("SELECT result_status,import_state,import_error FROM anime_music_request_items WHERE id='item-evidence'")).rows[0])
        .toMatchObject({ result_status: "possible", import_state: "ATTENTION", import_error: "AMF item is not an unambiguous delivered result" });

      const conflict: AmfJob = { ...job,
        item_results: [{ ...job.item_results[0]!, kind: "DRAMA" }],
        deliveries: [{ ...job.deliveries[0]!, kind: "DRAMA" }],
      };
      await repo.recordProviderEvidence("batch-evidence", conflict, new Date("2026-07-21T12:03:00Z"));
      expect((await pool.query("SELECT import_state,import_error FROM anime_music_request_items WHERE id='item-evidence'")).rows[0])
        .toMatchObject({ import_state: "ATTENTION", import_error: "AMF manifest item identity does not match the persisted batch" });
      expect((await pool.query("SELECT import_state,import_error FROM anime_music_request_deliveries WHERE item_id='item-evidence'")).rows[0])
        .toMatchObject({ import_state: "ATTENTION", import_error: "AMF manifest item identity does not match the persisted batch" });
    });
  });
});

function completedJob(): AmfJob {
  const relativePath = "anime-ongaku-staging/request-request-evidence/batch-0/album/01.flac";
  return { id: "amf-evidence", status: "completed_with_warnings",
    destination: "anime-ongaku-staging/request-request-evidence/batch-0", last_progress: 100, source_files: [],
    warnings: ["minor metadata warning"], error_stage: null, has_error: false,
    item_results: [{ requested_item_index: 0, label: "OST", kind: "OST", number: null, status: "delivered",
      candidate_indexes: [], selected_release_indexes: [0], matched_releases: ["Album"], delivered_files: [relativePath], file_count: 1 }],
    deliveries: [{ requested_item_index: 0, label: "OST", kind: "OST", number: null,
      files: [{ file_index: 0, relative_path: relativePath, size: 321, sha256: "A".repeat(64), metadata: { title: "Track", album: "Album" } }] }],
    created_at: "2026-07-21T12:00:00Z", updated_at: "2026-07-21T12:00:30Z", completed_at: "2026-07-21T12:00:30Z" };
}

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
