import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { JobQueue } from "../src/jobs/jobQueue.js";
import { PgJobRepository } from "../src/jobs/pgJobRepository.js";
import { DrizzleSyncRepository } from "../src/sync/drizzleSyncRepository.js";
import { mapThemesDedupeKey } from "../src/sync/syncJobKeys.js";
import type { KitsuAnimeEntry } from "../src/kitsu/types.js";
import type { AnimeThemeEntry } from "../src/animethemes/types.js";

const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminUrl)("durable sync stages (PostgreSQL)", () => {
  const name = `ongaku_sync_${randomUUID().replaceAll("-", "")}`;
  let admin: Client;
  let pool: Pool;
  let repo: DrizzleSyncRepository;
  let queue: JobQueue;
  const now = new Date("2026-10-21T12:00:00Z");

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(adminUrl!); url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString() });
    const db = drizzle(pool);
    await runMigrations(db);
    repo = new DrizzleSyncRepository(db);
    queue = new JobQueue(new PgJobRepository(pool), { now: () => now });
  }, 60_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE jobs, users, kitsu_anime, animethemes_anime RESTART IDENTITY CASCADE");
    await pool.query("INSERT INTO users (kitsu_user_id, username) VALUES ('u1','test')");
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]);
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });

  it("imports 665 entries with bounded independent mapping keys and durable playlist intent", async () => {
    const entries = Array.from({ length: 665 }, (_, i) => entry(String(i + 1)));
    await repo.commitLibraryImport({ userId: "u1", entries, activeKitsuIds: entries.map((e) => e.id),
      forceCatalog: true, startedAt: now, completedAt: now });
    expect((await pool.query("SELECT count(*) FROM library_entries")).rows[0].count).toBe("665");
    const mapping = await pool.query("SELECT dedupe_key, payload FROM jobs WHERE type = 'MAP_THEMES'");
    expect(mapping.rows).toHaveLength(665);
    expect(mapping.rows.every((row) => row.dedupe_key.length === 75 && row.payload.kitsuIds.length === 1)).toBe(true);
    expect((await repo.getUserSyncAuth("u1"))?.lastStatusSyncAt).toEqual(now);
    expect((await queue.list()).some((job) => job.type === "AUTO_PLAYLIST_REFRESH")).toBe(true);
    expect(mapThemesDedupeKey("u1", entries.map((e) => e.id))).toHaveLength(75);
    expect(mapThemesDedupeKey("u1", ["2", "1", "1"])).toBe(mapThemesDedupeKey("u1", ["1", "2"]));
  }, 120_000);

  it("rolls back imported rows, tombstones and watermark if downstream intent persistence fails", async () => {
    await repo.upsertKitsuAnime([entry("old")]);
    await repo.upsertLibraryEntries("u1", [entry("old")]);
    await rejectPlaylistIntents();
    try {
      await expect(repo.commitLibraryImport({ userId: "u1", entries: [entry("new")], activeKitsuIds: ["new"],
        forceCatalog: true, startedAt: now, completedAt: now })).rejects.toThrow();
      expect((await pool.query("SELECT kitsu_id, deleted_at FROM library_entries")).rows).toEqual([{ kitsu_id: "old", deleted_at: null }]);
      expect((await repo.getUserSyncAuth("u1"))?.lastStatusSyncAt).toBeNull();
      expect((await pool.query("SELECT count(*) FROM jobs")).rows[0].count).toBe("0");
    } finally { await allowPlaylistIntents(); }
  });

  it("commits mappings, metadata and playlist intent together and rolls all back on outbox failure", async () => {
    await repo.upsertKitsuAnime([entry("1")]);
    const input = { userId: "u1", kitsuIds: ["1"], themes: [theme()], mappings: new Map([["1", 10]]),
      genres: new Map([["1", [{ slug: "action", displayName: "Action", source: "category" }]]]), checkedAt: now };
    await rejectPlaylistIntents();
    try {
      await expect(repo.commitCatalogResult(input)).rejects.toThrow();
      expect((await pool.query("SELECT animethemes_anime_id, catalog_checked_at FROM kitsu_anime")).rows[0])
        .toEqual({ animethemes_anime_id: null, catalog_checked_at: null });
      expect((await pool.query("SELECT count(*) FROM themes")).rows[0].count).toBe("0");
    } finally { await allowPlaylistIntents(); }
    await repo.commitCatalogResult(input);
    expect((await pool.query("SELECT animethemes_anime_id FROM kitsu_anime")).rows[0].animethemes_anime_id).toBe("10");
    expect((await queue.list()).map((j) => j.type)).toEqual(["AUTO_PLAYLIST_REFRESH"]);
  });

  it("keeps retry backoff/error across maintenance imports and recovers another anime independently", async () => {
    await repo.commitLibraryImport({ userId: "u1", entries: [entry("1"), entry("2")], forceCatalog: true, startedAt: now, completedAt: now });
    const key = mapThemesDedupeKey("u1", ["1"]);
    const failing = (await queue.findByDedupeKey(key))!;
    await pool.query("UPDATE jobs SET state = 'RUNNING' WHERE id = $1", [failing.id]);
    await queue.failRetryable(failing, new Error("catalog unavailable"));
    const retry = (await queue.findByDedupeKey(key))!;
    await repo.commitLibraryImport({ userId: "u1", entries: [], activeKitsuIds: ["1", "2"], forceCatalog: false, startedAt: now, completedAt: now });
    const after = (await queue.findByDedupeKey(key))!;
    expect([after.attempts, after.lastError, after.nextRunAt]).toEqual([retry.attempts, retry.lastError, retry.nextRunAt]);
    await repo.commitCatalogResult({ userId: "u1", kitsuIds: ["2"], themes: [theme()], mappings: new Map([["2", 10]]), genres: new Map(), checkedAt: now });
    expect((await pool.query("SELECT mapping_state FROM kitsu_anime WHERE kitsu_id = '2'")).rows[0].mapping_state).toBe("MAPPED");
    expect((await queue.findByDedupeKey(key))?.lastError).toBe("catalog unavailable");
  });

  it("preserves a real change during RUNNING and across restart, while repeated timer requests do not replay", async () => {
    const input = { type: "AUTO_PLAYLIST_REFRESH" as const, priority: 10, payload: { userId: "u1" },
      dedupeKey: "AUTO_PLAYLIST_REFRESH:u1", preserveRetryState: true };
    const first = await queue.enqueue(input);
    await queue.claimNext();
    await queue.enqueue(input);
    await queue.complete(first.id);
    expect((await queue.findByDedupeKey(input.dedupeKey))?.state).toBe("DONE");
    await queue.enqueue(input); await queue.claimNext();
    await queue.enqueue({ ...input, rerunIfRunning: true });
    await queue.recoverRunningJobs();
    await queue.claimNext(); await queue.complete(first.id);
    expect((await queue.findByDedupeKey(input.dedupeKey))?.state).toBe("QUEUED");
    await queue.claimNext(); await queue.complete(first.id);
    expect((await queue.findByDedupeKey(input.dedupeKey))?.state).toBe("DONE");
  });

  it("upgrades a queued periodic full to an explicit catalog refresh without erasing retry state", async () => {
    const input = { type: "KITSU_FULL_SYNC" as const, priority: 10, payload: { userId: "u1", reconcileOnly: true },
      dedupeKey: "KITSU_SYNC:u1", preserveRetryState: true };
    const job = await queue.enqueue(input); await queue.claimNext();
    await queue.failRetryable(job, new Error("temporary Kitsu failure"));
    const before = (await queue.findByDedupeKey(input.dedupeKey))!;
    await queue.enqueue({ ...input, payload: { userId: "u1" } });
    const after = (await queue.findByDedupeKey(input.dedupeKey))!;
    expect(after.payload).toEqual({ userId: "u1" });
    expect([after.attempts, after.lastError, after.nextRunAt]).toEqual([before.attempts, before.lastError, before.nextRunAt]);
  });

  it("upgrades completed or pending deltas to periodic authoritative full without forcing catalog replay", async () => {
    const input = { type: "KITSU_DELTA_SYNC" as const, priority: 10, payload: { userId: "u1" },
      dedupeKey: "KITSU_SYNC:u1", preserveRetryState: true };
    const job = await queue.enqueue(input);
    await queue.claimNext(); await queue.complete(job.id);
    await queue.enqueue({ ...input, type: "KITSU_FULL_SYNC", payload: { userId: "u1", reconcileOnly: true } });
    expect(await queue.findByDedupeKey(input.dedupeKey)).toMatchObject({ type: "KITSU_FULL_SYNC", payload: { userId: "u1", reconcileOnly: true } });
    await pool.query("DELETE FROM jobs");
    await queue.enqueue(input);
    await queue.enqueue({ ...input, type: "KITSU_FULL_SYNC", payload: { userId: "u1", reconcileOnly: true } });
    expect(await queue.findByDedupeKey(input.dedupeKey)).toMatchObject({ type: "KITSU_FULL_SYNC", payload: { userId: "u1", reconcileOnly: true } });
    await queue.enqueue({ ...input, type: "KITSU_FULL_SYNC", payload: { userId: "u1" } });
    await queue.enqueue({ ...input, type: "KITSU_FULL_SYNC", payload: { userId: "u1", reconcileOnly: true } });
    expect((await queue.findByDedupeKey(input.dedupeKey))?.payload).toEqual({ userId: "u1" });
  });

  it("revives legacy exhausted retries once when upgrading policy and preserves subsequent retry errors", async () => {
    const input = { type: "KITSU_FULL_SYNC" as const, priority: 10, payload: { userId: "u1", reconcileOnly: true },
      dedupeKey: "KITSU_SYNC:u1", preserveRetryState: true, maxAttempts: 5 };
    const job = await queue.enqueue(input);
    await pool.query("UPDATE jobs SET state = 'FAILED', attempts = 5, last_error = 'old outage' WHERE id = $1", [job.id]);
    await queue.enqueue({ ...input, maxAttempts: 1_000_000 });
    const upgraded = (await queue.findByDedupeKey(input.dedupeKey))!;
    expect(upgraded).toMatchObject({ state: "QUEUED", attempts: 5, lastError: "old outage", maxAttempts: 1_000_000 });
    await queue.claimNext();
    await queue.failRetryable(upgraded, new Error("still unavailable"));
    const before = (await queue.findByDedupeKey(input.dedupeKey))!;
    await queue.enqueue({ ...input, maxAttempts: 1_000_000 });
    expect(await queue.findByDedupeKey(input.dedupeKey)).toMatchObject({ attempts: 6, lastError: "still unavailable", nextRunAt: before.nextRunAt });
  });

  it("replays explicit catalog refresh requested while a periodic import is running", async () => {
    const input = { type: "KITSU_FULL_SYNC" as const, priority: 10, payload: { userId: "u1", reconcileOnly: true },
      dedupeKey: "KITSU_SYNC:u1", preserveRetryState: true };
    const job = await queue.enqueue(input); await queue.claimNext();
    await queue.enqueue({ ...input, payload: { userId: "u1" } });
    await queue.complete(job.id);
    expect(await queue.findByDedupeKey(input.dedupeKey)).toMatchObject({ state: "QUEUED", type: "KITSU_FULL_SYNC", payload: { userId: "u1" } });
    await queue.claimNext(); await queue.complete(job.id);
    expect((await queue.findByDedupeKey(input.dedupeKey))?.state).toBe("DONE");
  });

  it("finds missing OP song metadata again after cooldown without a Kitsu library edit", async () => {
    await repo.upsertKitsuAnime([entry("1")]); await repo.upsertLibraryEntries("u1", [entry("1")]);
    await repo.commitCatalogResult({ userId: "u1", kitsuIds: ["1"], themes: [theme()], mappings: new Map([["1", 10]]), genres: new Map(), checkedAt: now });
    expect(await repo.getCatalogWorkIds("u1", new Date(now.getTime() - 1))).toEqual([]);
    expect(await repo.getCatalogWorkIds("u1", new Date(now.getTime() + 1))).toEqual(["1"]);
    await pool.query("UPDATE themes SET animethemes_song_id = 500");
    expect(await repo.getCatalogWorkIds("u1", new Date(now.getTime() + 1))).toEqual([]);
  });

  it("supersedes obsolete aggregate retries only after their complete replacement is committed", async () => {
    await repo.upsertKitsuAnime([entry("1"), entry("2")]);
    await repo.upsertLibraryEntries("u1", [entry("1"), entry("2")]);
    const old = await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: "u1", kitsuIds: ["1", "2"] }, dedupeKey: "MAP_THEMES:u1:1,2" });
    const running = await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: "u1", kitsuIds: ["1"] }, dedupeKey: "MAP_THEMES:u1:1" });
    await pool.query("UPDATE jobs SET state = 'RUNNING' WHERE id = $1", [running.id]);
    await repo.commitLibraryImport({ userId: "u1", entries: [entry("1")], forceCatalog: true, startedAt: now, completedAt: now });
    expect((await queue.findByDedupeKey(old.dedupeKey!))?.state).toBe("QUEUED");
    await pool.query("UPDATE jobs SET state = 'FAILED' WHERE id = $1", [old.id]);
    await repo.commitLibraryImport({ userId: "u1", entries: [entry("1"), entry("2")], forceCatalog: true, startedAt: now, completedAt: now });
    expect(await queue.findByDedupeKey(old.dedupeKey!)).toMatchObject({ state: "CANCELLED", progress: { superseded: true } });
    expect((await queue.findByDedupeKey(running.dedupeKey!))?.state).toBe("RUNNING");
  });

  it("retires legacy retries containing removed anime while preserving uncovered active, running, shared and other-user work", async () => {
    await repo.upsertKitsuAnime([entry("1"), entry("2"), entry("3")]);
    await repo.upsertLibraryEntries("u1", [entry("1"), entry("2"), entry("3")]);
    const old = await queue.enqueue({ type: "MAP_THEMES", priority: 20,
      payload: { userId: "u1", kitsuIds: ["1", "2", "4"] }, dedupeKey: "MAP_THEMES:u1:1,2,4" });
    const uncovered = await queue.enqueue({ type: "MAP_THEMES", priority: 20,
      payload: { userId: "u1", kitsuIds: ["1", "3"] }, dedupeKey: "MAP_THEMES:u1:1,3" });
    const running = await queue.enqueue({ type: "MAP_THEMES", priority: 20,
      payload: { userId: "u1", kitsuIds: ["1", "2"] }, dedupeKey: "MAP_THEMES:u1:1,2" });
    const shared = await queue.enqueue({ type: "MAP_THEMES", priority: 20,
      payload: { kitsuIds: ["1", "2"] }, dedupeKey: "MAP_THEMES:u1:shared" });
    const other = await queue.enqueue({ type: "MAP_THEMES", priority: 20,
      payload: { userId: "u2", kitsuIds: ["1", "2"] }, dedupeKey: "MAP_THEMES:u2:1,2" });
    await pool.query("UPDATE jobs SET state = 'FAILED' WHERE id = $1", [old.id]);
    await pool.query("UPDATE jobs SET state = 'RUNNING' WHERE id = $1", [running.id]);
    // The full read removes 2; 4 never had a local row. Active 3 is omitted
    // from the changed rows and therefore has no replacement in this commit.
    await repo.commitLibraryImport({ userId: "u1", entries: [entry("1")], activeKitsuIds: ["1", "3"],
      forceCatalog: true, startedAt: now, completedAt: now });
    expect(await queue.findByDedupeKey(old.dedupeKey!)).toMatchObject({ state: "CANCELLED", progress: { superseded: true } });
    expect((await queue.findByDedupeKey(uncovered.dedupeKey!))?.state).toBe("QUEUED");
    expect((await queue.findByDedupeKey(running.dedupeKey!))?.state).toBe("RUNNING");
    expect((await queue.findByDedupeKey(shared.dedupeKey!))?.state).toBe("QUEUED");
    expect((await queue.findByDedupeKey(other.dedupeKey!))?.state).toBe("QUEUED");
  });

  async function rejectPlaylistIntents() {
    await pool.query(`CREATE FUNCTION reject_playlist() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.type = 'AUTO_PLAYLIST_REFRESH' THEN RAISE EXCEPTION 'outbox unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_playlist BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION reject_playlist()`);
  }
  async function allowPlaylistIntents() {
    await pool.query("DROP TRIGGER reject_playlist ON jobs; DROP FUNCTION reject_playlist()");
  }
});

function entry(id: string): KitsuAnimeEntry {
  return { id, title: `Anime ${id}`, titleEn: null, titleRomaji: null, titleJa: null, abbreviatedTitles: [],
    posterUrl: null, posterUrlLarge: null, coverUrl: null, coverUrlLarge: null, watchingStatus: "current",
    subtype: "TV", startDate: null, endDate: null, episodeCount: null, ageRating: null, averageRating: null,
    userRating: null, libraryUpdatedAt: "2026-10-21T00:00:00Z", slug: null };
}
function theme(): AnimeThemeEntry {
  return { animeId: 10, animeName: "Anime", animeNameEn: null, animeSynonyms: [], kitsuId: null, coverUrl: null,
    themeId: 100, animeThemesSongId: null, title: "Opening", artistName: "Artist", audioUrl: "https://example.test/a.ogg",
    videoUrl: null, themeType: "OP1", artists: [], songResources: [], videoCandidates: [], videoFallback: false };
}
