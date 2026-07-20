import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaStore } from "../src/media/mediaStore.js";
import type { MediaDescriptor, MediaFileRecord, MediaFileRepo, SaveMediaFileInput } from "../src/media/types.js";
import {
  MusicAcquisitionImportService,
  MusicImportValidationError,
  createMusicImportHandlers,
  type MusicAcquisitionImportRecord,
  type MusicAcquisitionImportRepository,
} from "../src/music/import/index.js";
import type { MusicAcquisitionProvider } from "../src/music/types.js";
import type { JobRecord } from "../src/jobs/types.js";
import { RetryableJobError } from "../src/jobs/jobWorker.js";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("MusicAcquisitionImportService", () => {
  it("imports exactly one strongly validated Full Size file and publishes only after media is READY", async () => {
    const h = harness(fullAcquisition());
    writeFileSync(join(h.providerRoot, "wanted.flac"), "wanted-audio");
    writeFileSync(join(h.providerRoot, "unrelated.flac"), "unrelated-audio");
    h.provider.listImportedFiles.mockResolvedValue([
      file("wanted", "wanted.flac", { title: "Opening", artist: "Artist", durationSeconds: 241 }),
      file("other", "unrelated.flac", { title: "Bonus", artist: "Other", durationSeconds: 180 }),
    ]);
    h.repo.publishReady.mockImplementation(async ({ songIds }) => {
      expect(songIds).toEqual([101]);
      expect(h.mediaRepo.records.get("AUDIO:song:101:ORIGINAL")?.state).toBe("READY");
    });

    await h.service.importAcquisition(7);

    expect(h.repo.publishReady).toHaveBeenCalledTimes(1);
    expect(h.mediaRepo.records.has("AUDIO:song:102:ORIGINAL")).toBe(false);
    expect(h.provider.cleanup).toHaveBeenCalledTimes(1);
  });

  it("imports only the complete accepted Related track set and ignores album extras", async () => {
    const h = harness(relatedAcquisition());
    for (const name of ["one.mp3", "two.flac", "bonus.mp3"]) writeFileSync(join(h.providerRoot, name), name);
    h.provider.listImportedFiles.mockResolvedValue([
      file("track-1", "one.mp3", { recordingId: "rec-1", title: "One", artist: "Artist", durationSeconds: 200 }, "release-2"),
      file("track-2", "two.flac", { recordingId: "rec-2", title: "Two", artist: "Artist", durationSeconds: 220 }, "release-2"),
      file("bonus", "bonus.mp3", { title: "Bonus", artist: "Other", durationSeconds: 99 }, "release-2"),
    ]);

    await h.service.importAcquisition(8);

    expect(h.repo.publishReady).toHaveBeenCalledWith({ acquisitionId: 8, songIds: [201, 202] });
    expect([...h.mediaRepo.records.keys()].sort()).toEqual([
      "AUDIO:song:201:ORIGINAL", "AUDIO:song:202:ORIGINAL",
    ]);
  });

  it("marks ambiguous duplicate Full Size evidence without copying or cleaning", async () => {
    const h = harness(fullAcquisition());
    for (const name of ["a.flac", "b.flac"]) writeFileSync(join(h.providerRoot, name), name);
    h.provider.listImportedFiles.mockResolvedValue([
      file("a", "a.flac", { title: "Opening", artist: "Artist", durationSeconds: 240 }),
      file("b", "b.flac", { title: "Opening", artist: "Artist", durationSeconds: 241 }),
    ]);

    await expect(h.service.importAcquisition(7)).rejects.toBeInstanceOf(MusicImportValidationError);

    expect(h.repo.markAmbiguous).toHaveBeenCalledWith(7, expect.stringMatching(/multiple/i));
    expect(h.repo.publishReady).not.toHaveBeenCalled();
    expect(h.provider.cleanup).not.toHaveBeenCalled();
    expect(h.mediaRepo.records.size).toBe(0);
  });

  it("hard-rejects an explicit recording-ID conflict instead of falling back to matching text", async () => {
    const h = harness(fullAcquisition());
    writeFileSync(join(h.providerRoot, "wrong.flac"), "wrong-recording");
    h.provider.listImportedFiles.mockResolvedValue([
      file("wanted", "wrong.flac", { recordingId: "different-recording", title: "Opening", artist: "Artist", durationSeconds: 240 }),
    ]);

    await expect(h.service.importAcquisition(7)).rejects.toMatchObject({ outcome: "FAILED" });

    expect(h.repo.markFailed).toHaveBeenCalled();
    expect(h.repo.publishReady).not.toHaveBeenCalled();
  });

  it("ignores files returned for another provider or release and prefers the accepted provider track identity", async () => {
    const h = harness(fullAcquisition());
    for (const name of ["wanted.flac", "wrong-provider.flac", "wrong-release.flac"]) writeFileSync(join(h.providerRoot, name), name);
    h.provider.listImportedFiles.mockResolvedValue([
      { ...file("wanted", "wrong-provider.flac", { title: "Opening", artist: "Artist", durationSeconds: 240 }), provider: "other" },
      file("wanted", "wrong-release.flac", { title: "Opening", artist: "Artist", durationSeconds: 240 }, "release-2"),
      file("wanted", "wanted.flac", { title: "Provider Renamed Title", artist: "Artist", durationSeconds: 240 }),
    ]);

    await h.service.importAcquisition(7);

    expect(h.repo.publishReady).toHaveBeenCalledWith({ acquisitionId: 7, songIds: [101] });
  });

  it("reuses one READY song file for two theme acquisitions and publishes both links idempotently", async () => {
    const first = fullAcquisition();
    const second = { ...fullAcquisition(), id: 9, themeId: 56 };
    const h = harness(first);
    writeFileSync(join(h.providerRoot, "wanted.flac"), "shared-recording");
    h.provider.listImportedFiles.mockResolvedValue([
      file("wanted", "wanted.flac", { recordingId: "recording-1", title: "Opening", artist: "Artist", durationSeconds: 240 }),
    ]);
    h.repo.loadAcquisition.mockImplementation(async (id) => id === 7 ? first : second);
    h.repo.hasUnfinishedSharedAcquisitions.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await h.service.importAcquisition(7);
    await h.service.importAcquisition(9);

    expect(h.mediaRepo.readyWrites).toBe(1);
    expect(h.repo.publishReady).toHaveBeenNthCalledWith(1, { acquisitionId: 7, songIds: [101] });
    expect(h.repo.publishReady).toHaveBeenNthCalledWith(2, { acquisitionId: 9, songIds: [101] });
    expect(h.provider.cleanup).toHaveBeenCalledTimes(1);
  });

  it("retries safely after copy/DB publication and never cleans while a shared-command intent is unfinished", async () => {
    const h = harness(fullAcquisition());
    writeFileSync(join(h.providerRoot, "wanted.flac"), "wanted-audio");
    h.provider.listImportedFiles.mockResolvedValue([
      file("wanted", "wanted.flac", { recordingId: "recording-1", title: "Opening", artist: "Artist", durationSeconds: 240 }),
    ]);
    h.repo.publishReady.mockRejectedValueOnce(new Error("crash after copy")).mockResolvedValueOnce(undefined);
    h.repo.hasUnfinishedSharedAcquisitions.mockResolvedValue(false);

    await expect(h.service.importAcquisition(7)).rejects.toThrow("crash after copy");
    await h.service.importAcquisition(7);

    expect(h.mediaRepo.readyWrites).toBe(1);
    expect(h.repo.publishReady).toHaveBeenCalledTimes(2);
    expect(h.provider.cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps READY publication when best-effort ownership cleanup fails", async () => {
    const h = harness(fullAcquisition());
    writeFileSync(join(h.providerRoot, "wanted.flac"), "wanted-audio");
    h.provider.listImportedFiles.mockResolvedValue([
      file("wanted", "wanted.flac", { recordingId: "recording-1", title: "Opening", artist: "Artist", durationSeconds: 240 }),
    ]);
    h.provider.cleanup.mockRejectedValue(new Error("cleanup offline"));

    await expect(h.service.importAcquisition(7)).resolves.toBeUndefined();

    expect(h.repo.publishReady).toHaveBeenCalledTimes(1);
    expect(h.repo.recordCleanupFailure).toHaveBeenCalledWith(7, "cleanup offline");
  });

  it("cleans through a READY shared-command peer when the final importing sibling terminalizes", async () => {
    const importing = { ...fullAcquisition(), id: 9, themeId: 56 };
    const readyPeer = { ...fullAcquisition(), state: "READY" as const };
    const h = harness(importing);
    h.provider.listImportedFiles.mockResolvedValue([]);
    h.repo.loadReadySharedAcquisition.mockResolvedValue(readyPeer);

    await expect(h.service.importAcquisition(9)).rejects.toMatchObject({ outcome: "FAILED" });

    expect(h.repo.markFailed).toHaveBeenCalledWith(9, expect.any(String));
    expect(h.provider.cleanup).toHaveBeenCalledTimes(1);
    expect(h.repo.recordCleanupSuccess).toHaveBeenCalledWith(7);
  });

  it("elects adapter-created ownership from a heterogeneous sibling group before cleanup", async () => {
    const operatorRow = { ...fullAcquisition(), state: "READY" as const, providerResourceCreated: false,
      priorProviderMonitoringState: "all", providerMetadata: { monitoringChanged: true } };
    const owner = { ...operatorRow, id: 6, providerResourceCreated: true, priorProviderMonitoringState: null,
      providerMetadata: { adapterOwned: true, foreignAlbumId: "owned-album" } };
    const h = harness(operatorRow);
    h.repo.loadAuthoritativeCleanupAcquisition.mockResolvedValue(owner);

    await h.service.importAcquisition(7);

    expect(h.provider.cleanup).toHaveBeenCalledWith({
      resource: expect.objectContaining({ providerResourceCreated: true, providerMetadata: expect.objectContaining({ adapterOwned: true }) }),
      restorePriorMonitoringState: true,
    });
    expect(h.repo.recordCleanupSuccess).toHaveBeenCalledWith(6);
  });

  it("does not repeat external cleanup after its durable marker committed", async () => {
    const complete = { ...fullAcquisition(), state: "READY" as const,
      providerMetadata: { adapterOwned: true, cleanupComplete: true } };
    const h = harness(complete);
    h.repo.loadAuthoritativeCleanupAcquisition.mockResolvedValue(complete);

    await h.service.importAcquisition(7);

    expect(h.provider.cleanup).not.toHaveBeenCalled();
    expect(h.repo.recordCleanupFailure).not.toHaveBeenCalled();
  });

  it("runs READY-peer cleanup when final operational retry terminalizes a shared sibling", async () => {
    const importing = { ...fullAcquisition(), id: 9, themeId: 56 };
    const readyPeer = { ...fullAcquisition(), state: "READY" as const };
    const h = harness(importing);
    h.repo.loadReadySharedAcquisition.mockResolvedValue(readyPeer);
    h.repo.loadAuthoritativeCleanupAcquisition.mockResolvedValue(readyPeer);

    await h.service.markOperationalFailed(9, "copy retries exhausted");

    expect(h.repo.markFailed).toHaveBeenCalledWith(9, "copy retries exhausted");
    expect(h.provider.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("IMPORT_MUSIC_AUDIO handler", () => {
  it("pauses without provider/file work or attempt consumption when discovery is disabled", async () => {
    const service = { importAcquisition: vi.fn(), markOperationalFailed: vi.fn() } as unknown as MusicAcquisitionImportService;
    const handler = createMusicImportHandlers({ enabled: false, service }).IMPORT_MUSIC_AUDIO;

    const thrown = await handler({ acquisitionId: 7 }, { attempts: 2, maxAttempts: 5 } as JobRecord).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(RetryableJobError);
    expect((thrown as RetryableJobError).options.incrementAttempts).toBe(false);
    expect(service.importAcquisition).not.toHaveBeenCalled();
  });

  it("terminalizes operational acquisition state on the queue's final finite attempt", async () => {
    const service = {
      importAcquisition: vi.fn().mockRejectedValue(new Error("database offline")),
      markOperationalFailed: vi.fn().mockResolvedValue(undefined),
    } as unknown as MusicAcquisitionImportService;
    const handler = createMusicImportHandlers({ enabled: true, service }).IMPORT_MUSIC_AUDIO;
    const job = { attempts: 4, maxAttempts: 5 } as JobRecord;

    await expect(handler({ acquisitionId: 7 }, job)).rejects.toThrow("database offline");

    expect(service.markOperationalFailed).toHaveBeenCalledWith(7, "database offline");
  });

  it("does not terminalize a transient operational failure before the final attempt", async () => {
    const service = {
      importAcquisition: vi.fn().mockRejectedValue(new Error("database offline")),
      markOperationalFailed: vi.fn(),
    } as unknown as MusicAcquisitionImportService;
    const handler = createMusicImportHandlers({ enabled: true, service }).IMPORT_MUSIC_AUDIO;

    await expect(handler({ acquisitionId: 7 }, { attempts: 2, maxAttempts: 5 } as JobRecord)).rejects.toThrow();
    expect(service.markOperationalFailed).not.toHaveBeenCalled();
  });
});

function harness(acquisition: MusicAcquisitionImportRecord) {
  root = mkdtempSync(join(tmpdir(), "ongaku-music-import-"));
  const mediaRoot = join(root, "media");
  const providerRoot = join(root, "provider");
  mkdirSync(mediaRoot, { recursive: true });
  mkdirSync(providerRoot, { recursive: true });
  const mediaRepo = new FakeMediaRepo();
  const mediaStore = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo: mediaRepo, minBytes: 1 });
  const repo = {
    loadAcquisition: vi.fn().mockResolvedValue(acquisition),
    withSongLocks: vi.fn(async (_songIds: number[], action: () => Promise<unknown>) => action()),
    publishReady: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markAmbiguous: vi.fn().mockResolvedValue(undefined),
    hasUnfinishedSharedAcquisitions: vi.fn().mockResolvedValue(false),
    loadReadySharedAcquisition: vi.fn().mockResolvedValue(null),
    loadAuthoritativeCleanupAcquisition: vi.fn().mockImplementation(async (value) => value),
    withCleanupLock: vi.fn(async (_value: MusicAcquisitionImportRecord, action: () => Promise<unknown>) => action()),
    recordCleanupSuccess: vi.fn().mockResolvedValue(undefined),
    recordCleanupFailure: vi.fn().mockResolvedValue(undefined),
  } satisfies MusicAcquisitionImportRepository;
  const provider = {
    provider: "test", healthCheck: vi.fn(), lookupReleases: vi.fn(), ensureRelease: vi.fn(),
    startAcquisition: vi.fn(), getAcquisitionStatus: vi.fn(), listReleaseTracks: vi.fn(),
    listImportedFiles: vi.fn(), cleanup: vi.fn().mockResolvedValue({ cleaned: true }),
  } satisfies MusicAcquisitionProvider;
  const service = new MusicAcquisitionImportService({ repo, provider, mediaStore });
  return { mediaRoot, providerRoot, mediaRepo, mediaStore, repo, provider, service };
}

function fullAcquisition(): MusicAcquisitionImportRecord {
  return {
    id: 7, provider: "test", providerJobId: "command-1", providerReleaseId: "release-1",
    animeId: 44, purpose: "FULL_SIZE", themeId: 55, releaseId: 88, state: "IMPORTING",
    providerResourceCreated: true, priorProviderMonitoringState: null, providerMetadata: { adapterOwned: true },
    expectedTracks: [{ songId: 101, providerTrackId: "wanted", musicbrainzRecordingId: "recording-1",
      normalizedTitle: "opening", normalizedArtist: "artist", durationSeconds: 240 }],
  };
}

function relatedAcquisition(): MusicAcquisitionImportRecord {
  return {
    id: 8, provider: "test", providerJobId: "command-2", providerReleaseId: "release-2",
    animeId: 44, purpose: "RELATED_RELEASE", themeId: null, releaseId: 89, state: "IMPORTING",
    providerResourceCreated: false, priorProviderMonitoringState: "all", providerMetadata: { monitoringChanged: true },
    expectedTracks: [
      { songId: 201, providerTrackId: "track-1", musicbrainzRecordingId: "rec-1", normalizedTitle: "one", normalizedArtist: "artist", durationSeconds: 200 },
      { songId: 202, providerTrackId: "track-2", musicbrainzRecordingId: "rec-2", normalizedTitle: "two", normalizedArtist: "artist", durationSeconds: 220 },
    ],
  };
}

function file(providerTrackId: string, readablePath: string, values: { title: string; artist: string; durationSeconds: number; recordingId?: string }, providerReleaseId = "release-1") {
  return { provider: "test", providerFileId: `file-${providerTrackId}-${readablePath}`, providerReleaseId, providerTrackId,
    sourcePath: readablePath, readablePath, title: values.title, normalizedTitle: values.title.toLowerCase(),
    artistCredit: values.artist, normalizedArtist: values.artist.toLowerCase(), durationSeconds: values.durationSeconds,
    ...(values.recordingId ? { musicbrainzRecordingId: values.recordingId } : {}) };
}

class FakeMediaRepo implements MediaFileRepo {
  records = new Map<string, MediaFileRecord>();
  readyWrites = 0;
  async find(input: MediaDescriptor) { return this.records.get(key(input)) ?? null; }
  async markDownloading(input: SaveMediaFileInput) { this.records.set(key(input), record(input, "DOWNLOADING")); }
  async markReady(input: SaveMediaFileInput & { byteSize: number; sha256: string }) {
    this.readyWrites++;
    this.records.set(key(input), { ...record(input, "READY"), filePath: input.filePath, byteSize: input.byteSize, sha256: input.sha256 });
  }
  async markFailed(input: SaveMediaFileInput & { errorMessage: string }) { this.records.set(key(input), { ...record(input, "FAILED"), errorMessage: input.errorMessage }); }
}

function key(input: Pick<SaveMediaFileInput, "kind" | "refId" | "variant">) { return `${input.kind}:${input.refId}:${input.variant}`; }
function record(input: SaveMediaFileInput, state: MediaFileRecord["state"]): MediaFileRecord {
  return { id: 1, kind: input.kind, refId: input.refId, variant: input.variant, originUrl: input.originUrl, state,
    filePath: null, byteSize: null, sha256: null, errorMessage: null, attempts: 0, fetchedAt: null,
    updatedAt: new Date(), videoFallback: false, contentType: input.contentType, sourceFileName: input.sourceFileName };
}
