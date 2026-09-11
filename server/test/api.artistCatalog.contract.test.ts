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

  it("hydrates artist themes when the artist response omits Kitsu resources and covers", async () => {
    const service = new UpstreamProxyService(
      {
        search: async () => ({}),
        fetchArtist: async () => ({
          artist: {
            id: 7,
            name: "Karuta",
            slug: "karuta",
            songs: [
              {
                id: 700,
                title: "Ichiban no Takaramono",
                artists: [{ name: "Karuta" }],
                animethemes: [{
                  id: 2222,
                  type: "ED",
                  sequence: 1,
                  anime: { id: 2984, name: "Signal Breaker", slug: "signal_breaker" },
                  animethemeentries: [{ videos: [{ link: "https://v.animethemes.moe/SignalBreaker-ED1.webm", audio: { link: "https://a.animethemes.moe/SignalBreaker-ED1.ogg" } }] }],
                }],
              },
            ],
          },
        }),
        fetchAnimeBySlug: async () => [{
          animeId: 2984,
          animeName: "Signal Breaker",
          animeNameEn: "Signal Breaker",
          animeSlug: "signal_breaker",
          animeSynonyms: [],
          kitsuId: "anime-1",
          coverUrl: "https://i.animethemes.moe/covers/signal-breaker.jpg",
          themeId: 2222,
          animeThemesSongId: 700,
          title: "Ichiban no Takaramono",
          artistName: "Karuta",
          audioUrl: "https://a.animethemes.moe/SignalBreaker-ED1.ogg",
          videoUrl: "https://v.animethemes.moe/SignalBreaker-ED1.webm",
          themeType: "ED1",
          artists: [{ name: "Karuta", asCharacter: null, alias: null }],
          songResources: [],
          videoCandidates: [],
          videoFallback: false,
        }],
      },
      { searchAnimeByText: async () => [] },
    );

    const response = await service.artist("karuta") as { themes: Array<Record<string, unknown>>; fullSongs: Array<Record<string, unknown>> };

    expect(response.themes[0]).toMatchObject({
      kitsuAnimeIds: ["anime-1"],
      anime: [{ kitsuId: "anime-1", title: "Signal Breaker", posterUrl: "https://i.animethemes.moe/covers/signal-breaker.jpg" }],
    });
    expect(response.fullSongs[0]).toMatchObject({
      anime: [{ kitsuId: "anime-1", title: "Signal Breaker", posterUrl: "https://i.animethemes.moe/covers/signal-breaker.jpg" }],
    });
  });

  it("keeps anime identity and cover artwork when AnimeThemes has no Kitsu resource", async () => {
    const service = new UpstreamProxyService(
      {
        search: async () => ({}),
        fetchArtist: async () => ({
          artist: {
            id: 8,
            name: "Rich Girl Caretaker Artist",
            slug: "rich-girl-caretaker-artist",
            songs: [{
              id: 14601,
              title: "Caretaker Theme",
              artists: [{ name: "Rich Girl Caretaker Artist" }],
              animethemes: [{
                id: 14601,
                type: "OP",
                sequence: 1,
                anime: { id: 4885, name: "Rich Girl Caretaker", slug: "rich_girl_caretaker", resources: [], images: [] },
                animethemeentries: [{ videos: [{ link: "https://v.animethemes.moe/RichGirlCaretaker-OP1.webm", audio: { link: "https://a.animethemes.moe/RichGirlCaretaker-OP1.ogg" } }] }],
              }],
            }],
          },
        }),
        fetchAnimeBySlug: async (slug) => {
          expect(slug).toBe("rich_girl_caretaker");
          return [{
            animeId: 4885,
            animeName: "Rich Girl Caretaker",
            animeNameEn: "The Rich Girl Caretaker",
            animeSlug: slug,
            animeSynonyms: [],
            kitsuId: null,
            coverUrl: "https://i.animethemes.moe/covers/rich-girl-caretaker.jpg",
            themeId: 14601,
            animeThemesSongId: 14601,
            title: "Caretaker Theme",
            artistName: "Rich Girl Caretaker Artist",
            audioUrl: "https://a.animethemes.moe/RichGirlCaretaker-OP1.ogg",
            videoUrl: "https://v.animethemes.moe/RichGirlCaretaker-OP1.webm",
            themeType: "OP1",
            artists: [{ name: "Rich Girl Caretaker Artist", asCharacter: null, alias: null }],
            songResources: [],
            videoCandidates: [],
            videoFallback: false,
          }];
        },
      },
      { searchAnimeByText: async () => [] },
    );

    const response = await service.artist("rich-girl-caretaker-artist") as { themes: Array<Record<string, unknown>>; fullSongs: Array<Record<string, unknown>> };

    expect(response.themes[0]).toMatchObject({
      kitsuAnimeIds: [],
      animeThemesAnimeId: 4885,
      anime: [{
        kitsuId: null,
        animeThemesAnimeId: 4885,
        title: "Rich Girl Caretaker",
        titleEn: "The Rich Girl Caretaker",
        posterUrl: "https://i.animethemes.moe/covers/rich-girl-caretaker.jpg",
      }],
    });
    expect(response.fullSongs[0]).toMatchObject({
      anime: [{
        kitsuId: null,
        animeThemesAnimeId: 4885,
        title: "Rich Girl Caretaker",
        posterUrl: "https://i.animethemes.moe/covers/rich-girl-caretaker.jpg",
      }],
    });
  });
});
