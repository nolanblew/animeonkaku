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
});

