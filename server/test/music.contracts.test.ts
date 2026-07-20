import { describe, expect, it } from "vitest";
import {
  DisabledMusicAcquisitionProvider,
  MusicProviderDisabledError,
  type MusicAcquisitionProvider,
  type MusicCatalogResolver,
  type MusicCatalogResolution,
  type NormalizedProviderFile,
  type NormalizedProviderRelease,
  type MusicProviderResourceContext,
} from "../src/music/index.js";

const ownership: MusicProviderResourceContext = {
  provider: "fixture",
  providerReleaseId: "release-1",
  providerResourceCreated: false,
  priorProviderMonitoringState: "monitored",
  providerMetadata: { providerAlbumId: "album-1" },
};

const release: NormalizedProviderRelease = {
  provider: "fixture",
  providerReleaseId: "release-1",
  title: "Fixture OST",
  normalizedTitle: "fixture ost",
  artistCredit: "Fixture Artist",
  normalizedArtist: "fixture artist",
  tracks: [],
};

const file: NormalizedProviderFile = {
  provider: "fixture",
  providerFileId: "file-1",
  providerReleaseId: "release-1",
  providerTrackId: "track-1",
  sourcePath: "/provider/music/fixture.flac",
  readablePath: "C:/shared/music/fixture.flac",
  title: "Fixture Song",
  normalizedTitle: "fixture song",
  artistCredit: "Fixture Artist",
  normalizedArtist: "fixture artist",
  durationSeconds: 245,
  musicbrainzRecordingId: "recording-1",
  sizeBytes: 42,
};

class FakeMusicAcquisitionProvider implements MusicAcquisitionProvider {
  readonly provider = "fixture";

  async healthCheck() {
    return { available: true };
  }

  async lookupReleases() {
    return [release];
  }

  async ensureRelease() {
    return { resource: ownership };
  }

  async startAcquisition() {
    return { providerJobId: "job-1" };
  }

  async getAcquisitionStatus() {
    return { state: "COMPLETE" as const };
  }

  async listImportedFiles() {
    return [file];
  }

  async cleanup() {
    return { cleaned: true };
  }
}

const fakeResolver: MusicCatalogResolver = {
  buildQueries: () => [{ text: "Fixture Song Fixture Artist", kind: "FULL_SIZE" }],
  resolve: () => ({
    outcome: "ACCEPTED",
    confidence: 100,
    evidence: { signals: [{ kind: "MUSICBRAINZ_RECORDING_EXACT", points: 60 }], reasons: [] },
    reasons: [],
    release,
    releaseClassification: {
      releaseType: "SOUNDTRACK",
      relationship: "SEASON_SPECIFIC",
      evidence: { signals: [{ kind: "RELEASE_ANIME_ALIAS", points: 10 }], reasons: [] },
    },
  }),
};

const ambiguousResolution: MusicCatalogResolution = {
  outcome: "AMBIGUOUS",
  confidence: 82,
  evidence: {
    signals: [{ kind: "RELEASE_ANIME_ALIAS", points: 10 }],
    reasons: ["INSUFFICIENT_MARGIN", "RELEASE_RELATIONSHIP_AMBIGUOUS"],
  },
  reasons: ["INSUFFICIENT_MARGIN", "RELEASE_RELATIONSHIP_AMBIGUOUS"],
  release,
  releaseClassification: {
    releaseType: "CHARACTER",
    relationship: "AMBIGUOUS",
    evidence: {
      signals: [{ kind: "RELEASE_ANIME_ALIAS", points: 10 }],
      reasons: ["RELEASE_RELATIONSHIP_AMBIGUOUS"],
    },
  },
};

describe("music acquisition contracts", () => {
  it("allows a fake provider to drive the provider-neutral workflow contract", async () => {
    const provider = new FakeMusicAcquisitionProvider();
    const candidates = await provider.lookupReleases({ query: "Fixture OST" });
    const ensured = await provider.ensureRelease({ release: candidates[0]! });
    const started = await provider.startAcquisition({ providerReleaseId: ensured.resource.providerReleaseId });
    const status = await provider.getAcquisitionStatus({ providerJobId: started.providerJobId });
    const files = await provider.listImportedFiles({ providerReleaseId: ensured.resource.providerReleaseId });
    const cleanup = await provider.cleanup({
      resource: ensured.resource,
      restorePriorMonitoringState: true,
    });

    expect({ candidates, ensured, status, files, cleanup, resolution: fakeResolver.resolve({
      target: { kind: "FULL_SIZE", animeThemesAnimeId: 1, animeTitles: ["Fixture Anime"] },
      candidates,
    }) }).toMatchObject({
      candidates: [release],
      ensured: { resource: ownership },
      status: { state: "COMPLETE" },
      files: [{ ...file, sourcePath: "/provider/music/fixture.flac", readablePath: "C:/shared/music/fixture.flac" }],
      cleanup: { cleaned: true },
      resolution: {
        outcome: "ACCEPTED",
        confidence: 100,
        releaseClassification: { releaseType: "SOUNDTRACK", relationship: "SEASON_SPECIFIC" },
      },
    });
  });

  it("carries release classification and explicit ambiguity reasons for later season matching", () => {
    expect(ambiguousResolution).toMatchObject({
      outcome: "AMBIGUOUS",
      reasons: ["INSUFFICIENT_MARGIN", "RELEASE_RELATIONSHIP_AMBIGUOUS"],
      evidence: { reasons: ["INSUFFICIENT_MARGIN", "RELEASE_RELATIONSHIP_AMBIGUOUS"] },
      releaseClassification: {
        releaseType: "CHARACTER",
        relationship: "AMBIGUOUS",
        evidence: { reasons: ["RELEASE_RELATIONSHIP_AMBIGUOUS"] },
      },
    });
  });

  it("keeps discovery inert when the provider is disabled", async () => {
    const provider = new DisabledMusicAcquisitionProvider();

    await expect(provider.healthCheck()).resolves.toMatchObject({ available: false });
    await expect(provider.lookupReleases({ query: "Fixture OST" })).resolves.toEqual([]);
    await expect(provider.ensureRelease({ release })).rejects.toBeInstanceOf(MusicProviderDisabledError);
    await expect(provider.startAcquisition({ providerReleaseId: "release-1" }))
      .rejects.toBeInstanceOf(MusicProviderDisabledError);
    await expect(provider.getAcquisitionStatus({ providerJobId: "job-1" }))
      .rejects.toBeInstanceOf(MusicProviderDisabledError);
    await expect(provider.listImportedFiles({ providerReleaseId: "release-1" }))
      .rejects.toBeInstanceOf(MusicProviderDisabledError);
    await expect(provider.cleanup({ resource: ownership, restorePriorMonitoringState: true }))
      .rejects.toBeInstanceOf(MusicProviderDisabledError);
  });
});
