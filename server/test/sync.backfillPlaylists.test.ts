import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import { LibrarySyncPipeline } from "../src/sync/librarySyncPipeline.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

class FakeMaintenanceRepo {
  missingAudioIds = [101, 202];
  failedAudioIds = [303];
  refreshed: string[] = [];
  markedMissing: string[] = [];
  readyPaths = ["audio/ready.ogg"];

  async getThemeIdsMissingReadyAudio(userId?: string) {
    return userId === "u1" ? this.missingAudioIds : [];
  }

  async refreshAutoPlaylists(userId: string) {
    this.refreshed.push(userId);
  }

  async getFailedAudioThemeIds() {
    return this.failedAudioIds;
  }

  async markAudioMediaMissing(themeIds: string[]) {
    this.markedMissing.push(...themeIds);
  }

  async listReadyMediaFilePaths() {
    return this.readyPaths;
  }
}

async function claimedJob(queue: JobQueue, type: "BACKFILL_SCAN" | "AUTO_PLAYLIST_REFRESH") {
  await queue.enqueue({ type, priority: JobPriority.MAINTENANCE, payload: {}, dedupeKey: `${type}:test` });
  return (await queue.claimNext())!;
}

describe("LibrarySyncPipeline backfill/playlists/maintenance", () => {
  let tempRoot: string | null = null;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("enqueues MAINTENANCE audio fetches for library themes missing READY audio", async () => {
    const repo = new FakeMaintenanceRepo();
    const queue = new JobQueue(new FakeJobRepository());
    const pipeline = new LibrarySyncPipeline({ repo: repo as never, kitsu: {} as never, animeThemes: {}, queue });
    const job = await claimedJob(queue, "BACKFILL_SCAN");

    await pipeline.runBackfillScan({ userId: "u1", job });

    const fetchJobs = (await queue.list("QUEUED")).filter((queued) => queued.type === "FETCH_AUDIO");
    expect(fetchJobs.map((queued) => [queued.priority, queued.payload, queued.dedupeKey])).toEqual([
      [JobPriority.MAINTENANCE, { themeId: 101 }, "FETCH_AUDIO:101"],
      [JobPriority.MAINTENANCE, { themeId: 202 }, "FETCH_AUDIO:202"],
    ]);
  });

  it("refreshes auto playlists for the user", async () => {
    const repo = new FakeMaintenanceRepo();
    const queue = new JobQueue(new FakeJobRepository());
    const pipeline = new LibrarySyncPipeline({ repo: repo as never, kitsu: {} as never, animeThemes: {}, queue });
    const job = await claimedJob(queue, "AUTO_PLAYLIST_REFRESH");

    await pipeline.runAutoPlaylistRefresh({ userId: "u1", job });

    expect(repo.refreshed).toEqual(["u1"]);
    expect((await queue.list()).find((queued) => queued.id === job.id)?.progress).toMatchObject({
      phase: "DONE",
    });
  });

  it("requeues failed audio media once for weekly maintenance", async () => {
    const repo = new FakeMaintenanceRepo();
    const queue = new JobQueue(new FakeJobRepository());
    const pipeline = new LibrarySyncPipeline({ repo: repo as never, kitsu: {} as never, animeThemes: {}, queue });

    await pipeline.requeueFailedMedia();

    expect(repo.markedMissing).toEqual(["303"]);
    const jobs = (await queue.list("QUEUED")).filter((queued) => queued.type === "FETCH_AUDIO");
    expect(jobs.map((queued) => queued.payload)).toEqual([{ themeId: 303 }]);
  });

  it("deletes orphan files that are not referenced by READY media rows", async () => {
    const repo = new FakeMaintenanceRepo();
    tempRoot = mkdtempSync(join(tmpdir(), "ongaku-media-"));
    await mkdir(join(tempRoot, "audio"), { recursive: true });
    writeFileSync(join(tempRoot, "audio", "ready.ogg"), "ready");
    writeFileSync(join(tempRoot, "audio", "orphan.ogg"), "orphan");

    const queue = new JobQueue(new FakeJobRepository());
    const pipeline = new LibrarySyncPipeline({ repo: repo as never, kitsu: {} as never, animeThemes: {}, queue });

    const removed = await pipeline.scanOrphanFiles(tempRoot);

    expect(removed).toEqual(["audio/orphan.ogg"]);
    expect(existsSync(join(tempRoot, "audio", "ready.ogg"))).toBe(true);
    expect(existsSync(join(tempRoot, "audio", "orphan.ogg"))).toBe(false);
  });
});
