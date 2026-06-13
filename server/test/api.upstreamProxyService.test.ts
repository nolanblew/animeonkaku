import { describe, expect, it } from "vitest";
import type { AnimeThemeEntry } from "../src/animethemes/types.js";
import { UpstreamProxyService, type ProxyArtistImage } from "../src/api/upstreamProxyService.js";

function animeFixture() {
  return {
    id: 2984,
    name: "Naruto",
    resources: [{ site: "Kitsu", external_id: "11" }],
    images: [{ facet: "Large Cover", path: "covers/naruto.jpg" }],
    animethemes: [
      {
        id: 1478,
        type: "OP",
        sequence: 1,
        song: { title: "Rocks", artists: [{ name: "Hound Dog" }] },
        animethemeentries: [
          {
            videos: [
              {
                link: "https://v.animethemes.moe/Naruto-OP1.webm",
                audio: { link: "https://a.animethemes.moe/Naruto-OP1.ogg" },
              },
            ],
          },
        ],
      },
    ],
  };
}

class RecordingCatalog {
  themes: AnimeThemeEntry[] = [];
  artists: ProxyArtistImage[] = [];

  async saveOnlineAnimeCatalog(themes: AnimeThemeEntry[]) {
    this.themes.push(...themes);
  }

  async upsertArtistImages(artists: ProxyArtistImage[]) {
    this.artists.push(...artists);
  }
}

describe("UpstreamProxyService catalog seeding", () => {
  it("seeds playable themes and artist image origins from search results", async () => {
    const catalog = new RecordingCatalog();
    const service = new UpstreamProxyService(
      {
        search: async () => ({
          search: {
            anime: [animeFixture()],
            artists: [
              {
                id: 7,
                name: "Karuta",
                slug: "karuta",
                images: [{ facet: "Large", link: "https://i.animethemes.moe/artists/karuta.jpg" }],
              },
            ],
          },
        }),
        fetchArtist: async () => ({}),
      },
      { searchAnimeByText: async () => [] },
      catalog,
    );

    await service.search("naruto");

    expect(catalog.themes).toMatchObject([
      {
        animeId: 2984,
        kitsuId: "11",
        themeId: 1478,
        audioUrl: "https://a.animethemes.moe/Naruto-OP1.ogg",
      },
    ]);
    expect(catalog.artists).toEqual([
      {
        name: "Karuta",
        slug: "karuta",
        imageUrl: "https://i.animethemes.moe/artists/karuta.jpg",
      },
    ]);
  });

  it("seeds artist-detail themes from song-owned AnimeThemes entries", async () => {
    const catalog = new RecordingCatalog();
    const service = new UpstreamProxyService(
      {
        search: async () => ({}),
        fetchArtist: async () => ({
          artist: {
            id: 7,
            name: "Karuta",
            slug: "karuta",
            images: [{ facet: "Small", path: "artists/karuta-small.jpg" }],
            songs: [
              {
                title: "Ichiban no Takaramono",
                artists: [{ name: "Karuta" }],
                animethemes: [
                  {
                    id: 2222,
                    type: "ED",
                    sequence: 1,
                    anime: animeFixture(),
                    animethemeentries: [
                      {
                        videos: [
                          {
                            link: "https://v.animethemes.moe/AngelBeats-ED1.webm",
                            audio: { path: "AngelBeats-ED1.ogg" },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      },
      { searchAnimeByText: async () => [] },
      catalog,
    );

    await service.artist("karuta");

    expect(catalog.themes).toMatchObject([
      {
        themeId: 2222,
        title: "Ichiban no Takaramono",
        audioUrl: "https://a.animethemes.moe/AngelBeats-ED1.ogg",
      },
    ]);
    expect(catalog.artists).toEqual([
      {
        name: "Karuta",
        slug: "karuta",
        imageUrl: "https://i.animethemes.moe/artists/karuta-small.jpg",
      },
    ]);
  });
});
