import { describe, expect, it, vi } from "vitest";
import { DrizzleClientApiService } from "../src/api/drizzleClientApiService.js";
import type { JobQueue } from "../src/jobs/index.js";

type ReadyMusicRow = {
  animeThemesId: number;
  kitsuId: string;
  animeTitle: string | null;
  animeTitleEn: string | null;
  animeTitleRomaji: string | null;
  animeTitleJa: string | null;
  animePosterUrl: string | null;
  animePosterUrlLarge: string | null;
  releaseId: number;
  releaseTitle: string;
  releaseTitleEnglish: string | null;
  releaseTitleRomaji: string | null;
  releaseTitleJapanese: string | null;
  releaseArtistCredit: string;
  releaseArtistNames: Array<{ english?: string | null }>;
  relationshipType: string;
  releaseDate: string | null;
  artworkUrl: string | null;
  songId: number;
  songTitle: string;
  songTitleEnglish: string | null;
  songTitleRomaji: string | null;
  songTitleJapanese: string | null;
  songArtistCredit: string;
  songArtistNames: Array<{ english?: string | null }>;
  durationSeconds: number | null;
  fileSize: number | null;
  discNumber: number;
  trackNumber: number | null;
  displayOrder: number;
};

const queue = { enqueue: async () => ({ id: 1 }) } as unknown as JobQueue;

describe("listener music catalog query shape", () => {
  it("builds a multi-anime catalog without per-library-item lookups", async () => {
    const db = {
      select: vi.fn(() => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: async () => [
                { kitsuId: "one", animeThemesId: 1, title: "One", titleEn: null, posterUrl: null, posterUrlLarge: null },
                { kitsuId: "two", animeThemesId: 2, title: "Two", titleEn: null, posterUrl: null, posterUrlLarge: null },
                { kitsuId: "three", animeThemesId: 3, title: "Three", titleEn: null, posterUrl: null, posterUrlLarge: null },
              ],
            }),
          }),
        }),
      })),
    };
    const service = new DrizzleClientApiService(db as never, queue, undefined, undefined, true);
    const internals = service as unknown as {
      readyMusicRows(animeThemesIds?: number[], releaseId?: number): Promise<ReadyMusicRow[]>;
    };
    const readyRows = vi.spyOn(internals, "readyMusicRows").mockResolvedValue([
      readyRow(200, 100, "One Album", "one", 1),
      readyRow(201, 101, "Two Album", "two", 2),
      readyRow(202, 102, "Three Album", "three", 3),
    ]);

    const catalog = await service.getMusicCatalog("user-1");

    expect(catalog.map((item) => item.anime.kitsuId)).toEqual(["one", "two", "three"]);
    expect(readyRows).toHaveBeenCalledTimes(1);
  });

  it("returns complete multi-release search results from a bounded number of ready-row reads", async () => {
    const service = new DrizzleClientApiService({} as never, queue, undefined, undefined, true);
    const rows = [readyRow(200, 100, "Ready Album One"), readyRow(201, 101, "Ready Album Two")];
    const internals = service as unknown as {
      readyMusicRows(
        animeThemesIds?: number[],
        releaseId?: number,
        options?: { normalizedQuery?: string; limit?: number; releaseIds?: number[] },
      ): Promise<ReadyMusicRow[]>;
    };
    const readyRows = vi.spyOn(internals, "readyMusicRows").mockImplementation(async (_animeThemesIds, releaseId) =>
      releaseId === undefined ? rows : rows.filter((row) => row.releaseId === releaseId),
    );

    const result = await service.searchMusic("user-1", "ready album");

    expect(result.tracks).toHaveLength(2);
    expect(result.releases).toHaveLength(2);
    expect(readyRows.mock.calls.length).toBeLessThanOrEqual(2);
    expect(readyRows).toHaveBeenNthCalledWith(1, undefined, undefined, {
      normalizedQuery: "ready album",
      limit: 500,
    });
    expect(readyRows).toHaveBeenNthCalledWith(2, undefined, undefined, {
      releaseIds: [200, 201],
    });
  });

  it("hydrates every owner of a selected shared release in one IN lookup", async () => {
    const service = new DrizzleClientApiService({} as never, queue, undefined, undefined, true);
    const internals = service as unknown as {
      readyMusicRows(
        animeThemesIds?: number[],
        releaseId?: number,
        options?: { normalizedQuery?: string; limit?: number; releaseIds?: number[] },
      ): Promise<ReadyMusicRow[]>;
    };
    const matchingOwner = readyRow(200, 100, "Shared Album", "one", 1);
    matchingOwner.animeTitle = "One Anime";
    const otherOwner = readyRow(200, 100, "Shared Album", "two", 2);
    otherOwner.animeTitle = "Two Anime";
    const secondTrack = readyRow(200, 101, "Shared Album", "two", 2);
    secondTrack.animeTitle = "Two Anime";
    vi.spyOn(internals, "readyMusicRows").mockImplementation(async (_animeThemesIds, _releaseId, options) =>
      options?.releaseIds ? [matchingOwner, otherOwner, secondTrack] : [matchingOwner],
    );

    const result = await service.searchMusic("user-1", "one anime");

    expect(result.releases).toMatchObject([{
      anime: [{ kitsuId: "one" }, { kitsuId: "two" }],
      release: { id: 200, tracks: [{ id: 100 }, { id: 101 }] },
    }]);
  });
});

function readyRow(
  releaseId: number,
  songId: number,
  releaseTitle: string,
  kitsuId = "kitsu-1",
  animeThemesId = 1,
): ReadyMusicRow {
  return {
    animeThemesId,
    kitsuId,
    animeTitle: "Ready Anime",
    animeTitleEn: "Ready Anime",
    animeTitleRomaji: null,
    animeTitleJa: null,
    animePosterUrl: null,
    animePosterUrlLarge: null,
    releaseId,
    releaseTitle,
    releaseTitleEnglish: null,
    releaseTitleRomaji: null,
    releaseTitleJapanese: null,
    releaseArtistCredit: "Ready Artist",
    releaseArtistNames: [{ english: "Ready Artist" }],
    relationshipType: "SOUNDTRACK",
    releaseDate: "2026-01-01",
    artworkUrl: null,
    songId,
    songTitle: `Ready Song ${songId}`,
    songTitleEnglish: null,
    songTitleRomaji: null,
    songTitleJapanese: null,
    songArtistCredit: "Ready Artist",
    songArtistNames: [{ english: "Ready Artist" }],
    durationSeconds: 180,
    fileSize: 123,
    discNumber: 1,
    trackNumber: 1,
    displayOrder: 0,
  };
}
