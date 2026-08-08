import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { PgMusicRequestRepository } from "../src/music/requests/repository.js";
import { AMF_PROVIDER_JOB_FILE_INDEX_STRIDE } from "../src/music/requests/providerGraph.js";
import type { NewMusicRequest, ProviderEvidenceScope, StoredProviderJobLink } from "../src/music/requests/types.js";
import type { AmfJob } from "../src/music/animeMusicFetcher/schemas.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("anime music requests (PostgreSQL)", () => {
  it("counts requestable full themes and related categories conservatively when none are READY", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      await pool.query(`INSERT INTO themes (id,animethemes_anime_id,title,theme_type,audio_origin_url) VALUES
        (11,42,'Opening','OP1','https://example.invalid/op'),
        (12,42,'Ending','ED1','https://example.invalid/ed')`);

      await expect(new PgMusicRequestRepository(pool).getScopeAvailability(42)).resolves.toEqual({
        FULL_SONGS: { eligibleCount: 2, availableCount: 0 },
        EXTRA_MUSIC: { eligibleCount: 4, availableCount: 0 },
      });
    });
  });

  it("runs FULL_SONGS and EXTRA_MUSIC independently while replaying the matching active scope", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      const repo = new PgMusicRequestRepository(pool);
      const full = scopedRequest("full-request", "full-batch", "full-item", "FULL_SONGS", "OP");
      const extra = scopedRequest("extra-request", "extra-batch", "extra-item", "EXTRA_MUSIC", "OST");

      const [createdFull, createdExtra] = await Promise.all([
        repo.createOrReplay(full),
        repo.createOrReplay(extra),
      ]);
      const replayedFull = await repo.createOrReplay(scopedRequest("full-replay", "full-replay-batch", "full-replay-item", "FULL_SONGS", "ED"));

      expect(createdFull).toMatchObject({ created: true, request: { id: "full-request", scope: "FULL_SONGS" } });
      expect(createdExtra).toMatchObject({ created: true, request: { id: "extra-request", scope: "EXTRA_MUSIC" } });
      expect(replayedFull).toMatchObject({ created: false, request: { id: "full-request", scope: "FULL_SONGS" } });
      expect((await pool.query("SELECT scope FROM anime_music_requests ORDER BY scope")).rows)
        .toEqual([{ scope: "EXTRA_MUSIC" }, { scope: "FULL_SONGS" }]);
      await expect(repo.findLatest(42, "FULL_SONGS")).resolves.toMatchObject({ id: "full-request" });
      await expect(repo.findLatest(42, "EXTRA_MUSIC")).resolves.toMatchObject({ id: "extra-request" });
    });
  });

  it("atomically supersedes an awaiting-operator request for an admin re-import", async () => {
    await withDatabase(async (pool) => {
      await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('u1','one')");
      await pool.query("INSERT INTO animethemes_anime (id,name) VALUES (42,'Show')");
      await pool.query("INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,mapping_state) VALUES ('k1',42,'Show','MAPPED')");
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(newRequest("old-request", "old-batch", "old-item", "u1", "k1"));
      await repo.recordProviderState("old-batch", { state: "AWAITING_OPERATOR", amfJobId: "old-amf" }, new Date());

      const fresh = await repo.createOrReplay({
        ...scopedRequest("admin-reimport", "new-batch", "new-item", "FULL_SONGS", "OP"), source: "ADMIN_REIMPORT",
      });

      expect(fresh).toMatchObject({ created: true, request: { id: "admin-reimport" } });
      expect((await pool.query("SELECT state FROM anime_music_request_batches WHERE id='old-batch'")).rows[0]?.state).toBe("CANCELLED");
      expect((await pool.query("SELECT completed_at FROM anime_music_requests WHERE id='old-request'")).rows[0]?.completed_at).not.toBeNull();
    });
  });

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
      expect(await repo.listRecheckableBatches()).toMatchObject([{ id: recoverable[0]!.id, state: "AWAITING_OPERATOR", amfJobId: "amf-finished" }]);
      await repo.recordProviderState(recoverable[0]!.id, { state: "PROCESSING", providerStatus: "processing" }, new Date());
      expect(await repo.findBatch(recoverable[0]!.id)).toMatchObject({ providerStatus: "processing", state: "PROCESSING" });

      await repo.recordProviderState(recoverable[0]!.id, { state: "COMPLETED", amfJobId: "amf-finished", providerStatus: "completed" }, new Date());
      expect(await repo.listRecheckableBatches()).toEqual([]);
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

describe.skipIf(!adminDatabaseUrl)("anime music provider job graph (PostgreSQL)", () => {
  it("persists and replays a batch's provider job graph, keeping adoption idempotent", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(twoItemRequest("request-graph", "batch-graph"));
      await repo.recordProviderState("batch-graph", { state: "PROCESSING", amfJobId: "amf-root" }, new Date());

      const root = rootLink("batch-graph", "amf-root");
      const child = childLink("batch-graph", "child-a", "amf-root", 1, 1, 1);
      await repo.saveProviderJobs("batch-graph", [root, child], new Date("2026-07-26T00:00:00Z"));
      // Re-observing the same graph must update in place, never duplicate.
      await repo.saveProviderJobs("batch-graph", [
        { ...root, providerStatus: "completed_with_warnings" },
        { ...child, providerStatus: "awaiting_selection" },
      ], new Date("2026-07-26T00:05:00Z"));

      const stored = await repo.listProviderJobs("batch-graph");
      expect(stored.map((link) => [link.amfJobId, link.role, link.ordinal, link.itemIndex, link.fileIndexOffset])).toEqual([
        ["amf-root", "ROOT", 0, null, 0],
        ["child-a", "FOLLOW_UP", 1, 1, AMF_PROVIDER_JOB_FILE_INDEX_STRIDE],
      ]);
      expect(stored[1]).toMatchObject({ parentAmfJobId: "amf-root", parentItemIndex: 1, depth: 1 });
      // The batch keeps its root identity for backward compatibility.
      expect((await repo.findBatch("batch-graph"))?.amfJobId).toBe("amf-root");
    });
  });

  it("attributes a single-item follow-up job onto its parent batch item without tripping the identity guard", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(twoItemRequest("request-child", "batch-child"));

      // The parent delegates item 1 and delivers nothing for it.
      await repo.recordProviderEvidence("batch-child", delegatingParentJob(), new Date("2026-07-26T00:00:00Z"));
      const afterParent = await itemRows(pool, "batch-child");
      expect(afterParent[1]).toMatchObject({ result_status: "delegated", import_state: "PENDING", import_error: null });

      // The child then delivers it, reported as its own item index 0.
      await repo.recordProviderEvidence("batch-child", childDeliveryJob(), new Date("2026-07-26T00:01:00Z"), childScope());

      const afterChild = await itemRows(pool, "batch-child");
      expect(afterChild[0]).toMatchObject({ result_status: "delivered", import_state: "PENDING" });
      expect(afterChild[1]).toMatchObject({ result_status: "delivered", import_state: "PENDING", import_error: null });
      const deliveries = await pool.query("SELECT item_id,file_index,relative_path,active,import_state FROM anime_music_request_deliveries ORDER BY file_index");
      expect(deliveries.rows).toMatchObject([
        { item_id: "item-child-0", file_index: 0, active: true, import_state: "PENDING" },
        { item_id: "item-child-1", file_index: AMF_PROVIDER_JOB_FILE_INDEX_STRIDE, active: true, import_state: "PENDING" },
      ]);
    });
  });

  it("keeps a follow-up job from deactivating its parent's deliveries into other items", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(twoItemRequest("request-scope", "batch-scope"));
      await repo.recordProviderEvidence("batch-scope", delegatingParentJob("batch-scope", "request-scope"), new Date("2026-07-26T00:00:00Z"));
      await repo.recordProviderEvidence("batch-scope", childDeliveryJob("batch-scope", "request-scope"), new Date("2026-07-26T00:01:00Z"), childScope());

      // A later child-only observation must leave item 0's delivery active.
      await repo.recordProviderEvidence("batch-scope", childDeliveryJob("batch-scope", "request-scope"), new Date("2026-07-26T00:02:00Z"), childScope());

      const deliveries = await pool.query("SELECT item_id,active FROM anime_music_request_deliveries ORDER BY file_index");
      expect(deliveries.rows).toMatchObject([{ item_id: "item-scope-0", active: true }, { item_id: "item-scope-1", active: true }]);
    });
  });

  it("still raises the identity guard for a genuine manifest mismatch, contained to the offending job's scope", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(twoItemRequest("request-guard", "batch-guard"));
      await repo.recordProviderEvidence("batch-guard", delegatingParentJob("batch-guard", "request-guard"), new Date("2026-07-26T00:00:00Z"));

      // The child reports a kind/number that is not the persisted item 1.
      const mismatched: AmfJob = {
        ...childDeliveryJob("batch-guard", "request-guard"),
        item_results: [{ requested_item_index: 1, label: "OP1", kind: "OP", number: 1, status: "delivered",
          candidate_indexes: [], selected_release_indexes: [], matched_releases: [], delivered_files: [], file_count: 1 }],
        deliveries: [],
      };
      await repo.recordProviderEvidence("batch-guard", mismatched, new Date("2026-07-26T00:01:00Z"), childScope());

      const rows = await itemRows(pool, "batch-guard");
      expect(rows[1]).toMatchObject({ import_state: "ATTENTION", import_error: "AMF manifest item identity does not match the persisted batch" });
      // Its healthy sibling is untouched: one bad follow-up must not strand the batch.
      expect(rows[0]).toMatchObject({ import_state: "PENDING", import_error: null });
    });
  });

  it("raises the identity guard when a follow-up job writes outside its own file-index window", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(twoItemRequest("request-window", "batch-window"));
      const escaping: AmfJob = {
        ...childDeliveryJob("batch-window", "request-window"),
        deliveries: [{ requested_item_index: 1, label: "ED3", kind: "ED", number: 3, files: [
          // file_index 0 belongs to the ROOT's window, not this child's.
          { file_index: 0, relative_path: "anime-ongaku-staging/request-request-window/batch-0/ed3.flac", size: 5, sha256: "e".repeat(64), metadata: {} },
        ] }],
      };
      await repo.recordProviderEvidence("batch-window", escaping, new Date("2026-07-26T00:01:00Z"), childScope());

      expect((await itemRows(pool, "batch-window"))[1])
        .toMatchObject({ import_state: "ATTENTION", import_error: "AMF manifest item identity does not match the persisted batch" });
      expect((await pool.query("SELECT count(*) FROM anime_music_request_deliveries")).rows[0].count).toBe("0");
    });
  });

  it("keeps two sibling follow-up jobs covering the same parent item from colliding on delivery identity", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(twoItemRequest("request-siblings", "batch-siblings"));
      const first = childDeliveryJob("batch-siblings", "request-siblings");
      const second: AmfJob = {
        ...first, id: "child-b",
        deliveries: [{ requested_item_index: 1, label: "ED3", kind: "ED", number: 3, files: [
          { file_index: 2 * AMF_PROVIDER_JOB_FILE_INDEX_STRIDE,
            relative_path: "anime-ongaku-staging/request-request-siblings/batch-0/ed3-alt.flac",
            size: 7, sha256: "f".repeat(64), metadata: {} },
        ] }],
      };

      await repo.recordProviderEvidence("batch-siblings", first, new Date("2026-07-26T00:01:00Z"), childScope());
      await repo.recordProviderEvidence("batch-siblings", second, new Date("2026-07-26T00:02:00Z"),
        { itemIndexes: [1], fileIndexOffset: 2 * AMF_PROVIDER_JOB_FILE_INDEX_STRIDE, fileIndexStride: AMF_PROVIDER_JOB_FILE_INDEX_STRIDE });

      const deliveries = await pool.query("SELECT file_index,relative_path,active FROM anime_music_request_deliveries WHERE item_id='item-siblings-1' ORDER BY file_index");
      expect(deliveries.rows).toMatchObject([
        { file_index: AMF_PROVIDER_JOB_FILE_INDEX_STRIDE, active: true },
        { file_index: 2 * AMF_PROVIDER_JOB_FILE_INDEX_STRIDE, active: true },
      ]);
    });
  });

  it("adopts an already-submitted batch as the root of its own graph when migration 0017 runs", async () => {
    await withDatabase(async (pool) => {
      await seedAnime(pool);
      const repo = new PgMusicRequestRepository(pool);
      await repo.createOrReplay(twoItemRequest("request-adopt", "batch-adopt"));
      await repo.recordProviderState("batch-adopt", { state: "AWAITING_OPERATOR", amfJobId: "amf-live-root", providerStatus: "completed_with_warnings" }, new Date());

      // Re-running the migration's adoption statement is exactly what happens
      // to the 10 live root jobs the first time this ships.
      await pool.query(`INSERT INTO anime_music_request_batch_jobs
        (id,batch_id,amf_job_id,role,ordinal,depth,parent_amf_job_id,parent_item_index,item_index,file_index_offset,
         provider_status,destination,manifest_evidence,created_at,updated_at)
        SELECT b.id || ':' || b.amf_job_id,b.id,b.amf_job_id,'ROOT',0,0,NULL,NULL,NULL,0,
          b.manifest_evidence->>'status',b.amf_request_body->>'destination',COALESCE(b.manifest_evidence,'{}'::jsonb),b.created_at,b.updated_at
        FROM anime_music_request_batches b WHERE b.amf_job_id IS NOT NULL ON CONFLICT DO NOTHING`);

      const stored = await repo.listProviderJobs("batch-adopt");
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ amfJobId: "amf-live-root", role: "ROOT", ordinal: 0, itemIndex: null, fileIndexOffset: 0 });
      expect(stored[0]?.destination).toBe("anime-ongaku-staging/request-request-adopt/batch-0");
    });
  });
});

function rootLink(batchId: string, amfJobId: string): StoredProviderJobLink {
  return { batchId, amfJobId, role: "ROOT", ordinal: 0, depth: 0, parentAmfJobId: null, parentItemIndex: null,
    itemIndex: null, fileIndexOffset: 0, providerStatus: null, destination: `anime-ongaku-staging/request-x/batch-0`,
    manifestEvidence: { status: null, itemResults: [], deliveries: [] }, goneAt: null, lastPolledAt: null };
}
function childLink(batchId: string, amfJobId: string, parentAmfJobId: string, parentItemIndex: number, itemIndex: number, ordinal: number): StoredProviderJobLink {
  return { batchId, amfJobId, role: "FOLLOW_UP", ordinal, depth: 1, parentAmfJobId, parentItemIndex, itemIndex,
    fileIndexOffset: ordinal * AMF_PROVIDER_JOB_FILE_INDEX_STRIDE, providerStatus: null,
    destination: `anime-ongaku-staging/request-x/batch-0`,
    manifestEvidence: { status: null, itemResults: [], deliveries: [] }, goneAt: null, lastPolledAt: null };
}
function childScope(): ProviderEvidenceScope {
  return { itemIndexes: [1], fileIndexOffset: AMF_PROVIDER_JOB_FILE_INDEX_STRIDE, fileIndexStride: AMF_PROVIDER_JOB_FILE_INDEX_STRIDE };
}
async function itemRows(pool: Pool, batchId: string) {
  const result = await pool.query("SELECT item_index,result_status,import_state,import_error FROM anime_music_request_items WHERE batch_id=$1 ORDER BY item_index", [batchId]);
  return result.rows;
}
async function seedAnime(pool: Pool) {
  await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('u1','one')");
  await pool.query("INSERT INTO animethemes_anime (id,name) VALUES (42,'Show')");
  await pool.query("INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,mapping_state) VALUES ('k1',42,'Show','MAPPED')");
}

/** A root job that delivered item 0 and delegated item 1, like live ef75e439. */
function delegatingParentJob(batchId = "batch-child", requestId = "request-child"): AmfJob {
  const suffix = batchId.replace("batch-", "");
  const relativePath = `anime-ongaku-staging/request-${requestId}/batch-0/ost.flac`;
  return { ...completedJob(), id: `amf-root-${suffix}`, destination: `anime-ongaku-staging/request-${requestId}/batch-0`,
    item_results: [
      { requested_item_index: 0, label: "OST", kind: "OST", number: null, status: "delivered",
        candidate_indexes: [], selected_release_indexes: [0], matched_releases: [], delivered_files: [relativePath], file_count: 1 },
      { requested_item_index: 1, label: "ED3", kind: "ED", number: 3, status: "delegated",
        candidate_indexes: [], selected_release_indexes: [], matched_releases: [], delivered_files: [], file_count: 0,
        follow_up_job_id: "child-a" },
    ],
    deliveries: [{ requested_item_index: 0, label: "OST", kind: "OST", number: null, files: [
      { file_index: 0, relative_path: relativePath, size: 321, sha256: "a".repeat(64), metadata: { title: "Track" } }] }],
    follow_up_jobs: [{ job_id: "child-a", requested_item_index: 1, label: "ED3" }] };
}

/**
 * A single-item follow-up job already projected onto the batch's coordinates:
 * item index 1, file indexes shifted into the child's own window. This is what
 * `projectProviderJobEvidence` hands the repository.
 */
function childDeliveryJob(batchId = "batch-child", requestId = "request-child"): AmfJob {
  const relativePath = `anime-ongaku-staging/request-${requestId}/batch-0/ed3.flac`;
  void batchId;
  return { ...completedJob(), id: "child-a", status: "completed", destination: `anime-ongaku-staging/request-${requestId}/batch-0`,
    parent_job_id: "amf-root", parent_item_index: 1,
    item_results: [{ requested_item_index: 1, label: "ED3", kind: "ED", number: 3, status: "delivered",
      candidate_indexes: [], selected_release_indexes: [0], matched_releases: [], delivered_files: [relativePath], file_count: 1 }],
    deliveries: [{ requested_item_index: 1, label: "ED3", kind: "ED", number: 3, files: [
      { file_index: AMF_PROVIDER_JOB_FILE_INDEX_STRIDE, relative_path: relativePath, size: 42, sha256: "b".repeat(64), metadata: {} }] }],
    warnings: [] };
}

function twoItemRequest(id: string, batchId: string): NewMusicRequest {
  const suffix = batchId.replace("batch-", "");
  return { id, requestedByUserId: "u1", kitsuId: "k1", animeThemesAnimeId: 42, source: "DEBUG_USER", scope: "LEGACY_ALL", batches: [{
    id: batchId, index: 0, idempotencyKey: `anime-ongaku:${id}:0`,
    body: { titles: { romaji: "Show" }, items: [{ kind: "OST" }, { kind: "ED", number: 3 }], destination: `anime-ongaku-staging/request-${id}/batch-0` },
    items: [
      { id: `item-${suffix}-0`, itemIndex: 0, kind: "OST", number: null, themeId: null },
      { id: `item-${suffix}-1`, itemIndex: 1, kind: "ED", number: 3, themeId: null },
    ],
  }] };
}

function completedJob(): AmfJob {
  const relativePath = "anime-ongaku-staging/request-request-evidence/batch-0/album/01.flac";
  return { id: "amf-evidence", status: "completed_with_warnings",
    destination: "anime-ongaku-staging/request-request-evidence/batch-0", last_progress: 100, source_files: [],
    parent_job_id: null, parent_item_index: null, follow_up_jobs: [],
    warnings: ["minor metadata warning"], error_stage: null, has_error: false,
    item_results: [{ requested_item_index: 0, label: "OST", kind: "OST", number: null, status: "delivered",
      candidate_indexes: [], selected_release_indexes: [0], matched_releases: ["Album"], delivered_files: [relativePath], file_count: 1 }],
    deliveries: [{ requested_item_index: 0, label: "OST", kind: "OST", number: null,
      files: [{ file_index: 0, relative_path: relativePath, size: 321, sha256: "A".repeat(64), metadata: { title: "Track", album: "Album" } }] }],
    created_at: "2026-07-21T12:00:00Z", updated_at: "2026-07-21T12:00:30Z", completed_at: "2026-07-21T12:00:30Z" };
}

function newRequest(id: string, batchId: string, itemId: string, userId: string, kitsuId: string): NewMusicRequest {
  return { id, requestedByUserId: userId, kitsuId, animeThemesAnimeId: 42, source: "DEBUG_USER", scope: "LEGACY_ALL", batches: [{
    id: batchId, index: 0, idempotencyKey: `anime-ongaku:${id}:0`,
    body: { titles: { romaji: "Show" }, items: [{ kind: "OST" }], destination: `anime-ongaku-staging/request-${id}/batch-0` },
    items: [{ id: itemId, itemIndex: 0, kind: "OST", number: null, themeId: null }],
  }] };
}

function scopedRequest(id: string, batchId: string, itemId: string, scope: "FULL_SONGS" | "EXTRA_MUSIC", kind: "OP" | "ED" | "OST"): NewMusicRequest {
  const numbered = kind === "OP" || kind === "ED";
  return { id, requestedByUserId: "u1", kitsuId: "k1", animeThemesAnimeId: 42, source: "DEBUG_USER", scope, batches: [{
    id: batchId, index: 0, idempotencyKey: `anime-ongaku:${id}:0`,
    body: { titles: { romaji: "Show" }, items: [{ kind, ...(numbered ? { number: 1, version: "FULL" as const, release_preference: "INDIVIDUAL" as const } : {}) }], destination: `anime-ongaku-staging/request-${id}/batch-0` },
    items: [{ id: itemId, itemIndex: 0, kind, number: numbered ? 1 : null, themeId: null }],
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
