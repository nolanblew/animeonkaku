import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { DrizzleMediaFileRepo } from "../src/media/pgMediaFileRepo.js";
import { MediaStore } from "../src/media/mediaStore.js";
import { AmfDeliveryImportService, PgAmfDeliveryRepository } from "../src/music/requests/deliveryService.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("AMF delivery publication (PostgreSQL + filesystem)", () => {
  it("publishes Full/Related only after READY and reuses exact duplicate bytes across related items", async () => {
    await withDatabase(async (pool) => {
      const libraryRoot = await mkdtemp(join(tmpdir(), "ongaku-amf-pg-library-"));
      const mediaRoot = await mkdtemp(join(tmpdir(), "ongaku-amf-pg-media-"));
      const bytes = Buffer.alloc(4096, 19);
      const sha = createHash("sha256").update(bytes).digest("hex");
      await seedCatalog(pool);
      const repo = new PgAmfDeliveryRepository(pool);
      const mediaStore = new MediaStore({ mediaRoot, providerImportRoot: libraryRoot,
        repo: new DrizzleMediaFileRepo(drizzle(pool)), minBytes: 1 });
      const service = new AmfDeliveryImportService({ repo, mediaStore, libraryRoot });

      const fullPath = "anime-ongaku-staging/request-full/batch-0/opening.flac";
      await stage(libraryRoot, fullPath, bytes);
      await seedRequest(pool, { requestId: "request-full", batchId: "batch-full", items: [{
        id: "item-full", index: 0, kind: "OP", number: 1, themeId: 100, fileIndex: 1, relativePath: fullPath,
        metadata: { title: "Opening Full", artist: "Singer", album: "Theme Single" }, sha,
      }] });
      expect((await pool.query("SELECT count(*)::int count FROM theme_full_songs")).rows[0].count).toBe(0);
      const publish = repo.publishDelivery.bind(repo);
      let crashOnce = true;
      repo.publishDelivery = async (deliveryId) => {
        if (crashOnce) { crashOnce = false; throw new Error("simulated crash after READY copy"); }
        await publish(deliveryId);
      };
      await expect(service.importBatch("batch-full")).rejects.toThrow("simulated crash after READY copy");
      expect((await pool.query("SELECT count(*)::int count FROM theme_full_songs")).rows[0].count).toBe(0);
      expect((await pool.query("SELECT count(*)::int count FROM media_files WHERE state='READY'")).rows[0].count).toBe(1);
      expect(await service.importBatch("batch-full")).toBe("COMPLETED");
      const full = await pool.query<any>(`SELECT d.song_id,d.import_state,i.import_state item_state,b.state batch_state,
        a.state acquisition_state,m.state media_state,tfs.theme_id
        FROM anime_music_request_deliveries d JOIN anime_music_request_items i ON i.id=d.item_id
        JOIN anime_music_request_batches b ON b.id=i.batch_id JOIN music_acquisitions a ON a.id=i.acquisition_id
        JOIN media_files m ON m.ref_id=('song:' || d.song_id::text) AND m.variant='ORIGINAL'
        JOIN theme_full_songs tfs ON tfs.song_id=d.song_id WHERE d.id='item-full:1'`);
      expect(full.rows[0]).toMatchObject({ import_state: "READY", item_state: "READY", batch_state: "COMPLETED",
        acquisition_state: "READY", media_state: "READY", theme_id: "100" });
      expect(await readFile(join(mediaRoot, `audio/songs/${full.rows[0].song_id}/original.flac`))).toEqual(bytes);

      const ostPath = "anime-ongaku-staging/request-related/batch-0/ost.flac";
      const ostPath2 = "anime-ongaku-staging/request-related/batch-0/ost-2.flac";
      const characterPath = "anime-ongaku-staging/request-related/batch-0/character.flac";
      await stage(libraryRoot, ostPath, bytes);
      const secondBytes = Buffer.alloc(4096, 23);
      const secondSha = createHash("sha256").update(secondBytes).digest("hex");
      await stage(libraryRoot, ostPath2, secondBytes);
      await stage(libraryRoot, characterPath, bytes);
      await seedRequest(pool, { requestId: "request-related", batchId: "batch-related", items: [
        { id: "item-ost", index: 0, kind: "OST", number: null, themeId: null, fileIndex: 3, relativePath: ostPath,
          metadata: { title: "Shared Song", artist: "Band", albumartist: "Soundtrack Cast", album: "OST" }, sha },
        { id: "item-character", index: 1, kind: "CHARACTER_SONG", number: null, themeId: null, fileIndex: 4, relativePath: characterPath,
          metadata: { title: "Shared Song", artist: "Band", album: "Character Album" }, sha },
      ] });
      await pool.query(`INSERT INTO anime_music_request_deliveries
        (id,item_id,file_index,relative_path,byte_size,sha256,metadata)
        VALUES ('item-ost:5','item-ost',5,$1,4096,$2,$3::jsonb)`,
        [ostPath2, secondSha, JSON.stringify({ title: "Second OST Song", artist: "Guest Singer", albumartist: "Soundtrack Cast", album: "OST" })]);
      expect((await pool.query("SELECT count(*)::int count FROM anime_music_releases WHERE animethemes_anime_id=42")).rows[0].count).toBe(0);
      const firstOst = await repo.reserveCatalog("item-ost:3", { byteSize: bytes.length, sha256: sha });
      await mediaStore.importLocalSongFile({ songId: firstOst.songId, sourcePath: join(libraryRoot, ...ostPath.split("/")),
        expectedByteSize: bytes.length, expectedSha256: sha });
      await repo.publishDelivery("item-ost:3");
      expect((await pool.query("SELECT count(*)::int count FROM anime_music_releases WHERE animethemes_anime_id=42")).rows[0].count).toBe(1);
      expect((await pool.query("SELECT import_state FROM anime_music_request_items WHERE id='item-ost'")).rows[0].import_state).toBe("IMPORTING");
      expect(await service.importBatch("batch-related")).toBe("COMPLETED");
      const related = await pool.query<any>(`SELECT d.song_id,d.release_id,d.import_state,a.state acquisition_state
        FROM anime_music_request_deliveries d JOIN anime_music_request_items i ON i.id=d.item_id
        JOIN music_acquisitions a ON a.id=i.acquisition_id WHERE i.batch_id='batch-related' ORDER BY i.item_index`);
      expect(related.rows).toHaveLength(3);
      expect(new Set(related.rows.map((row) => String(row.song_id))).size).toBe(2);
      expect(new Set(related.rows.map((row) => String(row.release_id))).size).toBe(2);
      expect(related.rows.every((row) => row.import_state === "READY" && row.acquisition_state === "READY")).toBe(true);
      expect((await pool.query("SELECT count(*)::int count FROM anime_music_releases WHERE animethemes_anime_id=42")).rows[0].count).toBe(2);

      // Publication/copy replay is idempotent and preserves the same catalog identities.
      expect(await service.importBatch("batch-related")).toBe("COMPLETED");
      expect((await pool.query("SELECT count(*)::int count FROM songs")).rows[0].count).toBe(2);
      expect((await pool.query("SELECT count(*)::int count FROM music_acquisitions WHERE provider='AMF'")).rows[0].count).toBe(3);
    });
  });

  it("closes an unsupported-format delivery as COMPLETED_WITH_WARNINGS instead of stranding the request in AWAITING_OPERATOR (F6/MC-S18)", async () => {
    await withDatabase(async (pool) => {
      const libraryRoot = await mkdtemp(join(tmpdir(), "ongaku-amf-pg-library-"));
      const mediaRoot = await mkdtemp(join(tmpdir(), "ongaku-amf-pg-media-"));
      await seedCatalog(pool);
      const repo = new PgAmfDeliveryRepository(pool);
      const mediaStore = new MediaStore({ mediaRoot, providerImportRoot: libraryRoot,
        repo: new DrizzleMediaFileRepo(drizzle(pool)), minBytes: 1 });
      const service = new AmfDeliveryImportService({ repo, mediaStore, libraryRoot });

      // AMF is only asked to prefer importable formats (MC-S17), but the
      // importer keeps this as defence in depth: an APE delivery reaches us
      // anyway. No bytes need to exist on disk — the extension is rejected
      // before any file is read.
      await seedRequest(pool, { requestId: "request-unsupported", batchId: "batch-unsupported", items: [{
        id: "item-unsupported", index: 0, kind: "OST", number: null, themeId: null, fileIndex: 0,
        relativePath: "anime-ongaku-staging/request-related/batch-0/album.ape",
        metadata: { title: "Unsupported Track" }, sha: null,
      }] });

      expect(await service.importBatch("batch-unsupported")).toBe("COMPLETED_WITH_WARNINGS");

      const row = await pool.query<any>(`SELECT i.import_state item_state, i.import_error item_error,
        d.import_state delivery_state, d.import_error delivery_error, d.metadata,
        b.state batch_state, b.completed_at batch_completed_at, r.completed_at request_completed_at
        FROM anime_music_request_deliveries d JOIN anime_music_request_items i ON i.id=d.item_id
        JOIN anime_music_request_batches b ON b.id=i.batch_id JOIN anime_music_requests r ON r.id=b.request_id
        WHERE i.id='item-unsupported'`);
      expect(row.rows[0]).toMatchObject({ item_state: "ATTENTION", delivery_state: "ATTENTION", batch_state: "COMPLETED_WITH_WARNINGS" });
      expect(row.rows[0].item_error).toMatch(/AMF_UNSUPPORTED_FORMAT:/);
      expect(row.rows[0].delivery_error).toMatch(/AMF_UNSUPPORTED_FORMAT:/);
      expect(row.rows[0].metadata.amfClassification).toBe("UNSUPPORTED_FORMAT");
      // Terminal at both the batch and the request level — this is the F6
      // "closable, does not strand" proof: nothing an operator can do on the
      // Anime Ongaku side resolves this, so it must not block completion.
      expect(row.rows[0].batch_completed_at).not.toBeNull();
      expect(row.rows[0].request_completed_at).not.toBeNull();

      // Re-running the import (crash-recovery replay) is a no-op that neither
      // re-reads a (nonexistent) file nor changes the outcome.
      expect(await service.importBatch("batch-unsupported")).toBe("COMPLETED_WITH_WARNINGS");
    });
  });
});

async function seedCatalog(pool: Pool) {
  await pool.query("INSERT INTO users (kitsu_user_id,username) VALUES ('u','user')");
  await pool.query("INSERT INTO animethemes_anime (id,name) VALUES (42,'Show')");
  await pool.query("INSERT INTO kitsu_anime (kitsu_id,animethemes_anime_id,title,mapping_state) VALUES ('k',42,'Show','MAPPED')");
  await pool.query(`INSERT INTO themes (id,animethemes_anime_id,title,theme_type,audio_origin_url)
    VALUES (100,42,'Opening','OP1','https://example.invalid/opening.ogg')`);
}

async function seedRequest(pool: Pool, input: { requestId: string; batchId: string; items: Array<any> }) {
  const destination = `anime-ongaku-staging/${input.requestId === "request-full" ? "request-full" : "request-related"}/batch-0`;
  await pool.query(`INSERT INTO anime_music_requests (id,requested_by_user_id,kitsu_id,animethemes_anime_id,source)
    VALUES ($1,'u','k',42,'DEBUG_USER')`, [input.requestId]);
  const bodyItems = input.items.map((item) => ({ kind: item.kind, number: item.number,
    ...(item.kind === "OP" || item.kind === "ED" ? { version: "FULL", song_titles: { romaji: "Opening" }, artists: ["Singer"] } : {}) }));
  await pool.query(`INSERT INTO anime_music_request_batches
    (id,request_id,batch_index,state,amf_request_body,idempotency_key,manifest_evidence)
    VALUES ($1,$2,0,'PROCESSING',$3::jsonb,$4,'{"status":"completed"}'::jsonb)`,
    [input.batchId, input.requestId, JSON.stringify({ titles: { romaji: "Show" }, items: bodyItems, destination }), `key:${input.requestId}`]);
  for (const item of input.items) {
    await pool.query(`INSERT INTO anime_music_request_items
      (id,batch_id,item_index,kind,number,theme_id,result_status,import_state)
      VALUES ($1,$2,$3,$4,$5,$6,'delivered','PENDING')`,
      [item.id, input.batchId, item.index, item.kind, item.number, item.themeId]);
    await pool.query(`INSERT INTO anime_music_request_deliveries
      (id,item_id,file_index,relative_path,byte_size,sha256,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [`${item.id}:${item.fileIndex}`, item.id, item.fileIndex, item.relativePath, 4096, item.sha, JSON.stringify(item.metadata)]);
  }
}

async function stage(root: string, relativePath: string, bytes: Buffer) {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
}

async function withDatabase(run: (pool: Pool) => Promise<void>) {
  const name = `ongaku_amf_delivery_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const admin = new Client({ connectionString: adminDatabaseUrl });
  const url = new URL(adminDatabaseUrl!); url.pathname = `/${name}`;
  let pool: Pool | undefined;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    pool = new Pool({ connectionString: url.toString() });
    await runMigrations(drizzle(pool));
    await run(pool);
  } finally {
    await pool?.end();
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [name]);
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
}
