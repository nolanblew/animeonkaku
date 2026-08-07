import { describe, expect, it } from "vitest";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";
import { FakeTime } from "./helpers/fakeTime.js";
import {
  JobPriority,
  JobQueue,
  JobWorker,
  RetryableJobError,
} from "../src/jobs/index.js";

describe("JobQueue", () => {
  it("dedupes queued jobs and bumps priority to the most urgent request", async () => {
    const time = new FakeTime();
    const queue = new JobQueue(new FakeJobRepository(() => new Date(time.now())), {
      now: () => new Date(time.now()),
    });

    const first = await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.MAINTENANCE,
      payload: { themeId: 4567 },
      dedupeKey: "FETCH_AUDIO:4567",
    });
    time.advance(60_000);
    const second = await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 4567 },
      dedupeKey: "FETCH_AUDIO:4567",
    });

    expect(second.id).toBe(first.id);
    expect(second.priority).toBe(JobPriority.URGENT);
    expect(await queue.list()).toHaveLength(1);
  });

  it("claims urgent jobs before maintenance jobs even when maintenance was queued first", async () => {
    const time = new FakeTime();
    const queue = new JobQueue(new FakeJobRepository(() => new Date(time.now())), {
      now: () => new Date(time.now()),
    });

    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.MAINTENANCE,
      payload: { themeId: 1 },
      dedupeKey: "FETCH_AUDIO:1",
    });
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 2 },
      dedupeKey: "FETCH_AUDIO:2",
    });

    const claimed = await queue.claimNext();
    expect(claimed?.payload).toEqual({ themeId: 2 });
  });

  it("recovers RUNNING jobs to QUEUED on boot", async () => {
    const time = new FakeTime();
    const queue = new JobQueue(new FakeJobRepository(() => new Date(time.now())), {
      now: () => new Date(time.now()),
    });
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.NORMAL,
      payload: { themeId: 1 },
      dedupeKey: "FETCH_AUDIO:1",
    });
    await queue.claimNext();

    expect(await queue.recoverRunningJobs()).toBe(1);
    expect((await queue.list("QUEUED"))).toHaveLength(1);
  });

  it("requeues completed deduped jobs for recurring work", async () => {
    const time = new FakeTime();
    const queue = new JobQueue(new FakeJobRepository(() => new Date(time.now())), {
      now: () => new Date(time.now()),
    });
    const first = await queue.enqueue({
      type: "AUTO_PLAYLIST_REFRESH",
      priority: JobPriority.NORMAL,
      payload: { userId: "u1" },
      dedupeKey: "AUTO_PLAYLIST_REFRESH:u1",
    });
    await queue.complete(first.id);
    time.advance(60_000);

    const second = await queue.enqueue({
      type: "AUTO_PLAYLIST_REFRESH",
      priority: JobPriority.HIGH,
      payload: { userId: "u1" },
      dedupeKey: "AUTO_PLAYLIST_REFRESH:u1",
    });

    expect(second.id).toBe(first.id);
    expect(second.state).toBe("QUEUED");
    expect(second.priority).toBe(JobPriority.HIGH);
    expect(await queue.list("QUEUED")).toHaveLength(1);
  });

  it("collapses queued Kitsu sync jobs to the highest sync type and priority", async () => {
    const time = new FakeTime();
    const queue = new JobQueue(new FakeJobRepository(() => new Date(time.now())), {
      now: () => new Date(time.now()),
    });

    const delta = await queue.enqueue({
      type: "KITSU_DELTA_SYNC",
      priority: JobPriority.NORMAL,
      payload: { userId: "u1" },
      dedupeKey: "KITSU_SYNC:u1",
    });
    const full = await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: "u1" },
      dedupeKey: "KITSU_SYNC:u1",
    });
    const laterDelta = await queue.enqueue({
      type: "KITSU_DELTA_SYNC",
      priority: JobPriority.MAINTENANCE,
      payload: { userId: "u1" },
      dedupeKey: "KITSU_SYNC:u1",
    });

    expect(full.id).toBe(delta.id);
    expect(laterDelta.id).toBe(delta.id);
    expect(laterDelta.type).toBe("KITSU_FULL_SYNC");
    expect(laterDelta.priority).toBe(JobPriority.HIGH);
    expect(await queue.list()).toHaveLength(1);
  });

  it("does not let a completed full sync pin future delta requests to full", async () => {
    const time = new FakeTime();
    const queue = new JobQueue(new FakeJobRepository(() => new Date(time.now())), {
      now: () => new Date(time.now()),
    });

    const full = await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: "u1" },
      dedupeKey: "KITSU_SYNC:u1",
    });
    await queue.complete(full.id);
    time.advance(60_000);

    const delta = await queue.enqueue({
      type: "KITSU_DELTA_SYNC",
      priority: JobPriority.NORMAL,
      payload: { userId: "u1" },
      dedupeKey: "KITSU_SYNC:u1",
    });

    expect(delta.id).toBe(full.id);
    expect(delta.type).toBe("KITSU_DELTA_SYNC");
    expect(delta.priority).toBe(JobPriority.NORMAL);
  });
});

describe("JobWorker", () => {
  it("marks jobs done after a handler succeeds", async () => {
    const time = new FakeTime();
    const repo = new FakeJobRepository(() => new Date(time.now()));
    const queue = new JobQueue(repo, { now: () => new Date(time.now()) });
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.NORMAL,
      payload: { themeId: 1 },
      dedupeKey: "FETCH_AUDIO:1",
    });

    const worker = new JobWorker(queue, {
      handlers: { FETCH_AUDIO: async () => {} },
      now: () => new Date(time.now()),
      sleep: time.sleep,
    });

    expect(await worker.runOnce()).toBe(true);
    expect((await queue.list("DONE"))).toHaveLength(1);
  });

  it("backs off retryable failures and parks a job as FAILED after max attempts", async () => {
    const time = new FakeTime();
    const repo = new FakeJobRepository(() => new Date(time.now()));
    const queue = new JobQueue(repo, { now: () => new Date(time.now()) });
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.NORMAL,
      payload: { themeId: 1 },
      dedupeKey: "FETCH_AUDIO:1",
      maxAttempts: 2,
    });

    const worker = new JobWorker(queue, {
      handlers: {
        FETCH_AUDIO: async () => {
          throw new RetryableJobError("origin down");
        },
      },
      now: () => new Date(time.now()),
      sleep: time.sleep,
      jitterMs: () => 0,
    });

    await worker.runOnce();
    const queued = (await queue.list("QUEUED"))[0]!;
    expect(queued.attempts).toBe(1);
    expect(queued.nextRunAt.getTime() - time.now()).toBe(60_000);

    time.advance(60_000);
    await worker.runOnce();
    const failed = (await queue.list("FAILED"))[0]!;
    expect(failed.attempts).toBe(2);
    expect(failed.lastError).toContain("origin down");
  });

  it("holds maintenance hydration while on-demand media traffic is active", async () => {
    const time = new FakeTime();
    const repo = new FakeJobRepository(() => new Date(time.now()));
    const queue = new JobQueue(repo, { now: () => new Date(time.now()) });
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.MAINTENANCE,
      payload: { themeId: 1 },
      dedupeKey: "FETCH_AUDIO:1",
    });

    let interactiveBusy = true;
    const ran: number[] = [];
    const worker = new JobWorker(queue, {
      handlers: {
        FETCH_AUDIO: async (payload) => {
          ran.push(payload.themeId as number);
        },
      },
      now: () => new Date(time.now()),
      sleep: time.sleep,
      holdMaintenanceWork: () => interactiveBusy,
    });

    // While a client is actively pulling media, background hydration waits...
    expect(await worker.runOnce()).toBe(false);
    expect(ran).toEqual([]);

    // ...but urgent (client-facing) jobs still run.
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 2 },
      dedupeKey: "FETCH_AUDIO:2",
    });
    expect(await worker.runOnce()).toBe(true);
    expect(ran).toEqual([2]);

    // Once traffic goes quiet, hydration resumes.
    interactiveBusy = false;
    expect(await worker.runOnce()).toBe(true);
    expect(ran).toEqual([2, 1]);
  });

  it("restricts a worker with maxPriority to urgent/high jobs", async () => {
    const time = new FakeTime();
    const repo = new FakeJobRepository(() => new Date(time.now()));
    const queue = new JobQueue(repo, { now: () => new Date(time.now()) });
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.NORMAL,
      payload: { themeId: 1 },
      dedupeKey: "FETCH_AUDIO:1",
    });

    const ran: number[] = [];
    const worker = new JobWorker(queue, {
      handlers: {
        FETCH_AUDIO: async (payload) => {
          ran.push(payload.themeId as number);
        },
      },
      now: () => new Date(time.now()),
      sleep: time.sleep,
      maxPriority: JobPriority.HIGH,
    });

    expect(await worker.runOnce()).toBe(false);

    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.HIGH,
      payload: { themeId: 2 },
      dedupeKey: "FETCH_AUDIO:2",
    });
    expect(await worker.runOnce()).toBe(true);
    expect(ran).toEqual([2]);
  });

  it("skips the maintenance politeness delay when urgent work is queued", async () => {
    const time = new FakeTime();
    const repo = new FakeJobRepository(() => new Date(time.now()));
    const queue = new JobQueue(repo, { now: () => new Date(time.now()) });
    const worker = new JobWorker(queue, {
      handlers: { FETCH_AUDIO: async () => {} },
      now: () => new Date(time.now()),
      sleep: time.sleep,
      maintenanceFetchDelayMs: 8_000,
    });

    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.MAINTENANCE,
      payload: { themeId: 1 },
      dedupeKey: "FETCH_AUDIO:1",
    });
    await worker.runOnce();
    // No urgent work waiting — the politeness delay applies.
    expect(time.sleeps).toContain(8_000);

    time.sleeps.length = 0;
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.MAINTENANCE,
      payload: { themeId: 2 },
      dedupeKey: "FETCH_AUDIO:2",
    });
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 3 },
      dedupeKey: "FETCH_AUDIO:3",
    });
    await worker.runOnce(); // runs the urgent job (no delay: not maintenance)
    await worker.runOnce(); // runs the maintenance job — but nothing urgent is left
    expect(time.sleeps).toContain(8_000);

    time.sleeps.length = 0;
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.MAINTENANCE,
      payload: { themeId: 4 },
      dedupeKey: "FETCH_AUDIO:4",
    });
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 5 },
      dedupeKey: "FETCH_AUDIO:5",
    });
    await worker.runOnce(); // urgent first
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 6 },
      dedupeKey: "FETCH_AUDIO:6",
    });
    await worker.runOnce(); // maintenance job, but an urgent job is now waiting
    expect(time.sleeps).not.toContain(8_000);
  });
});

