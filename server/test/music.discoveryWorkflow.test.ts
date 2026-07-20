import { describe, expect, it, vi } from "vitest";
import type { JobQueue } from "../src/jobs/jobQueue.js";
import type { JobRecord } from "../src/jobs/types.js";
import {
  ConservativeMusicCatalogResolver,
  MusicDiscoveryWorkflowService,
  PgDiscoveryCatalogRepository,
  type DiscoveryCatalogRepository,
} from "../src/music/index.js";
import type { MusicAcquisitionProvider, NormalizedProviderRelease } from "../src/music/types.js";

const job = { id: 1, attempts: 0, maxAttempts: 5 } as JobRecord;

function release(): NormalizedProviderRelease {
  return {
    provider: "test", providerReleaseId: "release-1", title: "Example OST",
    normalizedTitle: "example ost", artistCredit: "Artist", normalizedArtist: "artist",
    tracks: [],
  };
}

describe("MusicDiscoveryWorkflow", () => {
  it("routes only provider-poll recovery through reconcile, leaving IMPORTING to the import lane", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "4" }] });
    const catalog = new PgDiscoveryCatalogRepository({ query } as never);

    await expect(catalog.listRecoverableAcquisitionIds()).resolves.toEqual([4]);

    expect(String(query.mock.calls[0]![0])).toContain("state IN ('REQUESTED','ACQUIRING')");
    expect(String(query.mock.calls[0]![0])).not.toContain("'IMPORTING'");
  });
  it("enriches sequential query candidates, persists an accepted Full Size intent, and starts one durable acquisition", async () => {
    const catalog = {
      loadTargets: vi.fn().mockResolvedValue([{
        target: { kind: "FULL_SIZE", animeThemesAnimeId: 7, animeTitles: ["Example"],
          animeThemesSongId: 55, musicbrainzRecordingId: "recording-1", title: "Opening", artist: "Artist", durationSeconds: 90 },
        themeId: 99,
      }]),
      persistResolution: vi.fn().mockResolvedValue({ acquisitionId: 42, alreadyStarted: false }),
      markAcquisitionStarted: vi.fn().mockResolvedValue(undefined),
      getAcquisition: vi.fn(),
      markAcquisitionImporting: vi.fn(),
      markAcquisitionFailed: vi.fn(),
      listRecoverableAcquisitionIds: vi.fn(),
    } satisfies DiscoveryCatalogRepository;
    const provider = {
      provider: "test", healthCheck: vi.fn().mockResolvedValue({ available: true }),
      lookupReleases: vi.fn().mockResolvedValue([release()]),
      ensureRelease: vi.fn().mockResolvedValue({ resource: {
        provider: "test", providerReleaseId: "provider-release", providerResourceCreated: true, providerMetadata: {},
      } }),
      listReleaseTracks: vi.fn().mockResolvedValue([{
        provider: "test", providerTrackId: "track-1", providerReleaseId: "release-1", title: "Opening",
        normalizedTitle: "opening", artistCredit: "Artist", normalizedArtist: "artist", discNumber: 1,
        trackNumber: 1, durationSeconds: 240, musicbrainzRecordingId: "recording-1",
      }]),
      startAcquisition: vi.fn().mockResolvedValue({ providerJobId: "job-1" }),
      getAcquisitionStatus: vi.fn(), listImportedFiles: vi.fn(), cleanup: vi.fn(),
    } satisfies MusicAcquisitionProvider;
    const enqueue = vi.fn().mockResolvedValue({});
    const workflow = new MusicDiscoveryWorkflowService({
      catalog, provider, resolver: new ConservativeMusicCatalogResolver(), queue: { enqueue } as unknown as JobQueue,
    });

    const result = await workflow.discoverAnime({ animeId: 7, job });

    expect(result).toEqual({ missingFullCount: 0, ambiguous: false });
    expect(provider.lookupReleases).toHaveBeenCalledTimes(5);
    expect(provider.ensureRelease).toHaveBeenCalledWith({ release: expect.objectContaining({ providerReleaseId: "release-1" }) });
    expect(provider.listReleaseTracks).toHaveBeenCalledWith({ providerReleaseId: "provider-release" });
    expect(catalog.persistResolution).toHaveBeenCalledWith(expect.objectContaining({
      animeId: 7, themeId: 99, resolution: expect.objectContaining({ outcome: "ACCEPTED" }),
    }));
    expect(catalog.markAcquisitionStarted).toHaveBeenCalledWith(42, "job-1");
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      type: "RECONCILE_MUSIC_ACQUISITION", payload: { acquisitionId: 42 },
    }));
    const lookupOrder = Math.max(...provider.lookupReleases.mock.invocationCallOrder);
    expect(lookupOrder).toBeLessThan(provider.ensureRelease.mock.invocationCallOrder[0]!);
    expect(provider.ensureRelease.mock.invocationCallOrder[0]!).toBeLessThan(provider.listReleaseTracks.mock.invocationCallOrder[0]!);
    expect(provider.listReleaseTracks.mock.invocationCallOrder[0]!).toBeLessThan(catalog.persistResolution.mock.invocationCallOrder[0]!);
    expect(catalog.persistResolution.mock.invocationCallOrder[0]!).toBeLessThan(provider.startAcquisition.mock.invocationCallOrder[0]!);
    expect(provider.startAcquisition.mock.invocationCallOrder[0]!).toBeLessThan(catalog.markAcquisitionStarted.mock.invocationCallOrder[0]!);
    expect(catalog.markAcquisitionStarted.mock.invocationCallOrder[0]!).toBeLessThan(enqueue.mock.invocationCallOrder[0]!);
  });

  it("records ambiguous outcomes without starting provider acquisition", async () => {
    const catalog = {
      loadTargets: vi.fn().mockResolvedValue([{
        target: { kind: "FULL_SIZE", animeThemesAnimeId: 7, animeTitles: ["Example"], title: "Opening", artist: "Artist", durationSeconds: 90 },
        themeId: 99,
      }]),
      persistResolution: vi.fn().mockResolvedValue(undefined), markAcquisitionStarted: vi.fn(), getAcquisition: vi.fn(),
      markAcquisitionImporting: vi.fn(), markAcquisitionFailed: vi.fn(), listRecoverableAcquisitionIds: vi.fn(),
    } satisfies DiscoveryCatalogRepository;
    const provider = {
      provider: "test", healthCheck: vi.fn().mockResolvedValue({ available: true }),
      lookupReleases: vi.fn().mockResolvedValue([release()]),
      ensureRelease: vi.fn().mockResolvedValue({ resource: { provider: "test", providerReleaseId: "provider-release", providerResourceCreated: false, providerMetadata: {} } }),
      listReleaseTracks: vi.fn().mockResolvedValue([{
        provider: "test", providerTrackId: "wrong", providerReleaseId: "release-1", title: "Different", normalizedTitle: "different",
        artistCredit: "Other", normalizedArtist: "other", discNumber: 1, durationSeconds: 240,
      }]),
      startAcquisition: vi.fn(), getAcquisitionStatus: vi.fn(), listImportedFiles: vi.fn(), cleanup: vi.fn(),
    } satisfies MusicAcquisitionProvider;
    const workflow = new MusicDiscoveryWorkflowService({ catalog, provider, resolver: new ConservativeMusicCatalogResolver(), queue: { enqueue: vi.fn() } as unknown as JobQueue });

    const result = await workflow.discoverAnime({ animeId: 7, job });

    expect(result).toEqual({ missingFullCount: 1, ambiguous: false });
    expect(catalog.persistResolution).toHaveBeenCalledWith(expect.objectContaining({ resolution: expect.objectContaining({ outcome: "REJECTED" }) }));
    expect(provider.startAcquisition).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous Full Size lookup operator-only and never mutates either provider candidate", async () => {
    const catalog = {
      loadTargets: vi.fn().mockResolvedValue([{ target: { kind: "FULL_SIZE", animeThemesAnimeId: 7, animeTitles: ["Example"], title: "Opening", artist: "Artist", durationSeconds: 90 }, themeId: 99 }]),
      persistResolution: vi.fn().mockResolvedValue(undefined), markAcquisitionStarted: vi.fn(), getAcquisition: vi.fn(), markAcquisitionImporting: vi.fn(), markAcquisitionFailed: vi.fn(), listRecoverableAcquisitionIds: vi.fn(),
    } satisfies DiscoveryCatalogRepository;
    const provider = {
      provider: "test", healthCheck: vi.fn().mockResolvedValue({ available: true }),
      lookupReleases: vi.fn().mockResolvedValue([release(), { ...release(), providerReleaseId: "release-2" }]),
      ensureRelease: vi.fn(), listReleaseTracks: vi.fn(), startAcquisition: vi.fn(), getAcquisitionStatus: vi.fn(), listImportedFiles: vi.fn(), cleanup: vi.fn(),
    } satisfies MusicAcquisitionProvider;
    const workflow = new MusicDiscoveryWorkflowService({ catalog, provider, resolver: new ConservativeMusicCatalogResolver(), queue: { enqueue: vi.fn() } as unknown as JobQueue });

    await workflow.discoverAnime({ animeId: 7, job });

    expect(provider.ensureRelease).not.toHaveBeenCalled();
    expect(provider.startAcquisition).not.toHaveBeenCalled();
    expect(catalog.persistResolution).toHaveBeenCalledWith(expect.objectContaining({ purpose: "FULL_SIZE", resolution: expect.objectContaining({ outcome: "AMBIGUOUS" }) }));
  });

  it("lets provider transport failures retry normally without terminalizing a durable acquisition", async () => {
    const catalog = {
      loadTargets: vi.fn(), persistResolution: vi.fn(), markAcquisitionStarted: vi.fn(),
      getAcquisition: vi.fn().mockResolvedValue({ id: 42, providerJobId: "job-1", providerReleaseId: "release-1", state: "ACQUIRING" }),
      markAcquisitionImporting: vi.fn(), markAcquisitionFailed: vi.fn(), listRecoverableAcquisitionIds: vi.fn(),
    } satisfies DiscoveryCatalogRepository;
    const provider = {
      provider: "test", healthCheck: vi.fn(), lookupReleases: vi.fn(), ensureRelease: vi.fn(), listReleaseTracks: vi.fn(), startAcquisition: vi.fn(),
      getAcquisitionStatus: vi.fn().mockRejectedValue(new Error("provider offline")), listImportedFiles: vi.fn(), cleanup: vi.fn(),
    } satisfies MusicAcquisitionProvider;
    const workflow = new MusicDiscoveryWorkflowService({ catalog, provider, resolver: new ConservativeMusicCatalogResolver(), queue: { enqueue: vi.fn() } as unknown as JobQueue });

    await expect(workflow.reconcileAcquisition({ acquisitionId: 42, job })).rejects.toThrow("provider offline");

    expect(catalog.markAcquisitionFailed).not.toHaveBeenCalled();
  });

  it("repairs a resource-persisted REQUESTED acquisition by reusing the provider start contract and storing its command id", async () => {
    const catalog = {
      loadTargets: vi.fn(), persistResolution: vi.fn(),
      getAcquisition: vi.fn().mockResolvedValue({ id: 42, providerJobId: null, providerReleaseId: "release-1", state: "REQUESTED" }),
      markAcquisitionStarted: vi.fn().mockResolvedValue(undefined), markAcquisitionImporting: vi.fn(), markAcquisitionFailed: vi.fn(), listRecoverableAcquisitionIds: vi.fn(),
    } satisfies DiscoveryCatalogRepository;
    const provider = {
      provider: "test", healthCheck: vi.fn(), lookupReleases: vi.fn(), ensureRelease: vi.fn(), listReleaseTracks: vi.fn(),
      startAcquisition: vi.fn().mockResolvedValue({ providerJobId: "job-reused" }), getAcquisitionStatus: vi.fn(), listImportedFiles: vi.fn(), cleanup: vi.fn(),
    } satisfies MusicAcquisitionProvider;
    const workflow = new MusicDiscoveryWorkflowService({ catalog, provider, resolver: new ConservativeMusicCatalogResolver(), queue: { enqueue: vi.fn() } as unknown as JobQueue });

    await expect(workflow.reconcileAcquisition({ acquisitionId: 42, job })).resolves.toBe("PENDING");

    expect(provider.startAcquisition).toHaveBeenCalledWith({ providerReleaseId: "release-1", recovery: true });
    expect(catalog.markAcquisitionStarted).toHaveBeenCalledWith(42, "job-reused");
  });

  it("filters a release already linked to the anime so discovery can advance to the next candidate", async () => {
    const catalog = {
      loadTargets: vi.fn().mockResolvedValue([{
        target: { kind: "RELATED_RELEASE", animeThemesAnimeId: 7, animeTitles: ["Example"] },
        excludedProviderReleaseIds: ["test:release-0"],
      }]),
      persistResolution: vi.fn().mockResolvedValue({ acquisitionId: 42, alreadyStarted: false }), markAcquisitionStarted: vi.fn(), getAcquisition: vi.fn(), markAcquisitionImporting: vi.fn(), markAcquisitionFailed: vi.fn(), listRecoverableAcquisitionIds: vi.fn(),
    } satisfies DiscoveryCatalogRepository;
    const related = { ...release(), title: "Example Original Soundtrack" };
    const blocked = { ...related, providerReleaseId: "release-0" };
    const provider = {
      provider: "test", healthCheck: vi.fn().mockResolvedValue({ available: true }), lookupReleases: vi.fn().mockResolvedValue([blocked, related]),
      ensureRelease: vi.fn().mockResolvedValue({ resource: { provider: "test", providerReleaseId: "provider-release", providerResourceCreated: false, providerMetadata: {} } }),
      listReleaseTracks: vi.fn().mockResolvedValue([{ provider: "test", providerTrackId: "track-1", providerReleaseId: "release-1", musicbrainzRecordingId: "recording-1", title: "Opening", normalizedTitle: "opening", artistCredit: "Artist", normalizedArtist: "artist", discNumber: 1, durationSeconds: 240 }]),
      startAcquisition: vi.fn().mockResolvedValue({ providerJobId: "job-1" }), getAcquisitionStatus: vi.fn(), listImportedFiles: vi.fn(), cleanup: vi.fn(),
    } satisfies MusicAcquisitionProvider;
    const workflow = new MusicDiscoveryWorkflowService({ catalog, provider, resolver: new ConservativeMusicCatalogResolver(), queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue });
    await workflow.discoverAnime({ animeId: 7, job });
    expect(provider.ensureRelease).toHaveBeenCalledWith({ release: expect.objectContaining({ providerReleaseId: "release-1" }) });
  });
});
