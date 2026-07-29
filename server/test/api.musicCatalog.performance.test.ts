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
          where: () => ({
            orderBy: async () => [{ kitsuId: "one" }, { kitsuId: "two" }, { kitsuId: "three" }],
          }),
        }),
      })),
    };
    const service = new DrizzleClientApiService(db as never, queue, undefined, undefined, true);
    const lookup = vi.spyOn(service, "getAnimeMusic").mockImplementation(async (_userId, kitsuId) => ({
      anime: { kitsuId, title: kitsuId, titleEn: null, posterUrl: null },
      releases: [],
    }));

    const catalog = await service.getMusicCatalog("user-1");

    expect(catalog.map((item) => item.anime.kitsuId)).toEqual(["one", "two", "three"]);
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("returns complete multi-release search results from a bounded number of ready-row reads", async () => {
    const service = new DrizzleClientApiService({} as never, queue, undefined, undefined, true);
    const rows = [readyRow(200, 100, "Ready Album One"), readyRow(201, 101, "Ready Album Two")];
    const internals = service as unknown as {
      readyMusicRows(animeThemesIds?: number[], releaseId?: number): Promise<ReadyMusicRow[]>;
    };
    const readyRows = vi.spyOn(internals, "readyMusicRows").mockImplementation(async (_animeThemesIds, releaseId) =>
      releaseId === undefined ? rows : rows.filter((row) => row.releaseId === releaseId),
    );

    const result = await service.searchMusic("user-1", "ready album");

    expect(result.tracks).toHaveLength(2);
    expect(result.releases).toHaveLength(2);
    expect(readyRows.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

function readyRow(releaseId: number, songId: number, releaseTitle: string): ReadyMusicRow {
  return {
    animeThemesId: 1,
    kitsuId: "kitsu-1",
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
