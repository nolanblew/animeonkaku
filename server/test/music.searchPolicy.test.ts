import { describe, expect, it, vi } from "vitest";
import { MusicSearchPolicyService, type MusicSearchMode } from "../src/music/settings/service.js";
import { createMusicSearchPolicyHandlers } from "../src/music/settings/handlers.js";
import { JobQueue } from "../src/jobs/jobQueue.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

function fixture(mode: MusicSearchMode = "MANUAL") {
  let currentMode = mode;
  const repo = {
    getMode: vi.fn().mockImplementation(async () => ({ mode: currentMode, updatedAt: new Date("2026-07-27T12:00:00Z") })),
    setMode: vi.fn().mockImplementation(async (next: MusicSearchMode) => {
      currentMode = next;
      return { mode: next, updatedAt: new Date("2026-07-27T12:00:00Z") };
    }),
    listEligibleAnime: vi.fn().mockResolvedValue([
      { userId: "user-1", kitsuId: "101" },
      { userId: "user-1", kitsuId: "202" },
    ]),
  };
  const queue = { enqueue: vi.fn().mockResolvedValue({}) };
  const requests = { trigger: vi.fn().mockResolvedValue({}) };
  return { repo, queue, requests, service: new MusicSearchPolicyService({ repo, queue: queue as any, requests }) };
}

describe("MusicSearchPolicyService", () => {
  it("persists a changed mode and queues an immediate backfill reconciliation", async () => {
    const { service, repo, queue } = fixture();

    await expect(service.updateMode("PLAYLISTS")).resolves.toMatchObject({ mode: "PLAYLISTS" });

    expect(repo.setMode).toHaveBeenCalledWith("PLAYLISTS");
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      type: "RECONCILE_MUSIC_SEARCH_POLICY",
      dedupeKey: "RECONCILE_MUSIC_SEARCH_POLICY",
    }));
  });

  it("does not create automatic requests in manual mode", async () => {
    const { service, repo, requests } = fixture("MANUAL");

    await expect(service.reconcile()).resolves.toEqual({ mode: "MANUAL", queued: 0 });

    expect(repo.listEligibleAnime).not.toHaveBeenCalled();
    expect(requests.trigger).not.toHaveBeenCalled();
  });

  it.each(["FAVORITES", "PLAYLISTS", "EVERYTHING"] as const)(
    "queues every existing eligible anime in %s mode through the normal automatic request flow",
    async (mode) => {
      const { service, repo, queue, requests } = fixture(mode);

      await expect(service.reconcile()).resolves.toEqual({ mode, queued: 2 });

      expect(repo.listEligibleAnime).toHaveBeenCalledWith(mode);
      expect(requests.trigger).not.toHaveBeenCalled();
      expect(queue.enqueue.mock.calls.map(([input]) => input)).toEqual(["101", "202"].map((kitsuId) => expect.objectContaining({
        type: "RECONCILE_MUSIC_SEARCH_POLICY", payload: { userId: "user-1", kitsuId },
        dedupeKey: `RECONCILE_MUSIC_SEARCH_POLICY:ANIME:user-1:${kitsuId}`, preserveRetryState: true,
      })));
    },
  );

  it("queues other anime and reports an enqueue failure for durable scan retry", async () => {
    const { service, queue } = fixture("PLAYLISTS");
    queue.enqueue.mockRejectedValueOnce(new Error("queue unavailable for 101"));
    await expect(service.reconcile()).rejects.toThrow("Kitsu 101: Error: queue unavailable for 101");
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it("does not let an old owner's backoff suppress a newly eligible owner", async () => {
    const { service, repo, queue } = fixture("PLAYLISTS");
    repo.listEligibleAnime.mockResolvedValueOnce([{ userId: "user-1", kitsuId: "101" }]);
    await service.reconcile();
    repo.listEligibleAnime.mockResolvedValueOnce([{ userId: "user-2", kitsuId: "101" }]);
    await service.reconcile();
    expect(queue.enqueue.mock.calls.map(([input]) => input.dedupeKey)).toEqual([
      "RECONCILE_MUSIC_SEARCH_POLICY:ANIME:user-1:101", "RECONCILE_MUSIC_SEARCH_POLICY:ANIME:user-2:101",
    ]);
  });

  it("rechecks current policy eligibility before retrying an anime", async () => {
    const { service, repo, requests } = fixture("PLAYLISTS");
    const anime = { userId: "user-1", kitsuId: "101" };
    repo.listEligibleAnime.mockResolvedValueOnce([]);
    await service.reconcileAnime(anime);
    expect(repo.listEligibleAnime).toHaveBeenCalledWith("PLAYLISTS", anime);
    expect(requests.trigger).not.toHaveBeenCalled();
    await service.reconcileAnime(anime);
    expect(requests.trigger).toHaveBeenCalledWith("user-1", "101", "AUTOMATIC");
    await service.updateMode("MANUAL");
    await service.reconcileAnime(anime);
    expect(requests.trigger).toHaveBeenCalledTimes(1);
  });

  it("keeps an anime failure and backoff durable while another anime succeeds", async () => {
    let now = new Date("2026-10-21T00:00:00Z");
    const { repo, requests } = fixture("PLAYLISTS");
    const jobRepo = new FakeJobRepository(() => now);
    const queue = new JobQueue(jobRepo, { now: () => now });
    const service = new MusicSearchPolicyService({ repo, queue, requests });
    const handler = createMusicSearchPolicyHandlers(service).RECONCILE_MUSIC_SEARCH_POLICY;
    requests.trigger.mockRejectedValueOnce(new Error("metadata unavailable for 101"));
    await service.reconcile();
    const first = (await queue.claimNext())!;
    try {
      await handler(first.payload, first, { signal: new AbortController().signal });
    } catch (error) {
      await queue.failRetryable(first, error as Error);
    }
    const second = (await queue.claimNext())!;
    await handler(second.payload, second, { signal: new AbortController().signal });
    await queue.complete(second.id);
    const failed = (await queue.list("QUEUED"))[0]!;
    expect(failed).toMatchObject({ payload: { kitsuId: "101" }, attempts: 1, lastError: "metadata unavailable for 101" });
    expect(failed.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    await service.reconcile();
    expect((await queue.list("QUEUED")).find((job) => job.id === first.id)).toMatchObject({
      attempts: 1, lastError: failed.lastError, nextRunAt: failed.nextRunAt,
    });
    now = failed.nextRunAt;
    const retry = (await queue.claimNext())!;
    // The successful anime may be offered again by the mock eligibility list;
    // its earlier due time should not prevent the failed anime's retry.
    if (retry.id !== first.id) await queue.complete(retry.id);
    const due = retry.id === first.id ? retry : (await queue.claimNext())!;
    await handler(due.payload, due, { signal: new AbortController().signal });
    await queue.complete(due.id);
    expect(requests.trigger.mock.calls).toEqual([
      ["user-1", "101", "AUTOMATIC"], ["user-1", "202", "AUTOMATIC"], ["user-1", "101", "AUTOMATIC"],
    ]);
  });
});
