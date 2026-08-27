import { describe, expect, it } from "vitest";
import { UpstreamProxyService } from "../src/api/upstreamProxyService.js";

function artistFixture() {
  return {
    artist: {
      id: 7,
      name: "Karuta",
      slug: "karuta",
      images: [{ facet: "Large", link: "https://i.animethemes.moe/artists/karuta.jpg" }],
      songs: [
        {
          id: 700,
          title: "Ichiban no Takaramono",
          artists: [{ name: "Karuta" }],
          animethemes: [
            {
              id: 2222,
              type: "ED",
              sequence: 1,
              anime: {
                id: 2984,
                name: "Signal Breaker",
                resources: [{ site: "Kitsu", external_id: "anime-1" }],
                images: [{ facet: "Large Cover", path: "covers/signal-breaker.jpg" }],
                animethemes: [],
              },
              animethemeentries: [
                {
                  videos: [
                    {
                      link: "https://v.animethemes.moe/SignalBreaker-ED1.webm",
                      audio: { link: "https://a.animethemes.moe/SignalBreaker-ED1.ogg" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe("artist catalog server contract", () => {
  it("projects an artist into browser-ready themes, full songs, artwork, and anime cross-links", async () => {
    const service = new UpstreamProxyService(
      {
        search: async () => ({}),
        fetchArtist: async () => artistFixture(),
      },
      { searchAnimeByText: async () => [] },
    );

    const response = await service.artist("karuta");

    expect(response).toMatchObject({
      artist: {
        id: 7,
        name: "Karuta",
        slug: "karuta",
        artworkUrl: "https://i.animethemes.moe/artists/karuta.jpg",
      },
      themes: [
        {
          id: 2222,
          title: "Ichiban no Takaramono",
          themeType: "ED1",
          audioUrl: "/v1/media/audio/2222",
          anime: [
            {
              kitsuId: "anime-1",
              title: "Signal Breaker",
              posterUrl: "https://i.animethemes.moe/covers/signal-breaker.jpg",
            },
          ],
        },
      ],
      fullSongs: [
        {
          id: 700,
          title: "Ichiban no Takaramono",
          artistCredit: "Karuta",
          audioUrl: "/v1/media/songs/700/audio",
          audioAvailable: false,
          anime: [{ kitsuId: "anime-1", title: "Signal Breaker" }],
        },
      ],
    });
    expect((response as { themes: Array<Record<string, unknown>> }).themes[0]).not.toHaveProperty("audioState");
    // Android's AnimeThemesSingleArtistResponse still reads this raw field.
    expect((response as { artist: { songs: unknown[] } }).artist.songs).toEqual(artistFixture().artist.songs);
  });
});
