import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PgAdminDashboardService } from "../src/admin/service.js";
import { RecentLogStore } from "../src/logging.js";

describe("admin dashboard service", () => {
  const roots: string[] = [];
  afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

  it("measures real managed files in non-overlapping storage categories", async () => {
    const root = await mkdtemp(join(tmpdir(), "ongaku-admin-")); roots.push(root);
    const files = [
      ["audio/42.ogg", 10],
      ["audio/songs/7/original.m4a", 20],
      ["images/anime/1/poster.jpg", 30],
      ["audio/tmp/pending.tmp", 40],
    ] as const;
    for (const [relative, size] of files) {
      const path = join(root, relative); await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.alloc(size));
    }
    const pool = { query: async () => ({ rows: [{ users: "1", anime: "2", themes: "3", songs: "4", active_jobs: "5", failed_jobs: "6" }] }) };
    const service = new PgAdminDashboardService({
      pool: pool as never, queue: {} as never, requests: {} as never, operator: {} as never,
      mediaRoot: root, logs: new RecentLogStore(),
    });
    const result = await service.overview() as any;
    expect(result.counts).toEqual({ users: 1, anime: 2, themes: 3, songs: 4, activeJobs: 5, failedJobs: 6 });
    expect(result.storage).toMatchObject({ totalBytes: 100, tvSongsBytes: 10, fullSongsBytes: 20, artworkBytes: 30, cacheBytes: 40 });
  });

  it("retains a bounded, newest-first, redacted log window", () => {
    const logs = new RecentLogStore(2);
    logs.add("INFO", { token: "secret", requestId: "one" }, "first");
    logs.add("WARN", { password: "hidden" }, "second");
    logs.add("ERROR", { safe: true }, "third");
    expect(logs.list({ level: undefined, limit: 10 }).map((entry) => entry.message)).toEqual(["third", "second"]);
    expect(logs.list({ level: "WARN", limit: 10 })[0]?.data.password).toBe("[REDACTED]");
  });
});
