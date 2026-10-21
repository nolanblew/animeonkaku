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
  it("lets existing Android clients complete an independent import while catalog work fails or retries", async () => {
    const { repo, queue, service } = setup();
    const sync = await queue.enqueue({ type: "KITSU_FULL_SYNC", priority: 10, payload: { userId: USER } });
    await repo.updateProgress(sync.id, { phase: "DONE", independentlyRetryableStages: true });
    await repo.complete(sync.id);
    const mapping = await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: USER } });
    await repo.fail(mapping.id, { state: "FAILED", lastError: "HTTP 403 cloudflare", nextRunAt: new Date(), incrementAttempts: true });
    const failed = await service.getStatus(USER);
    expect(failed).toMatchObject({ state: "DONE", phase: "DONE", mapping: null, upstreamBlocked: false, libraryState: "DONE" });
    expect(failed.stages?.catalog).toMatchObject({ state: "FAILED", lastError: "HTTP 403 cloudflare" });
    await repo.fail(mapping.id, { state: "QUEUED", lastError: "HTTP 403 cloudflare", nextRunAt: new Date(Date.now() + 60_000), incrementAttempts: false });
    const retrying = await service.getStatus(USER);
    expect(retrying).toMatchObject({ state: "DONE", phase: "DONE", mapping: null, upstreamBlocked: false });
    expect(retrying.stages?.catalog).toMatchObject({ state: "QUEUED", lastError: "HTTP 403 cloudflare" });
  });
  it("keeps library completion separate from failed and retrying downstream stages", async () => {
    const { repo, queue, service } = setup();
    const sync = await queue.enqueue({ type: "KITSU_FULL_SYNC", priority: 10, payload: { userId: USER } });
    await repo.complete(sync.id);
    const failed = await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: USER, kitsuIds: ["1"] } });
    await repo.fail(failed.id, { state: "FAILED", lastError: "HTTP 403", nextRunAt: new Date(), incrementAttempts: true });
    const laterSuccess = await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: USER, kitsuIds: ["2"] } });
    await repo.updateProgress(laterSuccess.id, { unmatched: ["2"] });
    await repo.complete(laterSuccess.id);
    const playlist = await queue.enqueue({ type: "AUTO_PLAYLIST_REFRESH", priority: 20, payload: { userId: USER } });
    const nextRetryAt = new Date(Date.now() + 60_000);
    await repo.fail(playlist.id, { state: "QUEUED", lastError: "temporary database failure", nextRunAt: nextRetryAt, incrementAttempts: true });

    const status = await service.getStatus(USER);
    expect(status.libraryState).toBe("DONE");
    expect(status.libraryLastCompletedAt).toBeTypeOf("number");
    expect(status.upstreamBlocked).toBe(true);
    expect(status.stages?.catalog).toMatchObject({ state: "FAILED", counts: { FAILED: 1, DONE: 1 }, failedJobIds: [failed.id], attentionCount: 1 });
    expect(status.stages?.playlists).toMatchObject({ state: "QUEUED", nextRetryAt: nextRetryAt.getTime(), lastError: "temporary database failure" });
  });

  it("reads each stage separately so a large catalog cannot hide library completion", async () => {
    const { repo, queue, service } = setup();
    const sync = await queue.enqueue({ type: "KITSU_FULL_SYNC", priority: 10, payload: { userId: USER } });
    await repo.complete(sync.id);
    for (let i = 0; i < 665; i += 1) await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: USER, kitsuIds: [String(i)] } });
    const status = await service.getStatus(USER);
    expect(status.libraryState).toBe("DONE");
    expect(status.stages?.catalog.counts.QUEUED).toBe(665);
  });

  it("retries only failed jobs belonging to the authenticated user and requested stage", async () => {
    const { repo, queue, service } = setup();
    const own = await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: USER } });
    const other = await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: "other" } });
    const music = await queue.enqueue({ type: "MUSIC_POLICY_SYNC", priority: 20, payload: { userId: USER } });
    for (const job of [own, other, music]) await repo.fail(job.id, { state: "FAILED", lastError: "failure", nextRunAt: new Date(), incrementAttempts: true });
    const queued = await queue.enqueue({ type: "MAP_THEMES", priority: 20, payload: { userId: USER }, nextRunAt: new Date(Date.now() + 60_000) });
    expect(await service.retryStage(USER, "catalog")).toEqual({ retried: 1 });
    expect(repo.jobs.get(own.id)?.state).toBe("QUEUED");
    expect(repo.jobs.get(other.id)?.state).toBe("FAILED");
    expect(repo.jobs.get(music.id)?.state).toBe("FAILED");
    expect(repo.jobs.get(queued.id)?.nextRunAt).toEqual(queued.nextRunAt);
  });

  it("reports the persisted library watermark while a new import is queued", async () => {
    const { queue } = setup();
    await queue.enqueue({ type: "KITSU_FULL_SYNC", priority: 10, payload: { userId: USER } });
    const service = new JobSyncApiService(queue, async () => new Date("2026-10-20T12:00:00Z"));
    expect((await service.getStatus(USER)).libraryLastCompletedAt).toBe(Date.parse("2026-10-20T12:00:00Z"));
  });

  it("does not report a skipped reauthentication-required import as a completed library", async () => {
    const { repo, queue, service } = setup();
    const sync = await queue.enqueue({ type: "KITSU_FULL_SYNC", priority: 10, payload: { userId: USER } });
    await repo.updateProgress(sync.id, { phase: "SKIPPED", reason: "REAUTH_REQUIRED" });
    await repo.complete(sync.id);
    const status = await service.getStatus(USER);
    expect(status.libraryState).toBe("FAILED");
    expect(status.libraryLastCompletedAt).toBeNull();
    expect(status.stages?.library).toMatchObject({ state: "FAILED", lastCompletedAt: null, lastError: "Kitsu import skipped: REAUTH_REQUIRED" });
  });

  it("does not let a retained import failure poison a later successful library stage", async () => {
    const { repo, queue, service } = setup();
    const old = await queue.enqueue({ type: "KITSU_FULL_SYNC", priority: 10, payload: { userId: USER } });
    await repo.fail(old.id, { state: "FAILED", nextRunAt: new Date(), lastError: "old failure", incrementAttempts: true });
    const sync = await queue.enqueue({ type: "KITSU_FULL_SYNC", priority: 10, payload: { userId: USER } });
    await repo.complete(sync.id);
    expect((await service.getStatus(USER)).stages?.library).toMatchObject({ state: "DONE", lastError: null, counts: { DONE: 1, FAILED: 0 } });
  });
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

  it("does not let an old mapping failure poison a newly queued sync retry", async () => {
    const { repo, queue, service } = setup();
    const oldSync = await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: USER },
      dedupeKey: `old:KITSU_FULL_SYNC:${USER}`,
    });
    await repo.complete(oldSync.id);
    const oldMapping = await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1"], userId: USER },
      dedupeKey: `old:MAP_THEMES:${USER}:1`,
    });
    await repo.fail(oldMapping.id, {
      state: "FAILED",
      nextRunAt: new Date(),
      lastError: "AnimeThemes request failed with HTTP 403: cloudflare",
      incrementAttempts: true,
    });
    await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: USER },
      dedupeKey: `retry:KITSU_FULL_SYNC:${USER}`,
    });

    const status = await service.getStatus(USER);

    expect(status.state).toBe("QUEUED");
    expect(status.upstreamBlocked).toBe(false);
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

  it("keeps sync running while theme mapping is still queued after Kitsu sync completes", async () => {
    const { repo, queue, service } = setup();
    const sync = await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: USER },
      dedupeKey: `KITSU_FULL_SYNC:${USER}`,
    });
    await repo.complete(sync.id);
    await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1"], userId: USER },
      dedupeKey: `MAP_THEMES:${USER}:1`,
    });

    const status = await service.getStatus(USER);
    expect(status.state).toBe("QUEUED");
    expect(status.phase).toBe("MAPPING_THEMES");
    expect(status.mapping?.state).toBe("QUEUED");
  });

  it("keeps sync running while theme mapping is running after Kitsu sync completes", async () => {
    const { repo, queue, service } = setup();
    const sync = await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: USER },
      dedupeKey: `KITSU_FULL_SYNC:${USER}`,
    });
    await repo.complete(sync.id);
    const map = await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1"], userId: USER },
      dedupeKey: `MAP_THEMES:${USER}:1`,
    });
    await repo.claimNext(new Date());

    const status = await service.getStatus(USER);
    expect(map.id).toBeGreaterThan(0);
    expect(status.state).toBe("RUNNING");
    expect(status.phase).toBe("MAPPING_THEMES");
    expect(status.mapping?.state).toBe("RUNNING");
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
