import { describe, expect, it } from "vitest";
import { AnimeThemesClient } from "../src/animethemes/client.js";
import { UpstreamHttp } from "../src/http/upstream.js";
import { routedFetch } from "./helpers/fakeFetch.js";
import { FakeTime } from "./helpers/fakeTime.js";

function makeClient(routes: Parameters<typeof routedFetch>[0]) {
  const { fetch, requests } = routedFetch(routes);
  const time = new FakeTime();
  const http = new UpstreamHttp({ fetch, sleep: time.sleep, maxRetries: 0 });
  return { client: new AnimeThemesClient({ http }), requests };
}

function apiPage(anime: unknown[] = [], links?: { next?: string | null }) {
  return JSON.stringify({ anime, ...(links ? { links } : {}) });
}

function sampleAnime(id = 2984) {
  return {
    id,
    name: "Toradora!",
    resources: [{ site: "Kitsu", external_id: "4224" }],
    images: [{ facet: "Large Cover", path: "covers/toradora.jpg" }],
    animesynonyms: [{ type: "English", text: "Tiger X Dragon" }],
    animethemes: [
      {
        id: 3040,
        type: "OP",
        sequence: 1,
        song: { title: "Pre-Parade", artists: [{ name: "Yui Horie" }] },
        animethemeentries: [
          {
            videos: [
              {
                link: "https://v.animethemes.moe/Toradora-OP1.webm",
                audio: { link: "https://a.animethemes.moe/Toradora-OP1.ogg" },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("AnimeThemesClient query shapes", () => {
  it("sends identifiable JSON request headers for AnimeThemes Cloudflare compatibility", async () => {
    const { client, requests } = makeClient([
      { match: "/search", response: { status: 200, body: JSON.stringify({ search: [] }) } },
    ]);

    await client.search("naruto");

    const headers = requestHeaders(requests[0]!.init?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("accept-language")).toBe("en-US,en;q=0.9");
    expect(headers.get("user-agent")).toContain("AnimeOngaku");
  });

  it("fetches Kitsu ids in batches of 50 with the expected filters", async () => {
    const { client, requests } = makeClient([
      { match: "/anime", response: { status: 200, body: apiPage() } },
    ]);

    await client.fetchByKitsuIds(Array.from({ length: 51 }, (_, index) => String(index + 1)));

    expect(requests).toHaveLength(2);
    const first = new URL(requests[0]!.url);
    expect(first.pathname).toBe("/anime");
    expect(first.searchParams.get("filter[has]")).toBe("resources");
    expect(first.searchParams.get("filter[site]")).toBe("Kitsu");
    expect(first.searchParams.get("filter[external_id]")).toBe(
      Array.from({ length: 50 }, (_, index) => String(index + 1)).join(","),
    );
    expect(first.searchParams.get("page[size]")).toBe("100");

    const second = new URL(requests[1]!.url);
    expect(second.searchParams.get("filter[external_id]")).toBe("51");
  });

  it("fetches MAL ids using the MyAnimeList site filter", async () => {
    const { client, requests } = makeClient([
      { match: "/anime", response: { status: 200, body: apiPage() } },
    ]);

    await client.fetchByMalIds(["5114", "9253"]);

    const requestUrl = new URL(requests[0]!.url);
    expect(requestUrl.searchParams.get("filter[site]")).toBe("MyAnimeList");
    expect(requestUrl.searchParams.get("filter[external_id]")).toBe("5114,9253");
  });

  it("searches titles with q= and the fallback page size", async () => {
    const { client, requests } = makeClient([
      { match: "/anime", response: { status: 200, body: apiPage() } },
    ]);

    await client.searchByTitle("Serial Experiments Lain");

    const requestUrl = new URL(requests[0]!.url);
    expect(requestUrl.pathname).toBe("/anime");
    expect(requestUrl.searchParams.get("q")).toBe("Serial Experiments Lain");
    expect(requestUrl.searchParams.get("page[size]")).toBe("5");
    expect(requestUrl.searchParams.get("include")).toContain("animesynonyms");
  });

  it("does not follow pagination for broad title fallback searches", async () => {
    const next = "https://api.animethemes.moe/anime?page%5Bnumber%5D=2";
    const { client, requests } = makeClient([
      { match: "q=A+Silent+Voice", response: { status: 200, body: apiPage([sampleAnime(1)], { next }) } },
      { match: "page%5Bnumber%5D=2", response: { status: 200, body: apiPage([sampleAnime(2)], { next: null }) } },
    ]);

    const result = await client.searchByTitle("A Silent Voice");

    expect(requests).toHaveLength(1);
    expect(result.themes.map((theme) => theme.animeId)).toEqual([1]);
  });

  it("parses the single anime response shape", async () => {
    const { client, requests } = makeClient([
      { match: "/anime/2984", response: { status: 200, body: JSON.stringify({ anime: sampleAnime() }) } },
    ]);

    const themes = await client.fetchAnimeById(2984);

    expect(new URL(requests[0]!.url).pathname).toBe("/anime/2984");
    expect(themes.map((theme) => theme.themeId)).toEqual([3040]);
  });
});

function requestHeaders(headers: HeadersInit | undefined): Headers {
  return new Headers(headers);
}

describe("AnimeThemesClient pagination", () => {
  it("follows links.next and combines all pages", async () => {
    const next = "https://api.animethemes.moe/anime?page%5Bnumber%5D=2";
    const { client, requests } = makeClient([
      { match: "filter%5Bexternal_id%5D=4224", response: { status: 200, body: apiPage([sampleAnime(1)], { next }) } },
      { match: "page%5Bnumber%5D=2", response: { status: 200, body: apiPage([sampleAnime(2)], { next: null }) } },
    ]);

    const result = await client.fetchByKitsuIds(["4224"]);

    expect(requests).toHaveLength(2);
    expect(requests[1]!.url).toBe(next);
    expect(result.themes.map((theme) => theme.animeId)).toEqual([1, 2]);
  });
});

