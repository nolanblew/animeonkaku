import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AmfDeliveryValidationError, AmfUnsupportedFormatDeliveryError, validateAmfDeliveryFile } from "../src/music/requests/deliveryImporter.js";
import { AmfDeliveryImportService, createAmfDeliveryImportHandlers, releaseTrackDisplayOrder, type AmfDeliveryRepository } from "../src/music/requests/deliveryService.js";
import type { MediaStore } from "../src/media/mediaStore.js";
import type { JobQueue } from "../src/jobs/jobQueue.js";
import { vi } from "vitest";

describe("AMF delivery staging validation", () => {
  it("orders release tracks by disc and track metadata instead of AMF delivery arrival", () => {
    expect(releaseTrackDisplayOrder(1, 17, 3)).toBe(17);
    expect(releaseTrackDisplayOrder(2, 1, 2)).toBe(10_001);
    expect(releaseTrackDisplayOrder(1, null, 3)).toBe(1_000_003);
  });

  it("accepts an exact supported original and rejects size/hash/traversal conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "ongaku-amf-library-"));
    const relativePath = "anime-ongaku-staging/request-a/batch-0/song.flac";
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(join(absolutePath, ".."), { recursive: true });
    const bytes = Buffer.alloc(2048, 7);
    await writeFile(absolutePath, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    await expect(validateAmfDeliveryFile(root, { relativePath, size: bytes.length, sha256 }))
      .resolves.toEqual({ path: absolutePath, byteSize: bytes.length, sha256 });
    await expect(validateAmfDeliveryFile(root, { relativePath, size: bytes.length + 1, sha256 }))
      .rejects.toThrow(/size/i);
    await expect(validateAmfDeliveryFile(root, { relativePath, size: bytes.length, sha256: "0".repeat(64) }))
      .rejects.toThrow(/hash/i);
    await expect(validateAmfDeliveryFile(root, { relativePath: "../song.flac", size: null, sha256: null }))
      .rejects.toThrow(/relative|outside/i);
    await expect(validateAmfDeliveryFile(root, { relativePath, size: null, sha256: null }, "different-batch"))
      .rejects.toThrow(/batch destination/i);
  });

  it("keeps unsupported formats and symlink escapes out of publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "ongaku-amf-library-"));
    const outside = await mkdtemp(join(tmpdir(), "ongaku-amf-outside-"));
    await writeFile(join(outside, "song.flac"), Buffer.alloc(2048, 1));
    await symlink(outside, join(root, "escape"), "junction");
    await expect(validateAmfDeliveryFile(root, { relativePath: "escape/song.flac", size: null, sha256: null }))
      .rejects.toThrow(/outside/i);
    await writeFile(join(root, "album.ape"), Buffer.alloc(2048, 1));
    await expect(validateAmfDeliveryFile(root, { relativePath: "album.ape", size: null, sha256: null }))
      .rejects.toThrow(/unsupported/i);
  });

  it("classifies an unsupported-format delivery distinctly from other validation failures, so it can be closed rather than left blocking", async () => {
    const root = await mkdtemp(join(tmpdir(), "ongaku-amf-library-"));
    await writeFile(join(root, "album.ape"), Buffer.alloc(2048, 1));

    const formatError = await validateAmfDeliveryFile(root, { relativePath: "album.ape", size: null, sha256: null })
      .catch((value) => value);
    expect(formatError).toBeInstanceOf(AmfUnsupportedFormatDeliveryError);
    expect(formatError).toBeInstanceOf(AmfDeliveryValidationError);
    expect((formatError as AmfUnsupportedFormatDeliveryError).extension).toBe(".ape");

    const pathError = await validateAmfDeliveryFile(root, { relativePath: "../song.flac", size: null, sha256: null })
      .catch((value) => value);
    expect(pathError).toBeInstanceOf(AmfDeliveryValidationError);
    expect(pathError).not.toBeInstanceOf(AmfUnsupportedFormatDeliveryError);
  });
});

describe("AMF delivery import orchestration", () => {
  it("holds the content lock across reservation, verified copy, and publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "ongaku-amf-library-"));
    const relativePath = "anime-ongaku-staging/request-a/batch-0/song.flac";
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(join(absolutePath, ".."), { recursive: true });
    const bytes = Buffer.alloc(2048, 4);
    await writeFile(absolutePath, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const events: string[] = [];
    const repo = fakeDeliveryRepo();
    vi.mocked(repo.loadBatch).mockResolvedValue({ id: "batch", animeId: 1,
      destination: "anime-ongaku-staging/request-a/batch-0", warningCount: 0,
      items: [{ id: "item", index: 0, kind: "OST", number: null, themeId: null, resultStatus: "delivered", importState: "PENDING",
        deliveries: [{ id: "delivery", fileIndex: 7, relativePath, byteSize: bytes.length, sha256, metadata: {}, importState: "PENDING" }] }] });
    vi.mocked(repo.withContentLock).mockImplementation(async (_sha, action) => { events.push("lock"); const value = await action(); events.push("unlock"); return value; });
    vi.mocked(repo.reserveCatalog).mockImplementation(async () => { events.push("reserve"); return { songId: 9, releaseId: 10 }; });
    vi.mocked(repo.publishDelivery).mockImplementation(async () => { events.push("publish"); });
    vi.mocked(repo.finishBatch).mockResolvedValue("COMPLETED");
    const mediaStore = { importLocalSongFile: vi.fn(async (input) => { events.push("copy"); expect(input).toMatchObject({ sourcePath: absolutePath, expectedByteSize: bytes.length, expectedSha256: sha256 }); return {}; }) } as unknown as MediaStore;
    await expect(new AmfDeliveryImportService({ repo, mediaStore, libraryRoot: root }).importBatch("batch")).resolves.toBe("COMPLETED");
    expect(events).toEqual(["lock", "reserve", "copy", "publish", "unlock"]);
  });

  it("moves an unconfigured mount to operator attention and reconciles only attention", async () => {
    const repo = fakeDeliveryRepo();
    vi.mocked(repo.loadBatch).mockResolvedValue({ id: "batch", animeId: 1, destination: "safe", warningCount: 0,
      items: [{ id: "item", index: 0, kind: "OST", number: null, themeId: null, resultStatus: "delivered", importState: "PENDING", deliveries: [] }] });
    vi.mocked(repo.finishBatch).mockResolvedValue("AWAITING_OPERATOR");
    const service = new AmfDeliveryImportService({ repo, mediaStore: {} as MediaStore });
    expect(await service.importBatch("batch")).toBe("AWAITING_OPERATOR");
    expect(repo.markAttention).toHaveBeenCalledWith(null, "item", expect.stringMatching(/not configured/i));
  });

  it("marks unresolved domain work on the final operational attempt", async () => {
    const service = { importBatch: vi.fn().mockRejectedValue(new Error("disk offline")), markOperationalExhausted: vi.fn() };
    const handlers = createAmfDeliveryImportHandlers(service as any, { enqueue: vi.fn() } as unknown as JobQueue);
    await expect(handlers.IMPORT_AMF_MUSIC_BATCH({ batchId: "batch" }, { attempts: 7, maxAttempts: 8 } as never)).rejects.toThrow("disk offline");
    expect(service.markOperationalExhausted).toHaveBeenCalledWith("batch", "disk offline");
  });
});

function fakeDeliveryRepo(): AmfDeliveryRepository {
  return { loadBatch: vi.fn(), reserveCatalog: vi.fn(), publishDelivery: vi.fn(), markAttention: vi.fn(), finishBatch: vi.fn(),
    listRecoverableBatchIds: vi.fn(), withContentLock: vi.fn(), markOperationalExhausted: vi.fn() } as unknown as AmfDeliveryRepository;
}
