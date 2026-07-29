import { describe, expect, it, vi } from "vitest";
import { DrizzleClientApiService } from "../src/api/drizzleClientApiService.js";
import type { Db } from "../src/db/client.js";
import { JobPriority, type JobQueue } from "../src/jobs/index.js";
import { JobWorker } from "../src/jobs/jobWorker.js";
import type { JobRecord } from "../src/jobs/types.js";
import { SyncScheduler } from "../src/sync/scheduler.js";

const queueStub = { enqueue: vi.fn(async () => ({ id: 1 })) } as unknown as JobQueue;

function runningAudioJob(): JobRecord {
  const now = new Date("2026-07-29T12:00:00.000Z");
  return {
    id: 7,
    type: "FETCH_AUDIO",
    priority: JobPriority.NORMAL,
    state: "RUNNING",
    payload: { themeId: 7 },
    progress: {},
    dedupeKey: "FETCH_AUDIO:7",
    attempts: 0,
    maxAttempts: 5,
    nextRunAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("server reliability audit regressions", () => {
  it("keeps the background worker alive after one transient claim failure", async () => {
    let worker: JobWorker;
    const queue = {
      claimNext: vi.fn()
        .mockRejectedValueOnce(new Error("database temporarily unavailable"))
        .mockResolvedValueOnce(runningAudioJob())
        .mockImplementation(async () => {
          worker.stop();
          return null;
        }),
      complete: vi.fn(async () => {}),
      failRetryable: vi.fn(async () => null),
      hasUrgentQueued: vi.fn(async () => false),
    } as unknown as JobQueue;

    worker = new JobWorker(queue, {
      handlers: { FETCH_AUDIO: async () => {} },
      sleep: async () => {},
      jitterMs: () => 0,
    });
    worker.start();

    await vi.waitFor(() => expect(queue.complete).toHaveBeenCalledWith(7), { timeout: 250 });
    worker.stop();
  });

  it("contains a periodic scheduler failure and continues on the next tick", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const queued = { enqueue: vi.fn(async () => ({ id: 1 })) } as unknown as JobQueue;
    const scheduler = new SyncScheduler({
      queue: queued,
      repo: {
        listActiveUserIds: vi.fn()
          .mockRejectedValueOnce(new Error("temporary database outage"))
          .mockResolvedValue(["listener"]),
      },
      pipeline: {
        scanOrphanFiles: async () => [],
        requeueFailedMedia: async () => 0,
      },
      mediaRoot: "C:/media",
      syncIntervalMinutes: 0.001,
      onError,
    } as unknown as ConstructorParameters<typeof SyncScheduler>[0]);

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(120);

      expect(onError).toHaveBeenCalledWith(expect.any(Error), "periodic sync");
      expect(queued.enqueue).toHaveBeenCalledWith(expect.objectContaining({
        type: "KITSU_FULL_SYNC",
        payload: { userId: "listener" },
      }));
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }
  });

  it("takes the library delta watermark before beginning delta reads", async () => {
    let firstReadStarted = false;
    const service = new DrizzleClientApiService(
      {} as Db,
      queueStub,
      () => {
        if (firstReadStarted) throw new Error("delta watermark was captured after reads started");
        return new Date("2026-07-29T12:00:00.000Z");
      },
    );
    const internals = service as unknown as Record<string, (...args: never[]) => unknown>;
    vi.spyOn(internals, "libraryAnimeRows").mockImplementation(async () => {
      firstReadStarted = true;
      return [];
    });
    vi.spyOn(internals, "activeLibraryMappings").mockResolvedValue([]);
    vi.spyOn(internals, "genreMap").mockResolvedValue(new Map());
    vi.spyOn(internals, "libraryThemes").mockResolvedValue([]);

    await expect(service.getLibrary("listener", 0)).resolves.toMatchObject({
      serverTime: Date.parse("2026-07-29T12:00:00.000Z"),
      anime: [],
      themes: [],
    });
  });

  it("omits the music catalog for an incremental changes pull", async () => {
    const service = new DrizzleClientApiService({} as Db, queueStub, undefined, undefined, true);
    vi.spyOn(service, "getLibrary").mockResolvedValue({ serverTime: 123, anime: [], themes: [] });
    vi.spyOn(service, "getThemePrefs").mockResolvedValue([]);
    vi.spyOn(service, "getSongPrefs").mockResolvedValue([]);
    vi.spyOn(service, "listPlaylists").mockResolvedValue([]);
    vi.spyOn(service, "getMusicCatalog").mockRejectedValue(
      new Error("an unchanged incremental pull must not load the full catalog"),
    );

    await expect(service.getChanges("listener", 123)).resolves.not.toHaveProperty("musicCatalog");
  });

  it("omits an unchanged theme snapshot from an incremental changes pull", async () => {
    const service = new DrizzleClientApiService({} as Db, queueStub);
    vi.spyOn(service, "getLibrary").mockResolvedValue({ serverTime: 123, anime: [], themes: [] });
    vi.spyOn(service, "getThemePrefs").mockResolvedValue([]);
    vi.spyOn(service, "getSongPrefs").mockResolvedValue([]);
    vi.spyOn(service, "listPlaylists").mockResolvedValue([]);

    await expect(service.getChanges("listener", 123)).resolves.not.toHaveProperty("themes");
  });
});
