import { describe, expect, it, vi } from "vitest";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import { MusicSearchPolicyService } from "../src/music/settings/service.js";
import type { MusicSearchMode } from "../src/music/settings/types.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

function setup(mode: MusicSearchMode) {
  const repo = {
    getMode: vi.fn().mockResolvedValue({ mode, updatedAt: new Date("2026-09-18T00:00:00.000Z") }),
    setMode: vi.fn(),
    listEligibleAnime: vi.fn().mockResolvedValue([]),
  };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const requests = { trigger: vi.fn().mockResolvedValue(undefined) };
  return {
    repo,
    queue,
    requests,
    service: new MusicSearchPolicyService({ repo, queue, requests }),
  };
}

describe("MusicSearchPolicyService", () => {
  it("does not create reconciliation jobs while automatic search is disabled", async () => {
    const { service, queue } = setup("MANUAL");

    await expect(service.enqueueReconciliation()).resolves.toBe(false);

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("coalesces automatic reconciliation and requests eligible anime", async () => {
    const { service, queue, repo, requests } = setup("EVERYTHING");
    repo.listEligibleAnime.mockResolvedValue([{ userId: "u1", kitsuId: "bookworm-4" }]);

    await expect(service.enqueueReconciliation()).resolves.toBe(true);
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      type: "RECONCILE_MUSIC_SEARCH_POLICY",
      dedupeKey: "RECONCILE_MUSIC_SEARCH_POLICY",
    }));

    await expect(service.reconcile()).resolves.toMatchObject({ mode: "EVERYTHING", queued: 1 });
    expect(requests.trigger).toHaveBeenCalledWith("u1", "bookworm-4", "AUTOMATIC");
  });

  it("keeps one import follow-up when the import scan is already running", async () => {
    const settingsRepo = {
      getMode: vi.fn().mockResolvedValue({ mode: "EVERYTHING", updatedAt: new Date("2026-09-18T00:00:00.000Z") }),
      setMode: vi.fn(),
      listEligibleAnime: vi.fn().mockResolvedValue([]),
    };
    const jobRepo = new FakeJobRepository();
    const queue = new JobQueue(jobRepo);
    const service = new MusicSearchPolicyService({
      repo: settingsRepo,
      queue,
      requests: { trigger: vi.fn().mockResolvedValue(undefined) },
    });

    await expect(service.enqueueImportReconciliation()).resolves.toBe(true);
    const running = await queue.claimNext();
    expect(running?.state).toBe("RUNNING");

    await expect(service.enqueueImportReconciliation()).resolves.toBe(true);
    await expect(service.enqueueImportReconciliation()).resolves.toBe(true);
    const queued = await queue.list("QUEUED");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: "RECONCILE_MUSIC_SEARCH_POLICY",
      priority: JobPriority.NORMAL,
      dedupeKey: "RECONCILE_MUSIC_SEARCH_POLICY:IMPORT:FOLLOWUP",
    });
  });
});
