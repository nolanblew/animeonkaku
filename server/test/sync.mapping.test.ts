import { describe, expect, it } from "vitest";
import type { AnimeThemeEntry, AnimeThemesLookupResult } from "../src/animethemes/types.js";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import { LibrarySyncPipeline } from "../src/sync/librarySyncPipeline.js";
import type { KitsuCatalogRecord } from "../src/sync/types.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

function theme(input: Partial<AnimeThemeEntry> & { animeId: number; themeId: number }): AnimeThemeEntry {
  return {
    animeId: input.animeId,
    animeName: input.animeName ?? `AnimeThemes ${input.animeId}`,
    animeNameEn: input.animeNameEn ?? null,
    animeSynonyms: input.animeSynonyms ?? [],
    kitsuId: input.kitsuId ?? null,
    coverUrl: input.coverUrl ?? null,
    themeId: input.themeId,
    title: input.title ?? `Song ${input.themeId}`,
    artistName: input.artistName ?? "Artist",
    audioUrl: input.audioUrl ?? `https://a.animethemes.moe/${input.themeId}.ogg`,
    videoUrl: input.videoUrl ?? `https://v.animethemes.moe/${input.themeId}.webm`,
    themeType: input.themeType ?? "OP1",
    artists: input.artists ?? [{ name: "Artist", asCharacter: null, alias: null }],
    videoFallback: input.videoFallback ?? false,
  };
}

function lookup(mappings: Record<string, number>, themes: AnimeThemeEntry[]): AnimeThemesLookupResult {
  return { mappings: new Map(Object.entries(mappings)), themes };
}

class FakeMappingRepo {
  catalog = new Map<string, KitsuCatalogRecord>();
  savedThemes: AnimeThemeEntry[] = [];
  mappings = new Map<string, number>();
  unmatched: string[] = [];

  constructor(records: KitsuCatalogRecord[]) {
    for (const record of records) this.catalog.set(record.kitsuId, record);
  }

  async getKitsuAnimeForMapping(kitsuIds: string[]) {
    return kitsuIds.map((id) => this.catalog.get(id)).filter((row): row is KitsuCatalogRecord => row !== undefined);
  }

  async saveAnimeThemesCatalog(themes: AnimeThemeEntry[]) {
    this.savedThemes.push(...themes);
  }

  async setAnimeThemeMappings(mappings: Map<string, number>) {
    for (const [kitsuId, animeThemesId] of mappings) this.mappings.set(kitsuId, animeThemesId);
  }

  async markAnimeUnmatched(kitsuIds: string[]) {
    this.unmatched.push(...kitsuIds);
  }
}

function catalog(kitsuId: string, title: string): KitsuCatalogRecord {
  return {
    kitsuId,
    title,
    titleEn: title,
    titleRomaji: `${title} Romaji`,
    titleJa: null,
    abbreviatedTitles: [],
    animethemesAnimeId: null,
    mappingState: "UNMAPPED",
  };
}

describe("LibrarySyncPipeline theme mapping", () => {
  it("allows N:1 Kitsu to AnimeThemes mappings from direct Kitsu lookup", async () => {
    const repo = new FakeMappingRepo([catalog("1", "Season 1"), catalog("2", "Season Special")]);
    const queue = new JobQueue(new FakeJobRepository());
    const pipeline = new LibrarySyncPipeline({
      repo: repo as never,
      kitsu: {} as never,
      animeThemes: {
        fetchByKitsuIds: async () => lookup({ "1": 99, "2": 99 }, [theme({ animeId: 99, themeId: 100 })]),
      },
      queue,
    });
    await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1", "2"], userId: "u1" },
      dedupeKey: "MAP_THEMES:u1:1,2",
    });
    const job = (await queue.claimNext())!;

    await pipeline.runMapThemes({ kitsuIds: ["1", "2"], userId: "u1", job });

    expect(repo.mappings).toEqual(new Map([["1", 99], ["2", 99]]));
    expect(repo.savedThemes.map((saved) => saved.themeId)).toEqual([100]);
  });

  it("falls back through MAL ids, strict title matches, and marks remaining anime unmatched", async () => {
    const repo = new FakeMappingRepo([
      catalog("3", "Fullmetal Alchemist"),
      catalog("4", "Serial Experiments Lain"),
      catalog("5", "No Match"),
      catalog("6", "Wrong Owner"),
    ]);
    const queue = new JobQueue(new FakeJobRepository());
    const searches: string[] = [];
    const pipeline = new LibrarySyncPipeline({
      repo: repo as never,
      kitsu: {
        getAnimeMappings: async () =>
          new Map([["3", { "myanimelist/anime": "5114" }]]),
      } as never,
      animeThemes: {
        fetchByKitsuIds: async () => lookup({}, []),
        fetchByMalIds: async () => lookup({ "5114": 77 }, [theme({ animeId: 77, themeId: 770 })]),
        searchByTitle: async (titleValue: string) => {
          searches.push(titleValue);
          if (titleValue === "Serial Experiments Lain") {
            return lookup({}, [theme({ animeId: 88, themeId: 880, animeName: "Serial Experiments Lain" })]);
          }
          if (titleValue === "Wrong Owner") {
            return lookup({}, [theme({ animeId: 66, themeId: 660, animeName: "Wrong Owner", kitsuId: "999" })]);
          }
          return lookup({}, [theme({ animeId: 55, themeId: 550, animeName: "Different Title" })]);
        },
      },
      queue,
    });
    await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["3", "4", "5", "6"], userId: "u1" },
      dedupeKey: "MAP_THEMES:u1:3,4,5,6",
    });
    const job = (await queue.claimNext())!;

    await pipeline.runMapThemes({ kitsuIds: ["3", "4", "5", "6"], userId: "u1", job });

    expect(repo.mappings).toEqual(new Map([["3", 77], ["4", 88]]));
    expect(repo.unmatched.sort()).toEqual(["5", "6"]);
    expect(searches).toContain("Serial Experiments Lain");
    expect(searches).toContain("Wrong Owner");
  });

  it("accepts strict title matches against AnimeThemes synonyms", async () => {
    const repo = new FakeMappingRepo([catalog("7", "Tiger X Dragon")]);
    const queue = new JobQueue(new FakeJobRepository());
    const synonymMatch = {
      ...theme({ animeId: 777, themeId: 7770, animeName: "Toradora!" }),
      animeSynonyms: ["Tiger X Dragon"],
    };
    const pipeline = new LibrarySyncPipeline({
      repo: repo as never,
      kitsu: {} as never,
      animeThemes: {
        fetchByKitsuIds: async () => lookup({}, []),
        searchByTitle: async () => lookup({}, [synonymMatch]),
      },
      queue,
    });
    await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["7"], userId: "u1" },
      dedupeKey: "MAP_THEMES:u1:7",
    });
    const job = (await queue.claimNext())!;

    await pipeline.runMapThemes({ kitsuIds: ["7"], userId: "u1", job });

    expect(repo.mappings).toEqual(new Map([["7", 777]]));
    expect(repo.unmatched).toEqual([]);
  });

  it("yields between mapping batches when an urgent job is queued", async () => {
    const repo = new FakeMappingRepo([catalog("1", "A"), catalog("2", "B"), catalog("3", "C")]);
    const queue = new JobQueue(new FakeJobRepository());
    const batches: string[][] = [];
    const pipeline = new LibrarySyncPipeline({
      repo: repo as never,
      kitsu: {} as never,
      animeThemes: {
        fetchByKitsuIds: async (ids: string[]) => {
          batches.push(ids);
          return lookup(Object.fromEntries(ids.map((id) => [id, Number(id)])), ids.map((id) => theme({ animeId: Number(id), themeId: Number(id) * 10 })));
        },
      },
      queue,
      mappingBatchSize: 1,
    });
    await queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.NORMAL,
      payload: { kitsuIds: ["1", "2", "3"], userId: "u1" },
      dedupeKey: "MAP_THEMES:u1:1,2,3",
    });
    const job = (await queue.claimNext())!;
    await queue.enqueue({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 999 },
      dedupeKey: "FETCH_AUDIO:999",
    });

    await pipeline.runMapThemes({ kitsuIds: ["1", "2", "3"], userId: "u1", job });

    expect(batches).toEqual([["1"]]);
    expect(repo.mappings).toEqual(new Map([["1", 1]]));
    const continuation = (await queue.list("QUEUED")).find((queued) => queued.type === "MAP_THEMES");
    expect(continuation?.payload).toEqual({ kitsuIds: ["2", "3"], userId: "u1" });
  });
});
