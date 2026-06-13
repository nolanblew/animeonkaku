import { describe, expect, it } from "vitest";
import { JobSyncApiService } from "../src/api/jobSyncApiService.js";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

const USER = "466215";

function setup() {
  const repo = new FakeJobRepository();
  const queue = new JobQueue(repo);
  const service = new JobSyncApiService(queue);
  return { repo, queue, service };
}

describe("JobSyncApiService.getStatus upstream-blocked surfacing", () => {
  it("reports upstreamBlocked when the user's MAP_THEMES job failed with a 403 block", async () => {
    const { repo, queue, service } = setup();
    // A completed library sync — the user would see "Sync complete".
    const sync = await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: USER },
      dedupeKey: `KITSU_FULL_SYNC:${USER}`,
    });
    await repo.complete(sync.id);
    // ...but theme mapping hit a Cloudflare block.
    const map = await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1"], userId: USER },
      dedupeKey: `MAP_THEMES:${USER}:1`,
    });
    await repo.fail(map.id, {
      state: "FAILED",
      nextRunAt: new Date(),
      lastError: "AnimeThemes request failed with HTTP 403: cloudflare",
      incrementAttempts: true,
    });

    const status = await service.getStatus(USER);
    expect(status.upstreamBlocked).toBe(true);
    expect(status.mapping?.state).toBe("FAILED");
    expect(status.mapping?.lastError).toContain("403");
  });

  it("does not report upstreamBlocked when mapping completed", async () => {
    const { repo, queue, service } = setup();
    const map = await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1"], userId: USER },
      dedupeKey: `MAP_THEMES:${USER}:1`,
    });
    await repo.complete(map.id);

    const status = await service.getStatus(USER);
    expect(status.upstreamBlocked).toBe(false);
    expect(status.mapping?.state).toBe("DONE");
  });

  it("treats a non-block mapping failure as not upstreamBlocked", async () => {
    const { repo, queue, service } = setup();
    const map = await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1"], userId: USER },
      dedupeKey: `MAP_THEMES:${USER}:1`,
    });
    await repo.fail(map.id, {
      state: "FAILED",
      nextRunAt: new Date(),
      lastError: "boom: some unrelated database error",
      incrementAttempts: true,
    });

    const status = await service.getStatus(USER);
    expect(status.upstreamBlocked).toBe(false);
    expect(status.mapping?.state).toBe("FAILED");
  });

  it("ignores MAP_THEMES jobs belonging to other users", async () => {
    const { repo, queue, service } = setup();
    const other = await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1"], userId: "999" },
      dedupeKey: `MAP_THEMES:999:1`,
    });
    await repo.fail(other.id, {
      state: "FAILED",
      nextRunAt: new Date(),
      lastError: "HTTP 403",
      incrementAttempts: true,
    });

    const status = await service.getStatus(USER);
    expect(status.upstreamBlocked).toBe(false);
    expect(status.mapping).toBeNull();
  });
});
