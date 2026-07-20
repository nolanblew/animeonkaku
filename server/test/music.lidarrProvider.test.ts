import { describe, expect, it } from "vitest";
import { UpstreamHttp } from "../src/http/upstream.js";
import {
  LidarrMusicAcquisitionProvider,
  LidarrProviderError,
  mapLidarrPath,
} from "../src/music/providers/lidarr/index.js";
import type { MusicProviderResourceContext, NormalizedProviderRelease } from "../src/music/types.js";
import { fakeFetch, routedFetch, type FakeResponse } from "./helpers/fakeFetch.js";

const albumFixture = {
  id: 12,
  foreignAlbumId: "release-group-mbid",
  title: "Toradora! Original Soundtrack",
  disambiguation: "TV animation soundtrack",
  overview: "Official soundtrack",
  artistId: 21,
  monitored: true,
  anyReleaseOk: true,
  profileId: 1,
  duration: 3600000,
  albumType: "Album",
  secondaryTypes: ["Soundtrack"],
  ratings: { votes: 10, value: 8.5 },
  releaseDate: "2009-01-07T00:00:00Z",
  releases: [],
  genres: ["Soundtrack"],
  media: [],
  artist: {
    id: 21,
    artistName: "Yukari Hashimoto",
    foreignArtistId: "artist-mbid",
    monitored: true,
    monitorNewItems: "none",
    qualityProfileId: 7,
    metadataProfileId: 8,
    rootFolderPath: "/lidarr/music",
    tags: [],
  },
  images: [{ coverType: "cover", remoteUrl: "https://images.invalid/cover.jpg" }],
  links: [],
  addOptions: { searchForNewAlbum: false },
  remoteCover: "https://images.invalid/cover.jpg",
};

const newAlbumLookupFixture = {
  ...albumFixture,
  id: 0,
  artistId: 0,
  monitored: false,
  artist: {
    ...albumFixture.artist,
    id: 0,
    monitored: false,
    qualityProfileId: 0,
    metadataProfileId: 0,
    rootFolderPath: null,
  },
};

function providerFor(routes: Parameters<typeof routedFetch>[0], overrides: Record<string, unknown> = {}) {
  const { fetch, requests } = routedFetch(routes);
  const http = new UpstreamHttp({ fetch, maxRetries: 0 });
  const provider = new LidarrMusicAcquisitionProvider({
    http,
    baseUrl: "https://lidarr.fixture.invalid/",
    rootFolderPath: "/lidarr/music",
    sharedRoot: "/shared/music",
    qualityProfileId: 7,
    metadataProfileId: 8,
    ownershipTagId: 42,
    ...overrides,
  });
  return { provider, requests };
}

function release(): NormalizedProviderRelease {
  return {
    provider: "LIDARR",
    providerReleaseId: "release-group-mbid",
    musicbrainzReleaseGroupId: "release-group-mbid",
    title: "Toradora! Original Soundtrack",
    normalizedTitle: "toradora! original soundtrack",
    artistCredit: "Yukari Hashimoto",
    normalizedArtist: "yukari hashimoto",
    tracks: [],
  };
}

describe("LidarrMusicAcquisitionProvider catalog and ownership", () => {
  it("parses lookup misses and normalized hits using stable MusicBrainz identity", async () => {
    const { provider, requests } = providerFor([
      {
        match: "/api/v1/album/lookup",
        response: (url) => ({
          status: 200,
          body: url.includes("missing") ? "[]" : JSON.stringify([albumFixture]),
        }),
      },
    ]);

    await expect(provider.lookupReleases({ query: "missing" })).resolves.toEqual([]);
    await expect(provider.lookupReleases({
      query: "ignored",
      musicbrainzReleaseGroupId: "release-group-mbid",
    })).resolves.toEqual([
      expect.objectContaining({
        providerReleaseId: "release-group-mbid",
        musicbrainzReleaseGroupId: "release-group-mbid",
        normalizedTitle: "toradora! original soundtrack",
        normalizedArtist: "yukari hashimoto",
        artworkUrl: "https://images.invalid/cover.jpg",
      }),
    ]);
    expect(new URL(requests[1]!.url).searchParams.get("term")).toBe("lidarr:release-group-mbid");
  });

  it("does not use Lidarr's release-group syntax for an individual release id", async () => {
    const { provider, requests } = providerFor([
      { match: "/api/v1/album/lookup", response: { status: 200, body: "[]" } },
    ]);

    await provider.lookupReleases({
      query: "Toradora soundtrack",
      musicbrainzReleaseId: "individual-release-mbid",
    });

    expect(new URL(requests[0]!.url).searchParams.get("term")).toBe("Toradora soundtrack");
  });

  it("reuses an existing operator album and preserves its prior monitor state", async () => {
    const { provider, requests } = providerFor([
      {
        match: "/api/v1/album?",
        response: { status: 200, body: JSON.stringify([{ ...albumFixture, monitored: false }]) },
      },
      { match: "/api/v1/album/monitor", response: { status: 202, body: JSON.stringify([{ ...albumFixture, monitored: true }]) } },
    ]);

    const ensured = await provider.ensureRelease({ release: release() });

    expect(ensured.resource).toMatchObject({
      providerReleaseId: "12",
      providerResourceCreated: false,
      priorProviderMonitoringState: "false",
      providerMetadata: {
        adapterOwned: false,
        lidarrAlbumId: 12,
        foreignAlbumId: "release-group-mbid",
        monitoringChanged: true,
      },
    });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({ albumIds: [12], monitored: true });
  });

  it("adds and monitors a tagged album without starting a release grab", async () => {
    const { provider, requests } = providerFor([
      { match: "/api/v1/album?", response: { status: 200, body: "[]" } },
      { match: "/api/v1/album/lookup", response: { status: 200, body: JSON.stringify([newAlbumLookupFixture]) } },
      { match: "/api/v1/album", response: { status: 201, body: JSON.stringify(albumFixture) } },
    ]);

    const ensured = await provider.ensureRelease({ release: release() });

    expect(ensured.resource).toMatchObject({
      providerReleaseId: "12",
      providerResourceCreated: true,
      providerMetadata: {
        adapterOwned: true,
        artistCreated: true,
        createdArtistId: 21,
        createdArtistForeignId: "artist-mbid",
        ownershipTagId: 42,
      },
    });
    const body = JSON.parse(String(requests[2]!.init?.body));
    expect(body).toMatchObject({
      foreignAlbumId: "release-group-mbid",
      title: "Toradora! Original Soundtrack",
      monitored: true,
      anyReleaseOk: true,
      artist: {
        artistName: "Yukari Hashimoto",
        foreignArtistId: "artist-mbid",
        monitored: true,
        monitorNewItems: "none",
        rootFolderPath: "/lidarr/music",
        qualityProfileId: 7,
        metadataProfileId: 8,
        tags: [42],
        addOptions: { monitor: "none", searchForMissingAlbums: false },
      },
      addOptions: { searchForNewAlbum: false },
    });
    expect(requests.some((request) => new URL(request.url).pathname.toLowerCase().includes("release")))
      .toBe(false);
  });

  it("does not reconfigure a pre-existing artist while adding its album", async () => {
    const { provider, requests } = providerFor([
      { match: "/api/v1/album?", response: { status: 200, body: "[]" } },
      { match: "/api/v1/album/lookup", response: { status: 200, body: JSON.stringify([{ ...albumFixture, id: 0 }]) } },
      { match: "/api/v1/album", response: { status: 201, body: JSON.stringify(albumFixture) } },
    ]);

    await provider.ensureRelease({ release: release() });

    const body = JSON.parse(String(requests[2]!.init?.body));
    expect(body.artist).toEqual(albumFixture.artist);
    expect(body.artist.tags).toEqual([]);
    expect(body.artist.addOptions).toBeUndefined();
  });
});

describe("LidarrMusicAcquisitionProvider search and status", () => {
  it("starts AlbumSearch and returns the parsed command id", async () => {
    const { provider, requests } = providerFor([
      { match: "/api/v1/command", response: { status: 201, body: JSON.stringify({ id: 91, status: "queued" }) } },
    ]);

    await expect(provider.startAcquisition({ providerReleaseId: "12" }))
      .resolves.toEqual({ providerJobId: "91" });
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      name: "AlbumSearch",
      albumIds: [12],
    });
  });

  it.each([
    ["queued", "QUEUED"],
    ["started", "RUNNING"],
    ["failed", "FAILED"],
    ["orphaned", "FAILED"],
  ] as const)("maps command status %s to %s", async (lidarrStatus, state) => {
    const { provider } = providerFor([
      {
        match: "/api/v1/command/91",
        response: { status: 200, body: JSON.stringify({ id: 91, status: lidarrStatus, message: "fixture" }) },
      },
    ]);
    await expect(provider.getAcquisitionStatus({ providerJobId: "91" }))
      .resolves.toMatchObject({ state });
  });

  it("uses queue and history after a completed search", async () => {
    const complete = { id: 91, status: "completed", body: { albumIds: [12] } };
    const running = providerFor([
      { match: "/api/v1/command/91", response: { status: 200, body: JSON.stringify(complete) } },
      { match: "/api/v1/queue/details", response: { status: 200, body: JSON.stringify({ records: [{ albumId: 12, status: "downloading" }] }) } },
    ]).provider;
    await expect(running.getAcquisitionStatus({ providerJobId: "91" }))
      .resolves.toEqual({ state: "RUNNING" });

    const imported = providerFor([
      { match: "/api/v1/command/91", response: { status: 200, body: JSON.stringify(complete) } },
      { match: "/api/v1/queue/details", response: { status: 200, body: JSON.stringify({ records: [] }) } },
      { match: "/api/v1/history", response: { status: 200, body: JSON.stringify({ records: [{ albumId: 12, eventType: "trackFileImported" }] }) } },
    ]).provider;
    await expect(imported.getAcquisitionStatus({ providerJobId: "91" }))
      .resolves.toEqual({ state: "COMPLETE" });
  });
});

describe("LidarrMusicAcquisitionProvider imported files and cleanup", () => {
  it("joins tracks to track files and maps the shared readable path", async () => {
    const { provider } = providerFor([
      { match: "/api/v1/album/12", response: { status: 200, body: JSON.stringify(albumFixture) } },
      {
        match: "/api/v1/track?",
        response: {
          status: 200,
          body: JSON.stringify([{
            id: 31,
            albumId: 12,
            trackFileId: 51,
            foreignTrackId: "release-track-mbid",
            foreignRecordingId: "recording-mbid",
            title: "Pre-Parade",
            duration: 241000,
          }]),
        },
      },
      {
        match: "/api/v1/trackFile?",
        response: {
          status: 200,
          body: JSON.stringify([{ id: 51, albumId: 12, path: "/downloads/Toradora/01.flac", size: 123456 }]),
        },
      },
    ], { pathPrefixFrom: "/downloads", pathPrefixTo: "/shared/downloads" });

    await expect(provider.listImportedFiles({ providerReleaseId: "12" })).resolves.toEqual([{
      provider: "LIDARR",
      providerFileId: "51",
      providerReleaseId: "12",
      providerTrackId: "release-track-mbid",
      musicbrainzRecordingId: "recording-mbid",
      sourcePath: "/downloads/Toradora/01.flac",
      readablePath: "/shared/downloads/Toradora/01.flac",
      title: "Pre-Parade",
      normalizedTitle: "pre-parade",
      artistCredit: "Yukari Hashimoto",
      normalizedArtist: "yukari hashimoto",
      durationSeconds: 241,
      sizeBytes: 123456,
      contentType: "audio/flac",
    }]);
  });

  it("maps Windows prefixes case-insensitively and rejects prefix lookalikes", () => {
    expect(mapLidarrPath("D:\\Downloads\\Anime\\song.flac", {
      rootFolderPath: "D:\\Music",
      sharedRoot: "F:\\Music",
      pathPrefixFrom: "d:\\downloads",
      pathPrefixTo: "F:\\Shared",
    })).toBe("F:\\Shared\\Anime\\song.flac");
    expect(() => mapLidarrPath("/downloads-other/song.flac", {
      rootFolderPath: "/downloads",
      sharedRoot: "/shared",
    })).toThrowError(LidarrProviderError);
    expect(() => mapLidarrPath("/downloads/../private/song.flac", {
      rootFolderPath: "/downloads",
      sharedRoot: "/shared",
    })).toThrowError(expect.objectContaining({ code: "PATH_NOT_MAPPED" }));
    expect(() => mapLidarrPath("D:\\Downloads\\.\\song.flac", {
      rootFolderPath: "D:\\Downloads",
      sharedRoot: "F:\\Shared",
    })).toThrowError(expect.objectContaining({ code: "PATH_NOT_MAPPED" }));
  });

  it("restores temporary operator monitoring only when requested and never deletes operator albums", async () => {
    const { provider, requests } = providerFor([
      { match: "/api/v1/album/12", response: { status: 200, body: JSON.stringify({ ...albumFixture, monitored: true }) } },
      { match: "/api/v1/album/monitor", response: { status: 202, body: JSON.stringify([{ ...albumFixture, monitored: false }]) } },
    ]);
    const operator: MusicProviderResourceContext = {
      provider: "LIDARR",
      providerReleaseId: "12",
      providerResourceCreated: false,
      priorProviderMonitoringState: "false",
      providerMetadata: {
        adapterOwned: false,
        lidarrAlbumId: 12,
        foreignAlbumId: "release-group-mbid",
        monitoringChanged: true,
      },
    };
    await expect(provider.cleanup({ resource: operator, restorePriorMonitoringState: false }))
      .resolves.toEqual({ cleaned: false });
    expect(requests).toHaveLength(0);
    await expect(provider.cleanup({ resource: operator, restorePriorMonitoringState: true }))
      .resolves.toEqual({ cleaned: true });
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({ albumIds: [12], monitored: false });
    expect(requests[1]!.url).toContain("/album/monitor");
  });

  it("deletes only a created album whose durable id and foreign id still match", async () => {
    const { provider, requests } = providerFor([
      { match: "/api/v1/album/12", response: { status: 200, body: JSON.stringify(albumFixture) } },
    ]);
    const owned: MusicProviderResourceContext = {
      provider: "LIDARR",
      providerReleaseId: "12",
      providerResourceCreated: true,
      providerMetadata: {
        adapterOwned: true,
        lidarrAlbumId: 12,
        foreignAlbumId: "release-group-mbid",
        artistCreated: false,
        createdArtistId: 21,
      },
    };
    await expect(provider.cleanup({ resource: owned, restorePriorMonitoringState: false }))
      .resolves.toEqual({ cleaned: true });
    expect(requests.map((request) => request.init?.method)).toEqual(["GET", "DELETE"]);
    expect(requests[1]!.url).toContain("deleteFiles=false");
    expect(requests.some((request) => new URL(request.url).pathname.includes("/artist/"))).toBe(false);
  });

  it("removes an adapter-created artist only when its tag and sole owned album still match", async () => {
    const { provider, requests } = providerFor([
      { match: "/api/v1/album/12", response: { status: 200, body: JSON.stringify(albumFixture) } },
      {
        match: "/api/v1/artist/21",
        response: { status: 200, body: JSON.stringify({ ...albumFixture.artist, tags: [42] }) },
      },
      { match: "artistId=21", response: { status: 200, body: JSON.stringify([albumFixture]) } },
    ]);
    const owned: MusicProviderResourceContext = {
      provider: "LIDARR",
      providerReleaseId: "12",
      providerResourceCreated: true,
      providerMetadata: {
        adapterOwned: true,
        lidarrAlbumId: 12,
        foreignAlbumId: "release-group-mbid",
        artistCreated: true,
        createdArtistId: 21,
        createdArtistForeignId: "artist-mbid",
        ownershipTagId: 42,
      },
    };

    await expect(provider.cleanup({ resource: owned, restorePriorMonitoringState: false }))
      .resolves.toEqual({ cleaned: true });
    expect(requests.map((request) => request.init?.method))
      .toEqual(["GET", "GET", "GET", "DELETE", "DELETE"]);
    expect(new URL(requests[3]!.url).pathname).toBe("/api/v1/album/12");
    expect(new URL(requests[4]!.url).pathname).toBe("/api/v1/artist/21");
  });

  it("preserves a tagged adapter-created artist when another album remains", async () => {
    const otherAlbum = { ...albumFixture, id: 13, foreignAlbumId: "operator-release-group" };
    const { provider, requests } = providerFor([
      { match: "/api/v1/album/12", response: { status: 200, body: JSON.stringify(albumFixture) } },
      {
        match: "/api/v1/artist/21",
        response: { status: 200, body: JSON.stringify({ ...albumFixture.artist, tags: [42] }) },
      },
      {
        match: "artistId=21",
        response: { status: 200, body: JSON.stringify([albumFixture, otherAlbum]) },
      },
    ]);
    const owned: MusicProviderResourceContext = {
      provider: "LIDARR",
      providerReleaseId: "12",
      providerResourceCreated: true,
      providerMetadata: {
        adapterOwned: true,
        lidarrAlbumId: 12,
        foreignAlbumId: "release-group-mbid",
        artistCreated: true,
        createdArtistId: 21,
        createdArtistForeignId: "artist-mbid",
        ownershipTagId: 42,
      },
    };

    await expect(provider.cleanup({ resource: owned, restorePriorMonitoringState: false }))
      .resolves.toEqual({ cleaned: true });
    expect(requests.filter((request) => request.init?.method === "DELETE")).toHaveLength(1);
    expect(new URL(requests.at(-1)!.url).pathname).toBe("/api/v1/album/12");
  });

  it("refuses created cleanup when Lidarr reused the numeric id for another album", async () => {
    const { provider, requests } = providerFor([
      {
        match: "/api/v1/album/12",
        response: {
          status: 200,
          body: JSON.stringify({ ...albumFixture, foreignAlbumId: "different-release-group" }),
        },
      },
    ]);
    const stale: MusicProviderResourceContext = {
      provider: "LIDARR",
      providerReleaseId: "12",
      providerResourceCreated: true,
      providerMetadata: {
        adapterOwned: true,
        lidarrAlbumId: 12,
        foreignAlbumId: "release-group-mbid",
      },
    };

    await expect(provider.cleanup({ resource: stale, restorePriorMonitoringState: false }))
      .resolves.toEqual({ cleaned: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.init?.method).toBe("GET");
  });
});

describe("LidarrMusicAcquisitionProvider deterministic errors", () => {
  it("rejects unexpected and missing response fields as non-retryable malformed data", async () => {
    const { provider } = providerFor([
      { match: "/api/v1/album/lookup", response: { status: 200, body: JSON.stringify([{ title: "missing identity" }]) } },
    ]);
    await expect(provider.lookupReleases({ query: "fixture" })).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
      retryable: false,
    });
  });

  it.each([
    [401, "AUTHENTICATION_FAILED", false],
    [404, "NOT_FOUND", false],
    [429, "RATE_LIMITED", true],
    [500, "UPSTREAM_FAILURE", true],
  ] as const)("classifies HTTP %i as %s", async (status, code, retryable) => {
    const response: FakeResponse = { status, body: "fixture failure" };
    const { fetch } = fakeFetch([response]);
    const provider = new LidarrMusicAcquisitionProvider({
      http: new UpstreamHttp({ fetch, maxRetries: 0 }),
      baseUrl: "https://lidarr.fixture.invalid",
      rootFolderPath: "/lidarr/music",
      sharedRoot: "/shared/music",
      qualityProfileId: 7,
      metadataProfileId: 8,
    });
    await expect(provider.lookupReleases({ query: "fixture" })).rejects.toMatchObject({
      code,
      retryable,
      status,
    });
  });
});
