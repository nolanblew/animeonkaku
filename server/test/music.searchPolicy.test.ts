import { describe, expect, it, vi } from "vitest";
import { MusicSearchPolicyService, type MusicSearchMode } from "../src/music/settings/service.js";

function fixture(mode: MusicSearchMode = "MANUAL") {
  const repo = {
    getMode: vi.fn().mockResolvedValue({ mode, updatedAt: new Date("2026-07-27T12:00:00Z") }),
    setMode: vi.fn().mockImplementation(async (next: MusicSearchMode) => ({ mode: next, updatedAt: new Date("2026-07-27T12:00:00Z") })),
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
      const { service, repo, requests } = fixture(mode);

      await expect(service.reconcile()).resolves.toEqual({ mode, queued: 2 });

      expect(repo.listEligibleAnime).toHaveBeenCalledWith(mode);
      expect(requests.trigger.mock.calls).toEqual([
        ["user-1", "101", "AUTOMATIC"],
        ["user-1", "202", "AUTOMATIC"],
      ]);
    },
  );
});
