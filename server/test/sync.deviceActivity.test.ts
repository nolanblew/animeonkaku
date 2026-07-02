import { describe, expect, it } from "vitest";
import { JobQueue } from "../src/jobs/index.js";
import { DeviceActivitySyncTrigger } from "../src/sync/deviceActivitySync.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

const HOUR_MS = 60 * 60 * 1000;

function user(overrides: Partial<{ kitsuUserId: string; lastSyncAt: Date | null; kitsuAuthState: string }> = {}) {
  return {
    kitsuUserId: overrides.kitsuUserId ?? "u1",
    lastSyncAt: overrides.lastSyncAt === undefined ? new Date(0) : overrides.lastSyncAt,
    kitsuAuthState: overrides.kitsuAuthState ?? "OK",
  };
}

function trigger(queue: JobQueue, nowMs: () => number) {
  return new DeviceActivitySyncTrigger({
    queue,
    staleAfterMs: 3 * HOUR_MS,
    checkCooldownMs: 15 * 60 * 1000,
    now: () => new Date(nowMs()),
  });
}

describe("DeviceActivitySyncTrigger", () => {
  it("enqueues a HIGH delta sync when the user's last sync is older than the threshold", async () => {
    const queue = new JobQueue(new FakeJobRepository());
    const subject = trigger(queue, () => 10 * HOUR_MS);

    await subject.onUserActivity(user({ lastSyncAt: new Date(4 * HOUR_MS) }));

    const jobs = await queue.list("QUEUED");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "KITSU_DELTA_SYNC",
      priority: 10,
      payload: { userId: "u1" },
      dedupeKey: "KITSU_DELTA_SYNC:u1",
    });
  });

  it("does nothing when the user synced recently", async () => {
    const queue = new JobQueue(new FakeJobRepository());
    const subject = trigger(queue, () => 10 * HOUR_MS);

    await subject.onUserActivity(user({ lastSyncAt: new Date(9 * HOUR_MS) }));

    expect(await queue.list("QUEUED")).toHaveLength(0);
  });

  it("skips users mid-first-sync (no lastSyncAt) and users needing reauth", async () => {
    const queue = new JobQueue(new FakeJobRepository());
    const subject = trigger(queue, () => 10 * HOUR_MS);

    await subject.onUserActivity(user({ lastSyncAt: null }));
    await subject.onUserActivity(user({ kitsuAuthState: "REAUTH_REQUIRED", lastSyncAt: new Date(0) }));

    expect(await queue.list("QUEUED")).toHaveLength(0);
  });

  it("throttles re-evaluation with a per-user cooldown but rechecks after it lapses", async () => {
    const queue = new JobQueue(new FakeJobRepository());
    let nowMs = 10 * HOUR_MS;
    const subject = trigger(queue, () => nowMs);
    const staleUser = user({ lastSyncAt: new Date(0) });

    await subject.onUserActivity(staleUser);
    // Simulate the enqueued job finishing so a second enqueue would be visible.
    const claimed = await queue.claimNext();
    await queue.complete(claimed!.id);

    nowMs += 5 * 60 * 1000; // within cooldown — no new evaluation
    await subject.onUserActivity(staleUser);
    expect(await queue.list("QUEUED")).toHaveLength(0);

    nowMs += 15 * 60 * 1000; // cooldown lapsed, still stale — re-enqueues
    await subject.onUserActivity(staleUser);
    expect(await queue.list("QUEUED")).toHaveLength(1);
  });

  it("tracks cooldowns per user", async () => {
    const queue = new JobQueue(new FakeJobRepository());
    const subject = trigger(queue, () => 10 * HOUR_MS);

    await subject.onUserActivity(user({ kitsuUserId: "u1", lastSyncAt: new Date(0) }));
    await subject.onUserActivity(user({ kitsuUserId: "u2", lastSyncAt: new Date(0) }));

    const jobs = await queue.list("QUEUED");
    expect(jobs.map((job) => job.payload.userId).sort()).toEqual(["u1", "u2"]);
  });
});
