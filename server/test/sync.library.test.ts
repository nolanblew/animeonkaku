import { describe, expect, it } from "vitest";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import type { KitsuAnimeEntry, KitsuGenre } from "../src/kitsu/types.js";
import { LibrarySyncPipeline } from "../src/sync/librarySyncPipeline.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";
import { FakeTime } from "./helpers/fakeTime.js";

function entry(id: string, overrides: Partial<KitsuAnimeEntry> = {}): KitsuAnimeEntry {
  return {
    id,
    title: `Anime ${id}`,
    titleEn: `Anime ${id}`,
    titleRomaji: `Anime ${id} Romaji`,
    titleJa: null,
    abbreviatedTitles: [`A${id}`],
    posterUrl: `https://kitsu.test/${id}/poster.jpg`,
    posterUrlLarge: null,
    coverUrl: null,
    coverUrlLarge: null,
    watchingStatus: "current",
    subtype: "TV",
    startDate: "2024-01-01",
    endDate: null,
    episodeCount: 12,
    ageRating: "PG",
    averageRating: 8.1,
    userRating: 9,
    libraryUpdatedAt: `2026-06-${id.padStart(2, "0")}T00:00:00.000Z`,
    slug: `anime-${id}`,
    ...overrides,
  };
}

class FakeSyncRepo {
  user = {
    userId: "u1",
    accessToken: "access-token",
    kitsuAuthState: "OK",
    lastSyncAt: null as Date | null,
    lastStatusSyncAt: null as Date | null,
  };
  upsertedAnime: KitsuAnimeEntry[] = [];
  upsertedLibrary: KitsuAnimeEntry[] = [];
  tombstones: string[][] = [];
  genres = new Map<string, KitsuGenre[]>();
  timestampUpdates: Array<{ lastSyncAt?: Date; lastStatusSyncAt?: Date }> = [];
  autoPlaylistRefreshes: string[] = [];

  async getUserSyncAuth(userId: string) {
    return userId === this.user.userId ? this.user : null;
  }

  async upsertKitsuAnime(entries: KitsuAnimeEntry[]) {
    this.upsertedAnime.push(...entries);
  }

  async upsertLibraryEntries(_userId: string, entries: KitsuAnimeEntry[]) {
    this.upsertedLibrary.push(...entries);
  }

  async tombstoneMissingLibraryEntries(_userId: string, activeKitsuIds: string[]) {
    this.tombstones.push(activeKitsuIds);
  }

  async upsertAnimeGenres(kitsuId: string, genres: KitsuGenre[]) {
    this.genres.set(kitsuId, genres);
  }

  async updateUserSyncTimestamps(
    _userId: string,
    timestamps: { lastSyncAt?: Date; lastStatusSyncAt?: Date },
  ) {
    this.timestampUpdates.push(timestamps);
  }

  async refreshAutoPlaylists(userId: string) {
    this.autoPlaylistRefreshes.push(userId);
  }
}

describe("LibrarySyncPipeline Kitsu sync", () => {
  it("full sync writes catalog/library/genres, tombstones missing rows, and enqueues follow-up jobs", async () => {
    const time = new FakeTime(new Date("2026-06-13T00:00:00.000Z").getTime());
    const repo = new FakeSyncRepo();
    const queue = new JobQueue(new FakeJobRepository(() => new Date(time.now())), {
      now: () => new Date(time.now()),
    });
    const kitsuEntries = [entry("1"), entry("2", { watchingStatus: "completed" })];
    const kitsu = {
      getLibraryEntries: async () => kitsuEntries,
      getLibraryEntriesUpdatedSince: async () => [],
      getAnimeCategories: async (ids: string[]) =>
        new Map(ids.map((id) => [id, [{ slug: "action", displayName: "Action", source: "category" }]])),
    };
    const pipeline = new LibrarySyncPipeline({
      repo,
      kitsu,
      animeThemes: {},
      queue,
      now: () => new Date(time.now()),
    });
    await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: "u1", full: true },
      dedupeKey: "KITSU_FULL_SYNC:u1",
    });
    const job = (await queue.claimNext())!;

    await pipeline.runKitsuSync({ userId: "u1", full: true, job });

    expect(repo.upsertedAnime.map((anime) => anime.id)).toEqual(["1", "2"]);
    expect(repo.upsertedLibrary.map((anime) => anime.id)).toEqual(["1", "2"]);
    expect(repo.tombstones).toEqual([["1", "2"]]);
    expect(repo.genres.get("1")).toEqual([
      { slug: "action", displayName: "Action", source: "category" },
    ]);
    expect(repo.timestampUpdates.at(-1)).toEqual({
      lastSyncAt: new Date(time.now()),
      lastStatusSyncAt: new Date(time.now()),
    });
    expect(repo.autoPlaylistRefreshes).toEqual(["u1"]);

    const jobs = await queue.list("QUEUED");
    expect(jobs.map((queued) => [queued.type, queued.payload, queued.dedupeKey])).toEqual([
      ["MAP_THEMES", { kitsuIds: ["1", "2"], userId: "u1" }, "MAP_THEMES:u1:1,2"],
      ["AUTO_PLAYLIST_REFRESH", { userId: "u1" }, "AUTO_PLAYLIST_REFRESH:u1"],
    ]);
    expect((await queue.list()).find((queued) => queued.id === job.id)?.progress).toMatchObject({
      phase: "DONE",
      total: 2,
    });
  });

  it("delta sync uses lastStatusSyncAt, does not tombstone, and refreshes auto playlists even when unchanged", async () => {
    const repo = new FakeSyncRepo();
    repo.user.lastStatusSyncAt = new Date("2026-06-12T00:00:00.000Z");
    const queue = new JobQueue(new FakeJobRepository());
    const calls: string[] = [];
    const kitsu = {
      getLibraryEntries: async () => {
        calls.push("full");
        return [];
      },
      getLibraryEntriesUpdatedSince: async (_userId: string, sinceIso: string) => {
        calls.push(sinceIso);
        return [];
      },
      getAnimeCategories: async () => new Map<string, KitsuGenre[]>(),
    };
    const pipeline = new LibrarySyncPipeline({ repo, kitsu, animeThemes: {}, queue });
    await queue.enqueue({
      type: "KITSU_DELTA_SYNC",
      priority: JobPriority.NORMAL,
      payload: { userId: "u1", full: false },
      dedupeKey: "KITSU_DELTA_SYNC:u1",
    });
    const job = (await queue.claimNext())!;

    await pipeline.runKitsuSync({ userId: "u1", full: false, job });

    expect(calls).toEqual(["2026-06-12T00:00:00.000Z"]);
    expect(repo.tombstones).toEqual([]);
    expect(repo.upsertedLibrary).toEqual([]);
    expect(repo.autoPlaylistRefreshes).toEqual(["u1"]);
  });

  it("skips users that need Kitsu reauth without calling upstream", async () => {
    const repo = new FakeSyncRepo();
    repo.user.kitsuAuthState = "REAUTH_REQUIRED";
    const queue = new JobQueue(new FakeJobRepository());
    const calls: string[] = [];
    const pipeline = new LibrarySyncPipeline({
      repo,
      kitsu: {
        getLibraryEntries: async () => {
          calls.push("full");
          return [];
        },
        getLibraryEntriesUpdatedSince: async () => [],
        getAnimeCategories: async () => new Map<string, KitsuGenre[]>(),
      },
      animeThemes: {},
      queue,
    });
    await queue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: "u1", full: true },
      dedupeKey: "KITSU_FULL_SYNC:u1",
    });
    const job = (await queue.claimNext())!;

    await pipeline.runKitsuSync({ userId: "u1", full: true, job });

    expect(calls).toEqual([]);
    expect((await queue.list()).find((queued) => queued.id === job.id)?.progress).toMatchObject({
      phase: "SKIPPED",
      reason: "REAUTH_REQUIRED",
    });
  });
});
