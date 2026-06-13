import { describe, expect, it } from "vitest";
import { toThemeEntries } from "../src/animethemes/parse.js";

function animeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 2984,
    name: "Toradora!",
    resources: [{ site: "Kitsu", external_id: "4224" }],
    images: [
      { facet: "Small Cover", path: "covers/small.jpg" },
      { facet: "Large Cover", path: "covers/large.jpg" },
    ],
    animesynonyms: [{ type: "English", text: "Tiger X Dragon" }],
    animethemes: [
      {
        id: 3040,
        type: "OP",
        sequence: 1,
        song: {
          title: "Pre-Parade",
          artists: [
            { name: "Eri Kitamura", artistsong: { alias: "Eri", as: "Ami Kawashima" } },
            { name: "Rie Kugimiya", artistsong: { alias: null, as: "Taiga Aisaka" } },
          ],
        },
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
      {
        id: 3041,
        type: "ED",
        sequence: 1,
        song: { title: "Vanilla Salt", artists: [{ name: "Yui Horie" }] },
        animethemeentries: [
          {
            videos: [{ link: "https://v.animethemes.moe/Toradora-ED1.webm", audio: { path: "Toradora-ED1.ogg" } }],
          },
        ],
      },
      {
        id: 3042,
        type: "ED",
        sequence: 2,
        song: null,
        animethemeentries: [
          {
            videos: [{ link: "https://v.animethemes.moe/Toradora-ED2.webm", audio: null }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("toThemeEntries", () => {
  it("ports AnimeRepositoryImpl theme flattening and URL resolution", () => {
    const entries = toThemeEntries(animeFixture());

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      animeId: 2984,
      animeName: "Toradora!",
      animeNameEn: "Tiger X Dragon",
      animeSynonyms: ["Tiger X Dragon"],
      kitsuId: "4224",
      coverUrl: "https://i.animethemes.moe/covers/large.jpg",
      themeId: 3040,
      title: "Pre-Parade",
      artistName: "Eri Kitamura, Rie Kugimiya",
      audioUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
      videoUrl: "https://v.animethemes.moe/Toradora-OP1.webm",
      themeType: "OP1",
      videoFallback: false,
    });
    expect(entries[0]!.artists).toEqual([
      { name: "Eri Kitamura", asCharacter: "Ami Kawashima", alias: "Eri" },
      { name: "Rie Kugimiya", asCharacter: "Taiga Aisaka", alias: null },
    ]);

    expect(entries[1]!.audioUrl).toBe("https://a.animethemes.moe/Toradora-ED1.ogg");
    expect(entries[1]!.videoFallback).toBe(false);
    expect(entries[2]).toMatchObject({
      title: "ED 2",
      audioUrl: "https://v.animethemes.moe/Toradora-ED2.webm",
      videoFallback: true,
    });
  });

  it("normalizes numeric external ids to strings", () => {
    const entries = toThemeEntries(
      animeFixture({ resources: [{ site: "Kitsu", external_id: 12345 }] }),
    );

    expect(entries[0]!.kitsuId).toBe("12345");
  });

  it("rejects non-numeric theme ids instead of hashing them", () => {
    const anime = animeFixture({
      animethemes: [
        {
          id: "not-a-number",
          type: "OP",
          sequence: 1,
          song: null,
          animethemeentries: [
            { videos: [{ link: "https://v.animethemes.moe/Test.webm", audio: null }] },
          ],
        },
      ],
    });

    expect(() => toThemeEntries(anime)).toThrow(/non-numeric/i);
  });
});
