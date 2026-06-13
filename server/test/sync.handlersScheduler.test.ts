import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import type { JobRecord } from "../src/jobs/types.js";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { createSyncJobHandlers } from "../src/sync/jobHandlers.js";
import { SyncScheduler } from "../src/sync/scheduler.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";
import { FakeTime } from "./helpers/fakeTime.js";

describe("JobQueue S4 progress/checkpoint support", () => {
  it("detects queued urgent jobs and stores progress on the job row", async () => {
    const time = new FakeTime();
    const repo = new FakeJobRepository(() => new Date(time.now()));
    const queue = new JobQueue(repo, { now: () => new Date(time.now()) });

    const syncJob = await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.NORMAL,
      payload: { userId: "u1", full: true },
      dedupeKey: "KITSU_FULL_SYNC:u1",
    });
    expect(await queue.hasUrgentQueued()).toBe(false);

    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 4567 },
      dedupeKey: "FETCH_AUDIO:4567",
    });
    expect(await queue.hasUrgentQueued()).toBe(true);

    await queue.updateProgress(syncJob.id, {
      phase: "SYNCING_LIBRARY",
      fetched: 50,
      total: 120,
    });

    const stored = (await queue.list()).find((job) => job.id === syncJob.id);
    expect(stored?.progress).toEqual({
      phase: "SYNCING_LIBRARY",
      fetched: 50,
      total: 120,
    });
  });
});

function job(type: JobRecord["type"], payload: Record<string, unknown> = {}): JobRecord {
  return {
    id: 1,
    type,
    priority: JobPriority.NORMAL,
    state: "RUNNING",
    payload,
    progress: {},
    dedupeKey: null,
    attempts: 0,
    maxAttempts: 5,
    nextRunAt: new Date(0),
    lastError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("S4 sync job handlers", () => {
  it("dispatches S4 job payloads to the matching pipeline methods", async () => {
    const calls: unknown[] = [];
    const handlers = createSyncJobHandlers({
      runKitsuSync: async (input: unknown) => calls.push(["sync", input]),
      runMapThemes: async (input: unknown) => calls.push(["map", input]),
      runBackfillScan: async (input: unknown) => calls.push(["backfill", input]),
      runAutoPlaylistRefresh: async (input: unknown) => calls.push(["auto", input]),
    });

    await handlers.KITSU_FULL_SYNC?.({ userId: "u1" }, job("KITSU_FULL_SYNC"));
    await handlers.KITSU_DELTA_SYNC?.({ userId: "u1" }, job("KITSU_DELTA_SYNC"));
    await handlers.MAP_THEMES?.({ kitsuIds: ["1", "2"], userId: "u1" }, job("MAP_THEMES"));
    await handlers.BACKFILL_SCAN?.({ userId: "u1" }, job("BACKFILL_SCAN"));
    await handlers.AUTO_PLAYLIST_REFRESH?.({ userId: "u1" }, job("AUTO_PLAYLIST_REFRESH"));

    expect(calls.map((call) => (call as unknown[])[0])).toEqual([
      "sync",
      "sync",
      "map",
      "backfill",
      "auto",
    ]);
    expect(calls[0]).toMatchObject(["sync", { userId: "u1", full: true }]);
    expect(calls[1]).toMatchObject(["sync", { userId: "u1", full: false }]);
  });

  it("rejects invalid S4 job payloads", async () => {
    const handlers = createSyncJobHandlers({
      runKitsuSync: async () => {},
      runMapThemes: async () => {},
      runBackfillScan: async () => {},
      runAutoPlaylistRefresh: async () => {},
    });

    await expect(handlers.KITSU_FULL_SYNC?.({}, job("KITSU_FULL_SYNC"))).rejects.toThrow(/userId/);
    await expect(handlers.MAP_THEMES?.({ kitsuIds: [] }, job("MAP_THEMES"))).rejects.toThrow(/kitsuIds/);
  });
});

describe("SyncScheduler", () => {
  it("enqueues delta syncs for active users and runs daily/weekly maintenance", async () => {
    const queue = new JobQueue(new FakeJobRepository());
    const calls: string[] = [];
    const scheduler = new SyncScheduler({
      queue,
      repo: {
        listActiveUserIds: async () => ["u1", "u2"],
      },
      pipeline: {
        scanOrphanFiles: async () => {
          calls.push("orphan");
          return [];
        },
        requeueFailedMedia: async () => {
          calls.push("failed");
          return 0;
        },
      },
      mediaRoot: "C:/media",
    });

    await scheduler.enqueueDeltaSyncs();
    await scheduler.runDailyMaintenance();
    await scheduler.runWeeklyMaintenance();

    const queued = await queue.list("QUEUED");
    expect(queued.map((queuedJob) => [queuedJob.type, queuedJob.payload, queuedJob.dedupeKey])).toEqual([
      ["KITSU_DELTA_SYNC", { userId: "u1" }, "KITSU_DELTA_SYNC:u1"],
      ["KITSU_DELTA_SYNC", { userId: "u2" }, "KITSU_DELTA_SYNC:u2"],
      ["AUTO_PLAYLIST_REFRESH", { userId: "u1" }, "AUTO_PLAYLIST_REFRESH:u1"],
      ["AUTO_PLAYLIST_REFRESH", { userId: "u2" }, "AUTO_PLAYLIST_REFRESH:u2"],
    ]);
    expect(calls).toEqual(["orphan", "failed"]);
  });
});

describe("new-user login sync enqueue", () => {
  it("runs an optional login hook so new users can enqueue a full sync", async () => {
    const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-login-"));
    const enqueued: string[] = [];
    const app: FastifyInstance = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      onLogin: async (result) => {
        if (result.isNewUser) enqueued.push(result.user.kitsuUserId);
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "nolan", password: "hunter2" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(enqueued).toEqual(["stub-nolan"]);
  });
});
