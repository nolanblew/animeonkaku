import { describe, expect, it } from "vitest";
import { toThemeEntries } from "../src/animethemes/parse.js";

function animeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 2984,
    name: "Toradora!",
    slug: "toradora",
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
          id: 9001,
          title: "Pre-Parade",
          resources: [{ site: "MusicBrainz", external_id: "recording-1" }],
          artists: [
            { name: "Eri Kitamura", artistsong: { alias: "Eri", as: "Ami Kawashima" } },
            { name: "Rie Kugimiya", artistsong: { alias: null, as: "Taiga Aisaka" } },
          ],
        },
        animethemeentries: [
          {
            id: 7001,
            version: 1,
            videos: [
              {
                id: 8001,
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
            id: 7002,
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
            id: 7003,
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
      animeSlug: "toradora",
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
      animeThemesSongId: 9001,
    });
    expect(entries[0]!.artists).toEqual([
      { name: "Eri Kitamura", asCharacter: "Ami Kawashima", alias: "Eri" },
      { name: "Rie Kugimiya", asCharacter: "Taiga Aisaka", alias: null },
    ]);
    expect(entries[0]!.songResources).toEqual([
      { site: "MusicBrainz", externalId: "recording-1" },
    ]);

    expect(entries[1]!.audioUrl).toBe("https://a.animethemes.moe/Toradora-ED1.ogg");
    expect(entries[1]!.videoFallback).toBe(false);
    expect(entries[2]).toMatchObject({
      title: "ED 2",
      audioUrl: "https://v.animethemes.moe/Toradora-ED2.webm",
      videoFallback: true,
    });
  });

  it("treats a missing slug as null rather than inventing one", () => {
    const entries = toThemeEntries(animeFixture({ slug: undefined }));

    expect(entries[0]!.animeSlug).toBeNull();
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

  it("retains and deterministically ranks every entry video candidate", () => {
    const [entry] = toThemeEntries(animeFixture({
      animethemes: [{
        id: 3040,
        type: "OP",
        sequence: 1,
        song: { id: 9001, title: "Pre-Parade", artists: [{ name: "Yui Horie" }] },
        animethemeentries: [
          {
            id: 702,
            version: 2,
            spoiler: false,
            nsfw: false,
            videos: [{
              id: 803,
              link: "https://v.animethemes.moe/version-2-1080.webm",
              resolution: 1080,
              source: "BD",
              mimetype: "video/webm",
              nc: true,
              subbed: false,
              lyrics: false,
              audio: { link: "https://a.animethemes.moe/first-usable.ogg" },
            }],
          },
          {
            id: 701,
            version: 1,
            spoiler: false,
            nsfw: false,
            videos: [
              {
                id: 802,
                link: "https://v.animethemes.moe/version-1-720.webm",
                resolution: "720",
                source: "WEB",
                audio: { link: "https://a.animethemes.moe/second.ogg" },
              },
              {
                id: 801,
                link: "https://v.animethemes.moe/version-1-1080.webm",
                resolution: 1080,
                source: "BD",
                audio: { link: "https://a.animethemes.moe/third.ogg" },
              },
            ],
          },
          {
            id: 700,
            version: 1,
            spoiler: true,
            videos: [{
              id: 800,
              link: "https://v.animethemes.moe/spoiler.webm",
              resolution: 2160,
              source: "BD",
              audio: { link: "https://a.animethemes.moe/spoiler.ogg" },
            }],
          },
        ],
      }],
    }));

    expect(entry!.audioUrl).toBe("https://a.animethemes.moe/first-usable.ogg");
    expect(entry!.videoUrl).toBe("https://v.animethemes.moe/version-1-1080.webm");
    expect(entry!.videoCandidates).toHaveLength(4);
    expect(entry!.videoCandidates.map((candidate) => ({
      id: candidate.animeThemesVideoId,
      entryId: candidate.animeThemesEntryId,
      rank: candidate.preferenceRank,
      spoiler: candidate.spoiler,
    }))).toEqual([
      { id: 801, entryId: 701, rank: 0, spoiler: false },
      { id: 802, entryId: 701, rank: 1, spoiler: false },
      { id: 803, entryId: 702, rank: 2, spoiler: false },
      { id: 800, entryId: 700, rank: 3, spoiler: true },
    ]);
    expect(entry!.videoCandidates.find((candidate) => candidate.animeThemesVideoId === 803)).toMatchObject({
      animeThemesSongId: 9001,
      mimeType: "video/webm",
      resolution: 1080,
      source: "BD",
      creditless: true,
      subbed: false,
      lyrics: false,
    });
  });

  it("does not manufacture a video descriptor when only separate audio exists", () => {
    const [entry] = toThemeEntries(animeFixture({
      animethemes: [{
        id: 3040,
        type: "OP",
        sequence: 1,
        song: { id: 9001, title: "Audio only", artists: [] },
        animethemeentries: [{
          id: 7001,
          videos: [{ id: 8001, audio: { link: "https://a.animethemes.moe/audio-only.ogg" } }],
        }],
      }],
    }));

    expect(entry!.audioUrl).toBe("https://a.animethemes.moe/audio-only.ogg");
    expect(entry!.videoUrl).toBeNull();
    expect(entry!.videoCandidates).toEqual([]);
  });

  it("selects the same best candidate when unordered entries arrive in a different array order", () => {
    const lowResolution = {
      id: 701,
      version: 1,
      videos: [{
        id: 801,
        link: "https://v.animethemes.moe/720.webm",
        resolution: 720,
        source: "BD",
        audio: { link: "https://a.animethemes.moe/720.ogg" },
      }],
    };
    const highResolution = {
      id: 702,
      version: 1,
      videos: [{
        id: 802,
        link: "https://v.animethemes.moe/1080.webm",
        resolution: 1080,
        source: "BD",
        audio: { link: "https://a.animethemes.moe/1080.ogg" },
      }],
    };
    const parseWithEntries = (animethemeentries: unknown[]) => toThemeEntries(animeFixture({
      animethemes: [{
        id: 3040,
        type: "OP",
        sequence: 1,
        song: { id: 9001, title: "Pre-Parade", artists: [] },
        animethemeentries,
      }],
    }))[0]!;

    const first = parseWithEntries([lowResolution, highResolution]);
    const reordered = parseWithEntries([highResolution, lowResolution]);

    expect(first.videoUrl).toBe("https://v.animethemes.moe/1080.webm");
    expect(reordered.videoUrl).toBe(first.videoUrl);
    expect(first.videoCandidates.map((candidate) => candidate.entryOrder)).toEqual([null, null]);
    expect(reordered.videoCandidates.map((candidate) => candidate.animeThemesVideoId)).toEqual([802, 801]);
  });

  it("returns the preferred descriptor with warning flags when every candidate is warned", () => {
    const [entry] = toThemeEntries(animeFixture({
      animethemes: [{
        id: 3040,
        type: "OP",
        sequence: 1,
        song: { id: 9001, title: "Warned", artists: [] },
        animethemeentries: [
          {
            id: 701,
            version: 1,
            spoiler: true,
            videos: [{
              id: 801,
              link: "https://v.animethemes.moe/spoiler.webm",
              resolution: 1080,
              source: "BD",
              audio: { link: "https://a.animethemes.moe/spoiler.ogg" },
            }],
          },
          {
            id: 702,
            version: 1,
            nsfw: true,
            videos: [{
              id: 802,
              link: "https://v.animethemes.moe/nsfw.webm",
              resolution: 720,
              source: "BD",
              audio: { link: "https://a.animethemes.moe/nsfw.ogg" },
            }],
          },
        ],
      }],
    }));

    expect(entry!.videoUrl).toBe("https://v.animethemes.moe/spoiler.webm");
    expect(entry!.videoCandidates[0]).toMatchObject({ spoiler: true, nsfw: false });
    expect(entry!.videoCandidates.every((candidate) => candidate.spoiler || candidate.nsfw)).toBe(true);
  });
});
