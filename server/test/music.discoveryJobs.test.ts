import { describe, expect, it, vi } from "vitest";
import type { JobQueue } from "../src/jobs/jobQueue.js";
import { RetryableJobError } from "../src/jobs/jobWorker.js";
import type { JobRecord } from "../src/jobs/types.js";
import {
  ACQUISITION_POLL_INTERVAL_MS,
  createAnimeMappedDiscoveryHook,
  createMusicDiscoveryHandlers,
  DISCOVERY_DAILY_LIMIT,
  discoverAnimeMusicDedupeKey,
  PgMusicDiscoveryRepository,
  RECENT_SCAN_INTERVAL_MS,
  oneCalendarYearEarlier,
  MusicDiscoveryScheduler,
  type MusicDiscoveryRepository,
  type MusicDiscoveryWorkflow,
} from "../src/music/discovery/index.js";

const now = new Date("2026-07-20T12:00:00Z");
const job = { id: 7, attempts: 2, maxAttempts: 5 } as JobRecord;

function harness() {
  const enqueue = vi.fn().mockResolvedValue({});
  const repo = {
    ensureAnime: vi.fn().mockResolvedValue([]),
    listMappedAnimeIds: vi.fn().mockResolvedValue([]),
    listDue: vi.fn().mockResolvedValue([]),
    markRunning: vi.fn().mockResolvedValue(undefined),
    markSucceeded: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    recoverStaleRunning: vi.fn().mockResolvedValue(0),
  } satisfies MusicDiscoveryRepository;
  const workflow = {
    discoverAnime: vi.fn().mockResolvedValue({ missingFullCount: 0, ambiguous: false }),
    reconcileAcquisition: vi.fn().mockResolvedValue("COMPLETE" as const),
  } satisfies MusicDiscoveryWorkflow;
  const queue = { enqueue } as unknown as JobQueue;
  return { enqueue, repo, workflow, queue };
}

describe("music discovery jobs", () => {
  it("bounds the daily oldest-due selection and dedupes each anime", async () => {
    const h = harness();
    h.repo.listDue.mockResolvedValue([state(12), state(34)]);
    const handlers = createMusicDiscoveryHandlers({ enabled: true,
      queue: h.queue, repo: h.repo, workflow: h.workflow, now: () => now });

    await handlers.MUSIC_CATALOG_SCAN({}, job);

    expect(h.repo.listDue).toHaveBeenCalledWith(now, DISCOVERY_DAILY_LIMIT);
    expect(h.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({
      payload: { animeId: 12 }, dedupeKey: discoverAnimeMusicDedupeKey(12),
    }));
    expect(h.enqueue).toHaveBeenCalledTimes(2);
  });

  it("persists discovery attempts and results", async () => {
    const h = harness();
    h.workflow.discoverAnime.mockResolvedValue({ missingFullCount: 1, ambiguous: true });
    const handlers = createMusicDiscoveryHandlers({ enabled: true,
      queue: h.queue, repo: h.repo, workflow: h.workflow, now: () => now });
    await handlers.DISCOVER_ANIME_MUSIC({ animeId: 42 }, job);
    expect(h.repo.markRunning).toHaveBeenCalledWith(42, now);
    expect(h.repo.markSucceeded).toHaveBeenCalledWith(42,
      { missingFullCount: 1, ambiguous: true }, now);
  });

  it("persists operational discovery failures and lets the job retry normally", async () => {
    const h = harness();
    h.workflow.discoverAnime.mockRejectedValue(new Error("provider unavailable"));
    const handlers = createMusicDiscoveryHandlers({ enabled: true,
      queue: h.queue, repo: h.repo, workflow: h.workflow, now: () => now });
    await expect(handlers.DISCOVER_ANIME_MUSIC({ animeId: 42 }, job))
      .rejects.toThrow("provider unavailable");
    expect(h.repo.markFailed).toHaveBeenCalledWith(42, "provider unavailable", now);
  });

  it("reschedules pending acquisitions without consuming attempts", async () => {
    const h = harness();
    h.workflow.reconcileAcquisition.mockResolvedValue("PENDING");
    const handlers = createMusicDiscoveryHandlers({ enabled: true,
      queue: h.queue, repo: h.repo, workflow: h.workflow, now: () => now });
    const thrown = await handlers.RECONCILE_MUSIC_ACQUISITION({ acquisitionId: 9 }, job)
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(RetryableJobError);
    expect((thrown as RetryableJobError).options).toEqual({
      incrementAttempts: false, retryAfterMs: ACQUISITION_POLL_INTERVAL_MS,
    });
  });

  it("does no provider work when discovery is disabled", async () => {
    const h = harness();
    const handlers = createMusicDiscoveryHandlers({ enabled: false,
      queue: h.queue, repo: h.repo, workflow: h.workflow, now: () => now });
    await expect(handlers.MUSIC_CATALOG_SCAN({}, job)).rejects.toBeInstanceOf(RetryableJobError);
    await expect(handlers.DISCOVER_ANIME_MUSIC({ animeId: 1 }, job)).rejects.toBeInstanceOf(RetryableJobError);
    expect(h.repo.listDue).not.toHaveBeenCalled();
    expect(h.workflow.discoverAnime).not.toHaveBeenCalled();
  });

  it("immediate mapping hook enqueues only newly inserted discovery states", async () => {
    const h = harness();
    h.repo.ensureAnime.mockResolvedValue([22]);
    const hook = createAnimeMappedDiscoveryHook({ enabled: true,
      queue: h.queue, repo: h.repo, now: () => now });
    await hook([22, 22, 23]);
    expect(h.repo.ensureAnime).toHaveBeenCalledWith([22, 23], now);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: discoverAnimeMusicDedupeKey(22),
    }));
  });

  it("defers metadata-unready startup mappings and enqueues exactly once when their remap first becomes ready", async () => {
    const h = harness();
    h.repo.ensureAnime.mockResolvedValueOnce([]).mockResolvedValueOnce([22]).mockResolvedValueOnce([]);
    const hook = createAnimeMappedDiscoveryHook({ enabled: true, queue: h.queue, repo: h.repo, now: () => now });
    // Startup repository filtering omits the legacy null-song mapping; the
    // first metadata-bearing remap creates its state and later unchanged maps do not.
    await hook([]);
    await hook([22]);
    await hook([22]);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ payload: { animeId: 22 } }));
  });

  it("startup mapped-id query requires source-song metadata", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PgMusicDiscoveryRepository({ query } as never);
    await repo.listMappedAnimeIds();
    expect(String(query.mock.calls[0]![0])).toContain("t.animethemes_song_id IS NOT NULL");
  });

  it("uses weekly cadence for recent anime even when Full Size is missing", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PgMusicDiscoveryRepository({ query } as never);
    await repo.markSucceeded(42, { missingFullCount: 2, ambiguous: true }, now);
    const [, params] = query.mock.calls[0]!;
    expect(params[6]).toEqual(new Date(now.getTime() + RECENT_SCAN_INTERVAL_MS));
    expect(String(query.mock.calls[0]![0])).toContain("WHEN EXISTS");
    expect(String(query.mock.calls[0]![0])).toContain("last_error=NULL");
  });

  it("queries only due policy rows oldest-first with the caller's hard limit", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [stateRow(8)] });
    const repo = new PgMusicDiscoveryRepository({ query } as never);
    const rows = await repo.listDue(now, 25);
    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql)).toContain("ds.missing_full_count > 0");
    expect(String(sql)).toContain("mapped.mapping_state='MAPPED'");
    expect(String(sql)).toContain("release.release_date BETWEEN $2::date AND $3::date");
    expect(String(sql)).toContain("MAX(ka.start_date)");
    expect(String(sql)).toContain("ORDER BY ds.next_scan_at NULLS FIRST, ds.last_attempt_at NULLS FIRST");
    expect(String(sql)).toContain("LIMIT $4");
    expect(params[1]).toBe("2025-07-20");
    expect(params[2]).toBe("2026-07-20");
    expect(params[3]).toBe(25);
    expect(rows[0]?.animethemesAnimeId).toBe(8);
  });

  it("uses a calendar-year boundary that clamps leap day", () => {
    expect(oneCalendarYearEarlier(new Date("2024-02-29T12:34:56.000Z"))).toEqual(new Date("2023-02-28T12:34:56.000Z"));
  });

  it("observes scheduler enqueue errors and retries on the next daily tick", async () => {
    vi.useFakeTimers();
    try {
      const enqueue = vi.fn()
        .mockRejectedValueOnce(new Error("database offline"))
        .mockResolvedValue({});
      const onError = vi.fn();
      const scheduler = new MusicDiscoveryScheduler(
        { enqueue } as unknown as JobQueue,
        true,
        onError,
      );
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "database offline" }));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
      expect(enqueue).toHaveBeenCalledTimes(2);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

function state(animethemesAnimeId: number) {
  return { animethemesAnimeId, lastAttemptAt: null, lastSuccessAt: null, nextScanAt: null,
    status: "DUE" as const, missingFullCount: 1, failureCount: 0, lastError: null };
}

function stateRow(animethemesAnimeId: number) {
  return { animethemes_anime_id: animethemesAnimeId, last_attempt_at: null,
    last_success_at: null, next_scan_at: null, status: "DUE", missing_full_count: 1,
    failure_count: 0, last_error: null };
}
