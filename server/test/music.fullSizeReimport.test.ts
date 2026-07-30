import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RetryableJobError } from "../src/jobs/jobWorker.js";
import { createFullSizeReimportHandlers, PgFullSizeReimportCleanup } from "../src/music/requests/fullSizeReimport.js";

describe("full-size re-import orchestration", () => {
  it("starts one deterministic fresh snapshot and waits without consuming attempts", async () => {
    const requests = { startFullSizeReimport: vi.fn().mockResolvedValue({ state: "PROCESSING" }) };
    const cleanup = { finalize: vi.fn() };
    const handler = createFullSizeReimportHandlers({ requests, cleanup }).REIMPORT_AMF_FULL_SIZE;

    const error = await handler(
      { kitsuId: "1", userId: "7", requestId: "admin-reimport-generation-a" },
      { id: 41 } as never,
      {} as never,
    ).catch((value) => value);

    expect(requests.startFullSizeReimport).toHaveBeenCalledWith("7", "1", "admin-reimport-generation-a");
    expect(error).toBeInstanceOf(RetryableJobError);
    expect((error as RetryableJobError).options).toMatchObject({ incrementAttempts: false, recordError: false });
    expect(cleanup.finalize).not.toHaveBeenCalled();
  });

  it("prunes superseded AMF-owned artifacts only after the fresh snapshot completes", async () => {
    const requests = { startFullSizeReimport: vi.fn().mockResolvedValue({ state: "COMPLETED" }) };
    const cleanup = { finalize: vi.fn().mockResolvedValue({ prunedSongs: 2, prunedFiles: 2 }) };
    const handler = createFullSizeReimportHandlers({ requests, cleanup }).REIMPORT_AMF_FULL_SIZE;

    await handler({ kitsuId: "1", userId: "7", requestId: "admin-reimport-generation-a" }, { id: 41 } as never, {} as never);

    expect(cleanup.finalize).toHaveBeenCalledWith("admin-reimport-generation-a", "1");
  });

  it.each(["COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"])(
    "retains the old catalog when the fresh snapshot ends as %s",
    async (state) => {
      const requests = { startFullSizeReimport: vi.fn().mockResolvedValue({ state }) };
      const cleanup = { finalize: vi.fn() };
      const handler = createFullSizeReimportHandlers({ requests, cleanup }).REIMPORT_AMF_FULL_SIZE;

      await handler({ kitsuId: "1", userId: "7", requestId: "admin-reimport-generation-a" }, { id: 41 } as never, {} as never);

      expect(cleanup.finalize).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed durable payloads before changing catalog state", async () => {
    const requests = { startFullSizeReimport: vi.fn() };
    const cleanup = { finalize: vi.fn() };
    const handler = createFullSizeReimportHandlers({ requests, cleanup }).REIMPORT_AMF_FULL_SIZE;

    await expect(handler({ kitsuId: "1" }, { id: 41 } as never, {} as never)).rejects.toThrow("userId");
    expect(requests.startFullSizeReimport).not.toHaveBeenCalled();
  });

  it("deletes only paths the committed orphan sweep returns, then marks them missing", async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), "ongaku-reimport-"));
    const relativePath = "audio/songs/90/original.flac";
    const absolutePath = join(mediaRoot, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.alloc(32));
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT r.animethemes_anime_id")) return { rows: [{ animethemes_anime_id: 7 }] };
      if (sql.includes("RETURNING m.id,m.file_path")) return { rows: [{ id: 9, file_path: relativePath, song_id: 90 }] };
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

    const result = await new PgFullSizeReimportCleanup(pool as never, mediaRoot).finalize("admin-reimport-41", "1");

    await expect(stat(absolutePath)).rejects.toThrow();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), expect.any(Array));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("provider = 'AMF'"), expect.any(Array));
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.findIndex((sql) => sql.includes("DELETE FROM theme_full_songs")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("DELETE FROM release_tracks")));
    expect(statements.findIndex((sql) => sql.includes("DELETE FROM release_tracks")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("UPDATE songs")));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("state='MISSING'"), [9]);
    expect(result).toMatchObject({ prunedFiles: 1, prunedSongs: 1 });
  });
});
