import { describe, expect, it } from "vitest";
import {
  ConservativeMusicCatalogResolver,
  buildMusicCatalogQueries,
  mergeMusicCandidates,
  musicTokens,
  normalizeMusicText,
  tokenSimilarity,
  type MusicCatalogTarget,
  type NormalizedProviderRelease,
  type NormalizedProviderTrack,
} from "../src/music/index.js";

const resolver = new ConservativeMusicCatalogResolver();

const fullTarget: MusicCatalogTarget = {
  kind: "FULL_SIZE",
  animeThemesAnimeId: 101,
  animeTitles: ["Bocchi the Rock!", "Bocchi za Rokku!", "ぼっち・ざ・ろっく！"],
  animeThemesSongId: 501,
  resourceIds: ["resource-1", "ＲＥＳＯＵＲＣＥ－１"],
  musicbrainzRecordingId: "recording-1",
  expectedMusicbrainzReleaseIds: ["release-mbid-1"],
  title: "Seishun Complex",
  artist: "Kessoku Band",
  durationSeconds: 90,
};

function track(overrides: Partial<NormalizedProviderTrack> = {}): NormalizedProviderTrack {
  return {
    provider: "fixture",
    providerTrackId: "track-1",
    providerReleaseId: "release-1",
    musicbrainzRecordingId: "recording-1",
    title: "Seishun Complex",
    normalizedTitle: "seishun complex",
    artistCredit: "Kessoku Band",
    normalizedArtist: "kessoku band",
    discNumber: 1,
    trackNumber: 1,
    durationSeconds: 236,
    ...overrides,
  };
}

function release(overrides: Partial<NormalizedProviderRelease> = {}): NormalizedProviderRelease {
  return {
    provider: "fixture",
    providerReleaseId: "release-1",
    musicbrainzReleaseId: "release-mbid-1",
    musicbrainzReleaseGroupId: "group-mbid-1",
    title: "Bocchi the Rock! Theme Single",
    normalizedTitle: "bocchi the rock theme single",
    artistCredit: "Kessoku Band",
    normalizedArtist: "kessoku band",
    releaseDate: "2022-10-12",
    tracks: [track()],
    ...overrides,
  };
}

describe("music matching normalization and queries", () => {
  it("normalizes width, case, accents, punctuation, and whitespace deterministically", () => {
    expect(normalizeMusicText("  ＳÉＩＳＨＵＮ・Complex!!  ")).toBe("seishun complex");
    expect(normalizeMusicText("オフボーカル")).toBe(normalizeMusicText("オフホ\u3099ーカル"));
    expect(musicTokens("Band, Kessoku BAND")).toEqual(["band", "kessoku"]);
    expect(tokenSimilarity("Kessoku Band", "Band Kessoku")).toBe(1);
  });

  it("builds and deduplicates multilingual song, artist, anime, and resource queries", () => {
    const queries = buildMusicCatalogQueries(fullTarget).map(({ text }) => text);
    expect(queries).toEqual([
      "Seishun Complex Kessoku Band",
      "Seishun Complex",
      "Bocchi the Rock! Seishun Complex",
      "Bocchi za Rokku! Seishun Complex",
      "ぼっち・ざ・ろっく！ Seishun Complex",
      "AnimeThemes song 501",
      "AnimeThemes resource resource-1",
      "MusicBrainz recording recording-1",
    ]);
  });

  it("keeps a no-duration non-MusicBrainz candidate ambiguous rather than falsely rejecting it", () => {
    const { musicbrainzRecordingId: _recording, durationSeconds: _duration, ...target } = fullTarget;
    const candidate = track({ musicbrainzRecordingId: undefined, durationSeconds: undefined });
    expect(resolver.resolve({ target, candidates: [release({ tracks: [candidate] })] })).toMatchObject({
      outcome: "AMBIGUOUS",
      reasons: ["BELOW_CONFIDENCE_THRESHOLD"],
    });
  });

  it("builds multilingual related-release terminology for every title alias", () => {
    const queries = buildMusicCatalogQueries({ kind: "RELATED_RELEASE", animeThemesAnimeId: 1, animeTitles: ["Toradora!", "とらドラ！"] });
    expect(queries.map((query) => query.text)).toEqual(expect.arrayContaining([
      "Toradora! original soundtrack",
      "Toradora! character song",
      "とらドラ！ オリジナルサウンドトラック",
      "とらドラ！ キャラクターソング",
    ]));
    expect(new Set(queries.map((query) => normalizeMusicText(query.text))).size).toBe(queries.length);
  });
});

describe("candidate merging", () => {
  it("merges repeated query hits by exact release identity and recording identity", () => {
    const sparse = release({ tracks: [track({ durationSeconds: undefined, trackNumber: undefined })] });
    const merged = mergeMusicCandidates([sparse, release()]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.tracks).toEqual([track()]);
    expect(mergeMusicCandidates([release(), sparse])).toEqual(merged);
  });

  it("does not collapse distinct release editions that share a release group", () => {
    const editions = mergeMusicCandidates([
      release({ providerReleaseId: "edition-a", musicbrainzReleaseId: undefined }),
      release({ providerReleaseId: "edition-b", musicbrainzReleaseId: undefined }),
    ]);
    expect(editions.map((candidate) => candidate.providerReleaseId)).toEqual(["edition-a", "edition-b"]);
  });

  it("coalesces a same-provider release returned once with and once without release MBID", () => {
    const withoutReleaseMbid = release({ musicbrainzReleaseId: undefined, tracks: [track({ musicbrainzRecordingId: undefined })] });
    const withReleaseMbid = release();
    const forward = mergeMusicCandidates([withoutReleaseMbid, withReleaseMbid]);
    const reverse = mergeMusicCandidates([withReleaseMbid, withoutReleaseMbid]);
    expect(reverse).toEqual(forward);
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({
      provider: "fixture",
      providerReleaseId: "release-1",
      musicbrainzReleaseId: "release-mbid-1",
      tracks: [{ musicbrainzRecordingId: "recording-1" }],
    });
  });

  it("does not coalesce cross-provider releases with the same release MBID", () => {
    const providerA = release({ provider: "A", providerReleaseId: "a" });
    const providerB = release({ provider: "B", providerReleaseId: "b" });
    const forward = mergeMusicCandidates([providerA, providerB]);
    expect(mergeMusicCandidates([providerB, providerA])).toEqual(forward);
    expect(forward.map((candidate) => candidate.provider)).toEqual(["A", "B"]);
  });

  it("never merges tracks across providers even when MusicBrainz identities match", () => {
    const providerA = release({ provider: "A", providerReleaseId: "a", tracks: [track({ provider: "A", providerReleaseId: "a", title: "A title" })] });
    const providerB = release({ provider: "B", providerReleaseId: "b", tracks: [track({ provider: "B", providerReleaseId: "b", title: "B title" })] });
    const forward = mergeMusicCandidates([providerA, providerB]);
    const reverse = mergeMusicCandidates([providerB, providerA]);
    expect(reverse).toEqual(forward);
    expect(forward).toHaveLength(2);
    expect(forward.map((candidate) => [candidate.provider, candidate.tracks[0]?.provider])).toEqual([["A", "A"], ["B", "B"]]);
  });

  it("propagates duplicate metadata conflicts independent of provider result order", () => {
    const correct = track();
    const contradictory = track({ artistCredit: "Wrong Performer", normalizedArtist: "wrong performer", durationSeconds: 91 });
    const forward = mergeMusicCandidates([release({ tracks: [correct, contradictory] })]);
    const reverse = mergeMusicCandidates([release({ tracks: [contradictory, correct] })]);
    expect(reverse).toEqual(forward);
    expect(forward[0]?.tracks).toHaveLength(1);
    expect(forward[0]?.tracks[0]?.metadataConflicts).toEqual(["ARTIST", "DURATION"]);
    for (const candidates of [forward, reverse]) {
      expect(resolver.resolve({ target: fullTarget, candidates })).toMatchObject({
        outcome: "REJECTED",
        reasons: ["TRACK_NOT_IDENTIFIABLE"],
      });
    }
  });

  it("coalesces a same-provider resource returned once with and once without recording identity", () => {
    const withoutRecording = track({ musicbrainzRecordingId: undefined });
    const withRecording = track();
    const forward = mergeMusicCandidates([release({ tracks: [withoutRecording, withRecording] })]);
    const reverse = mergeMusicCandidates([release({ tracks: [withRecording, withoutRecording] })]);
    expect(reverse).toEqual(forward);
    expect(forward[0]?.tracks).toEqual([track()]);
    expect(resolver.resolve({ target: fullTarget, candidates: forward })).toMatchObject({ outcome: "ACCEPTED" });
  });

  it("rejects conflicting recording identities attached to one provider resource", () => {
    const candidates = mergeMusicCandidates([release({ tracks: [track(), track({ musicbrainzRecordingId: "recording-other" })] })]);
    expect(candidates[0]?.tracks[0]?.metadataConflicts).toContain("RECORDING_ID");
    expect(resolver.resolve({ target: fullTarget, candidates })).toMatchObject({
      outcome: "REJECTED",
      reasons: expect.arrayContaining(["CONFLICTING_RECORDING_ID"]),
    });
  });
});

describe("conservative Full Size resolution", () => {
  it("accepts an exact original recording and emits a pure catalog intent with golden evidence", () => {
    const result = resolver.resolve({ target: fullTarget, candidates: [release()] });
    expect(result).toEqual({
      outcome: "ACCEPTED",
      confidence: 145,
      evidence: {
        signals: [
          { kind: "MUSICBRAINZ_RECORDING_EXACT", points: 60, detail: "recording-1" },
          { kind: "TITLE_MATCH", points: 30, detail: "seishun complex" },
          { kind: "ARTIST_MATCH", points: 25, detail: "kessoku band" },
          { kind: "DURATION_MATCH", points: 15, detail: "236s" },
          { kind: "RELEASE_ANIME_ALIAS", points: 10, detail: "bocchi the rock" },
          { kind: "RELEASE_TYPE", points: 5, detail: "expected MusicBrainz release identity" },
        ],
        reasons: [],
      },
      reasons: [],
      release: release(),
      track: track(),
      intent: { kind: "FULL_SIZE", animeThemesAnimeId: 101, animeThemesSongId: 501, release: release(), song: track() },
    });
  });

  it.each([
    "instrumental", "Karaoke", "off vocal", "off-vocal ver", "Live Ver", "Remix", "Cover", "TV Size", "TV Ver", "TV Version",
    "Anime Size", "short ver", "Short Version", "radio edit", "Opening Edit", "character ver",
    "インスト", "カラオケ", "オフボーカル", "ライブ", "リミックス", "カバー", "テレビサイズ",
  ])("rejects excluded version marker %s", (marker) => {
    const result = resolver.resolve({ target: fullTarget, candidates: [release({ tracks: [track({ title: `Seishun Complex ${marker}` })] })] });
    expect(result.outcome).toBe("REJECTED");
    expect(result.reasons).toContain("FULL_SIZE_EXCLUSION");
    expect(result.evidence.signals).toContainEqual(expect.objectContaining({ kind: "EXCLUSION" }));
  });

  it("rejects a conflicting recording identity even when text and artist agree", () => {
    const result = resolver.resolve({ target: fullTarget, candidates: [release({ tracks: [track({ musicbrainzRecordingId: "recording-other" })] })] });
    expect(result).toMatchObject({ outcome: "REJECTED", reasons: ["CONFLICTING_RECORDING_ID"] });
  });

  it("rejects conflicting performer or implausibly short duration despite an exact recording ID", () => {
    for (const candidate of [track({ artistCredit: "Cover Singer" }), track({ durationSeconds: 91 })]) {
      const result = resolver.resolve({ target: fullTarget, candidates: [release({ tracks: [candidate] })] });
      expect(result).toMatchObject({ outcome: "REJECTED", reasons: ["TRACK_NOT_IDENTIFIABLE"] });
    }
  });

  it("does not award duration evidence when the TV duration is unknown", () => {
    const result = resolver.resolve({ target: { ...fullTarget, durationSeconds: undefined }, candidates: [release()] });
    expect(result.outcome).toBe("ACCEPTED");
    expect(result.confidence).toBe(130);
    expect(result.evidence.signals.some((signal) => signal.kind === "DURATION_MATCH")).toBe(false);
  });

  it("never accepts a release without one identifiable target track", () => {
    expect(resolver.resolve({ target: fullTarget, candidates: [release({ tracks: [] })] })).toMatchObject({
      outcome: "REJECTED", reasons: ["TRACK_NOT_IDENTIFIABLE"],
    });
  });

  it("rejects a contradictory title despite an exact recording ID", () => {
    expect(resolver.resolve({ target: fullTarget, candidates: [release({ tracks: [track({ title: "Completely Different Song" })] })] })).toMatchObject({
      outcome: "REJECTED", reasons: ["TRACK_NOT_IDENTIFIABLE"],
    });
  });

  it("keeps below-threshold and close-runner candidates ambiguous", () => {
    const withoutMbid = { ...fullTarget, musicbrainzRecordingId: undefined };
    const low = release({ title: "Unrelated Single", releaseDate: undefined, tracks: [track({ musicbrainzRecordingId: undefined })] });
    expect(resolver.resolve({ target: withoutMbid, candidates: [low] })).toMatchObject({
      outcome: "AMBIGUOUS", confidence: 75, reasons: ["BELOW_CONFIDENCE_THRESHOLD"],
    });

    const first = release({ tracks: [track({ musicbrainzRecordingId: undefined })] });
    const close = release({ providerReleaseId: "release-2", musicbrainzReleaseId: "release-mbid-2", tracks: [track({ providerReleaseId: "release-2", providerTrackId: "track-2", musicbrainzRecordingId: undefined })] });
    expect(resolver.resolve({ target: withoutMbid, candidates: [first, close] })).toMatchObject({
      outcome: "AMBIGUOUS", confidence: 85, reasons: ["INSUFFICIENT_MARGIN"],
    });
  });

  it("accepts exactly at threshold and accepts an exact ten-point margin", () => {
    const target = { ...fullTarget, musicbrainzRecordingId: undefined };
    const atThreshold = release({ tracks: [track({ musicbrainzRecordingId: undefined })] });
    expect(resolver.resolve({ target, candidates: [atThreshold] })).toMatchObject({ outcome: "ACCEPTED", confidence: 85 });

    const runner = release({
      provider: "B",
      providerReleaseId: "runner",
      musicbrainzReleaseId: "release-mbid-1",
      title: "Unrelated Single",
      tracks: [track({ provider: "B", providerReleaseId: "runner", providerTrackId: "runner", musicbrainzRecordingId: undefined })],
    });
    expect(resolver.resolve({ target, candidates: [runner, atThreshold] })).toMatchObject({
      outcome: "ACCEPTED", confidence: 85, release: { providerReleaseId: "release-1" },
    });
  });

  it("does not treat the same MusicBrainz recording on two release editions as a competing runner-up", () => {
    const otherEdition = release({
      providerReleaseId: "release-2",
      musicbrainzReleaseId: "release-mbid-2",
      title: "Unrelated Compilation",
      tracks: [track({ providerReleaseId: "release-2", providerTrackId: "track-2" })],
    });
    const result = resolver.resolve({ target: fullTarget, candidates: [otherEdition, release()] });
    expect(result).toMatchObject({ outcome: "ACCEPTED", release: { providerReleaseId: "release-1" } });
  });
});

describe("conservative Related Release resolution", () => {
  const target: MusicCatalogTarget = {
    kind: "RELATED_RELEASE",
    animeThemesAnimeId: 202,
    animeTitles: ["Toradora!", "Tora Dora!", "とらドラ！"],
  };

  it.each([
    ["Toradora! Original Soundtrack", "SOUNDTRACK"],
    ["Tora Dora! Character Song Collection", "CHARACTER"],
    ["とらドラ！ キャラクターソングアルバム", "CHARACTER"],
    ["Toradora! Image Album", "IMAGE"],
    ["Toradora! Insert Songs", "INSERT"],
  ] as const)("accepts season-tied classified release %s", (title, releaseType) => {
    const candidate = release({ title, normalizedTitle: normalizeMusicText(title) });
    const result = resolver.resolve({ target, candidates: [candidate] });
    expect(result).toMatchObject({
      outcome: "ACCEPTED",
      confidence: 85,
      releaseClassification: { releaseType, relationship: "SEASON_SPECIFIC" },
      intent: { kind: "RELATED_RELEASE", animeThemesAnimeId: 202, releaseType },
    });
  });

  it("rejects artist-only association and unclassified anime-titled releases", () => {
    const artistOnly = release({ title: "Kessoku Band Album", artistCredit: "Toradora! Cast" });
    expect(resolver.resolve({ target, candidates: [artistOnly] })).toMatchObject({ outcome: "REJECTED", reasons: expect.arrayContaining(["RELEASE_NOT_SEASON_SPECIFIC"]) });
    const unclassified = release({ title: "Toradora! Memorial Collection" });
    expect(resolver.resolve({ target, candidates: [unclassified] })).toMatchObject({ outcome: "AMBIGUOUS", reasons: ["RELEASE_RELATIONSHIP_AMBIGUOUS"] });
  });

  it("does not let a generic short alias establish season ownership", () => {
    const genericTarget = { ...target, animeTitles: ["86"] };
    expect(resolver.resolve({ target: genericTarget, candidates: [release({ title: "86 Original Soundtrack" })] })).toMatchObject({
      outcome: "REJECTED", reasons: ["RELEASE_NOT_SEASON_SPECIFIC"],
    });
  });

  it("keeps two equally strong season releases ambiguous", () => {
    const candidates = [
      release({ providerReleaseId: "a", musicbrainzReleaseId: "a", title: "Toradora! Original Soundtrack" }),
      release({ providerReleaseId: "b", musicbrainzReleaseId: "b", title: "Toradora! Character Songs" }),
    ];
    expect(resolver.resolve({ target, candidates })).toMatchObject({ outcome: "AMBIGUOUS", confidence: 85, reasons: ["INSUFFICIENT_MARGIN"] });
    expect(resolver.resolve({ target, candidates: [...candidates].reverse() })).toMatchObject({
      outcome: "AMBIGUOUS", confidence: 85, reasons: ["INSUFFICIENT_MARGIN"], release: { providerReleaseId: "a" },
    });
  });

  it.each(["Toradora! Theme Songs", "Toradora! TV Size Collection"])("does not classify core theme variants as Related Music: %s", (title) => {
    expect(resolver.resolve({ target, candidates: [release({ title })] })).toMatchObject({
      outcome: "AMBIGUOUS", reasons: ["RELEASE_RELATIONSHIP_AMBIGUOUS"],
    });
  });

  it.each([
    ["My Anime Season 1", "My Anime Season 2 Original Soundtrack"],
    ["My Anime Part 1", "My Anime Part 2 Original Soundtrack"],
    ["My Anime First Cour", "My Anime Second Cour Original Soundtrack"],
  ])("requires exact season metadata %s rather than a shared franchise alias", (seasonTitle, candidateTitle) => {
    const seasonTarget: MusicCatalogTarget = {
      kind: "RELATED_RELEASE",
      animeThemesAnimeId: 303,
      animeTitles: ["My Anime", seasonTitle],
      seasonSpecificTitles: [seasonTitle],
    };
    const result = resolver.resolve({ target: seasonTarget, candidates: [release({ title: candidateTitle })] });
    expect(result).toMatchObject({ outcome: "AMBIGUOUS", reasons: ["RELEASE_NOT_SEASON_SPECIFIC"] });
    expect(result.evidence.signals).toContainEqual(expect.objectContaining({
      kind: "RELEASE_ANIME_ALIAS_MISSING",
      detail: "franchise alias only: my anime",
    }));
  });

  it("accepts a release tied to the exact season-specific alias", () => {
    const seasonTarget: MusicCatalogTarget = {
      kind: "RELATED_RELEASE",
      animeThemesAnimeId: 303,
      animeTitles: ["My Anime", "My Anime Season 2"],
      seasonSpecificTitles: ["My Anime Season 2"],
    };
    expect(resolver.resolve({ target: seasonTarget, candidates: [release({ title: "My Anime Season 2 Original Soundtrack" })] })).toMatchObject({
      outcome: "ACCEPTED", confidence: 85,
    });
  });
});
