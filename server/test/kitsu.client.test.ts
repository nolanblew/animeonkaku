import { describe, expect, it } from "vitest";
import { KitsuClient } from "../src/kitsu/kitsuClient.js";
import { UpstreamHttp } from "../src/http/upstream.js";
import { routedFetch } from "./helpers/fakeFetch.js";
import { FakeTime } from "./helpers/fakeTime.js";

function makeClient(routes: Parameters<typeof routedFetch>[0], pageLimit = 500) {
  const { fetch, requests } = routedFetch(routes);
  const time = new FakeTime();
  const http = new UpstreamHttp({ fetch, sleep: time.sleep, maxRetries: 0 });
  return { client: new KitsuClient({ http, pageLimit }), requests };
}

function libraryEntry(animeId: string, opts: { status?: string; ratingTwenty?: number | null; updatedAt?: string } = {}) {
  return {
    id: `le-${animeId}`,
    type: "libraryEntries",
    attributes: {
      status: opts.status ?? "current",
      ratingTwenty: opts.ratingTwenty ?? null,
      updatedAt: opts.updatedAt ?? "2026-06-01T00:00:00.000Z",
    },
    relationships: { anime: { data: { type: "anime", id: animeId } } },
  };
}

function includedAnime(id: string, title: string) {
  return {
    id,
    type: "anime",
    attributes: {
      canonicalTitle: title,
      titles: { en: `${title} EN`, en_jp: `${title} Romaji`, ja_jp: `${title} JA` },
      abbreviatedTitles: [`${title} abbr`],
      posterImage: { tiny: "t.jpg", small: "s.jpg", large: "l.jpg", original: "o.jpg" },
      coverImage: { small: "cs.jpg" },
      subtype: "TV",
      startDate: "2024-01-01",
      endDate: null,
      episodeCount: 12,
      ageRating: "PG",
      averageRating: "82.5",
      slug: `slug-${id}`,
    },
  };
}

describe("KitsuClient.getLibraryEntries", () => {
  it("parses entries with conversions and follows pagination", async () => {
    const page1 = JSON.stringify({
      data: [libraryEntry("1", { ratingTwenty: 16 }), libraryEntry("2")],
      included: [includedAnime("1", "Frieren"), includedAnime("2", "Mushoku")],
      meta: { count: 3 },
    });
    const page2 = JSON.stringify({
      data: [libraryEntry("3", { status: "completed" })],
      included: [includedAnime("3", "Steins;Gate")],
      meta: { count: 3 },
    });
    const { client, requests } = makeClient(
      [
        { match: "page%5Boffset%5D=0", response: { status: 200, body: page1 } },
        { match: "page%5Boffset%5D=2", response: { status: 200, body: page2 } },
      ],
      2,
    );

    const entries = await client.getLibraryEntries("12345", { accessToken: "at" });

    expect(entries).toHaveLength(3);
    const first = entries[0]!;
    expect(first.id).toBe("1");
    expect(first.title).toBe("Frieren EN");
    expect(first.titleRomaji).toBe("Frieren Romaji");
    expect(first.posterUrl).toBe("o.jpg"); // original preferred
    expect(first.userRating).toBe(8); // ratingTwenty 16 → 8
    expect(first.averageRating).toBe(8.25); // "82.5" → 8.25
    expect(first.watchingStatus).toBe("current");
    expect(entries[2]!.watchingStatus).toBe("completed");

    expect(requests).toHaveLength(2);
    const headers = requests[0]!.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer at");
    expect(headers["Accept"]).toBe("application/vnd.api+json");
  });

  it("backfills missing titles/posters via the anime details endpoint", async () => {
    const page = JSON.stringify({
      data: [libraryEntry("9")],
      included: [], // anime not included → details lookup required
      meta: { count: 1 },
    });
    const details = JSON.stringify({ data: [includedAnime("9", "Lain")] });
    const { client } = makeClient([
      { match: "library-entries", response: { status: 200, body: page } },
      { match: "anime?filter%5Bid%5D=9", response: { status: 200, body: details } },
    ]);

    const entries = await client.getLibraryEntries("12345");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe("Lain EN");
    expect(entries[0]!.posterUrl).toBe("o.jpg");
  });
});

describe("KitsuClient.getLibraryEntriesUpdatedSince", () => {
  it("stops at the first entry older than the cutoff", async () => {
    const page = JSON.stringify({
      data: [
        libraryEntry("1", { updatedAt: "2026-06-10T00:00:00.000Z" }),
        libraryEntry("2", { updatedAt: "2026-06-01T00:00:00.000Z" }), // older than cutoff
        libraryEntry("3", { updatedAt: "2026-05-01T00:00:00.000Z" }),
      ],
      included: [includedAnime("1", "A"), includedAnime("2", "B"), includedAnime("3", "C")],
      meta: { count: 3 },
    });
    const { client, requests } = makeClient([
      { match: "library-entries", response: { status: 200, body: page } },
    ]);

    const entries = await client.getLibraryEntriesUpdatedSince(
      "12345",
      "2026-06-05T00:00:00.000Z",
    );
    expect(entries.map((e) => e.id)).toEqual(["1"]);
    expect(requests).toHaveLength(1);
  });
});

describe("KitsuClient.getAnimeMappings", () => {
  it("returns external site ids per kitsu id", async () => {
    const body = JSON.stringify({
      data: [
        {
          id: "1",
          type: "anime",
          relationships: { mappings: { data: [{ type: "mappings", id: "m1" }] } },
        },
      ],
      included: [
        {
          id: "m1",
          type: "mappings",
          attributes: { externalSite: "myanimelist/anime", externalId: "5114" },
        },
      ],
    });
    const { client } = makeClient([{ match: "include=mappings", response: { status: 200, body } }]);
    const mappings = await client.getAnimeMappings(["1"]);
    expect(mappings.get("1")).toEqual({ "myanimelist/anime": "5114" });
  });
});

describe("KitsuClient.getAnimeCategories", () => {
  it("returns genres per kitsu id", async () => {
    const body = JSON.stringify({
      data: [
        {
          id: "1",
          type: "anime",
          relationships: { categories: { data: [{ type: "categories", id: "c1" }] } },
        },
      ],
      included: [{ id: "c1", type: "categories", attributes: { slug: "action", title: "Action" } }],
    });
    const { client } = makeClient([
      { match: "include=categories", response: { status: 200, body } },
    ]);
    const categories = await client.getAnimeCategories(["1"]);
    expect(categories.get("1")).toEqual([
      { slug: "action", displayName: "Action", source: "category" },
    ]);
  });
});

describe("error handling", () => {
  it("throws a KitsuApiError carrying the status on non-2xx", async () => {
    const { client } = makeClient([{ match: "library-entries", response: { status: 500 } }]);
    await expect(client.getLibraryEntries("12345")).rejects.toThrow(/500/);
  });
});
