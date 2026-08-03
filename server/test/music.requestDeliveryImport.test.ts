import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AMF_UNSUPPORTED_FORMAT_ERROR_PREFIX,
  AmfDeliveryValidationError,
  AmfUnsupportedFormatDeliveryError,
  unsupportedFormatImportError,
  validateAmfDeliveryFile,
} from "../src/music/requests/deliveryImporter.js";
import {
  AMF_DELIVERY_CLASSIFICATION_KEY,
  AMF_DELIVERY_CLASSIFICATION_UNSUPPORTED_FORMAT,
  AMF_IMPORT_CHUNK_SIZE,
  AmfDeliveryImportService,
  createAmfDeliveryImportHandlers,
  releaseTrackDisplayOrder,
  type AmfBatchImportOutcome,
  type AmfDeliveryRepository,
  type DeliveryBatchRecord,
  type DeliveryItemRecord,
  type DeliveryRecord,
} from "../src/music/requests/deliveryService.js";
import { AMF_PROVIDER_JOB_FILE_INDEX_STRIDE } from "../src/music/requests/providerGraph.js";
import { MediaStore } from "../src/media/mediaStore.js";
import type { MediaDescriptor, MediaFileRecord, MediaFileRepo, SaveMediaFileInput } from "../src/media/types.js";
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
  it("imports only the canonical vocal file when a full-size item also contains an instrumental", async () => {
    const repo = fakeDeliveryRepo();
    vi.mocked(repo.loadBatch).mockResolvedValue({ id: "batch", animeId: 1448, destination: "safe", warningCount: 0,
      items: [{ id: "op1", index: 0, kind: "OP", number: 1, themeId: 8629, resultStatus: "delivered", importState: "PENDING",
        deliveries: [
          { id: "instrumental", fileIndex: 0, relativePath: "03 Song (Instrumental).flac", byteSize: 1, sha256: "a", metadata: { title: "Song (Instrumental)" }, importState: "PENDING" },
          { id: "vocal", fileIndex: 3, relativePath: "01 Song.flac", byteSize: 1, sha256: "b", metadata: { title: "Song", artist: "Yuiko Ohara" }, importState: "PENDING" },
        ] }] });
    vi.mocked(repo.finishBatch).mockResolvedValue("PROCESSING");

    const plan = await new AmfDeliveryImportService({ repo, mediaStore: {} as MediaStore, libraryRoot: "safe" }).planImport("batch");

    expect(plan?.chunks).toEqual([{ itemId: "op1", deliveryIds: ["vocal"] }]);
    expect(repo.ignoreFullSizeVariants).toHaveBeenCalledWith("op1", "vocal", ["instrumental"], expect.stringMatching(/instrumental/i));
  });

  it("requires operator review when multiple full-size files remain canonical", async () => {
    const repo = fakeDeliveryRepo();
    vi.mocked(repo.loadBatch).mockResolvedValue({ id: "batch", animeId: 1448, destination: "safe", warningCount: 0,
      items: [{ id: "op1", index: 0, kind: "OP", number: 1, themeId: 8629, resultStatus: "delivered", importState: "PENDING",
        deliveries: [
          { id: "first", fileIndex: 0, relativePath: "01 Song.flac", byteSize: 1, sha256: "a", metadata: {}, importState: "PENDING" },
          { id: "second", fileIndex: 1, relativePath: "02 Song.flac", byteSize: 1, sha256: "b", metadata: {}, importState: "PENDING" },
        ] }] });
    vi.mocked(repo.finishBatch).mockResolvedValue("AWAITING_OPERATOR");

    const plan = await new AmfDeliveryImportService({ repo, mediaStore: {} as MediaStore, libraryRoot: "safe" }).planImport("batch");

    expect(plan?.chunks).toEqual([]);
    expect(repo.markAttention).toHaveBeenCalledWith(null, "op1", expect.stringMatching(/ambiguous/i));
    expect(repo.ignoreFullSizeVariants).not.toHaveBeenCalled();
  });

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

  it("marks the whole batch exhausted on the final attempt of planning", async () => {
    const service = { planImport: vi.fn().mockRejectedValue(new Error("disk offline")), markOperationalExhausted: vi.fn() };
    const handlers = createAmfDeliveryImportHandlers(service as any, { enqueue: vi.fn() } as unknown as JobQueue);
    await expect(handlers.IMPORT_AMF_MUSIC_BATCH({ batchId: "batch" }, { attempts: 7, maxAttempts: 8 } as never)).rejects.toThrow("disk offline");
    expect(service.markOperationalExhausted).toHaveBeenCalledWith("batch", "disk offline");
  });

  it("marks only its own item exhausted on the final attempt of an IMPORT_AMF_MUSIC_ITEM job", async () => {
    const service = { importItemChunk: vi.fn().mockRejectedValue(new Error("disk offline")), markItemOperationalExhausted: vi.fn() };
    const handlers = createAmfDeliveryImportHandlers(service as any, { enqueue: vi.fn() } as unknown as JobQueue);
    await expect(handlers.IMPORT_AMF_MUSIC_ITEM({ batchId: "batch", itemId: "item", deliveryIds: ["item:1", "item:2"] },
      { attempts: 7, maxAttempts: 8 } as never)).rejects.toThrow("disk offline");
    expect(service.markItemOperationalExhausted).toHaveBeenCalledWith("batch", "item", ["item:1", "item:2"], "disk offline");
  });

  it("enqueues one IMPORT_AMF_MUSIC_ITEM job per planned chunk instead of importing inline", async () => {
    const service = {
      planImport: vi.fn().mockResolvedValue({ chunks: [
        { itemId: "item-a", deliveryIds: ["item-a:0", "item-a:1"] },
        { itemId: "item-b", deliveryIds: ["item-b:0"] },
      ] }),
    };
    const queue = { enqueue: vi.fn() } as unknown as JobQueue;
    const handlers = createAmfDeliveryImportHandlers(service as any, queue);
    await handlers.IMPORT_AMF_MUSIC_BATCH({ batchId: "batch" }, { attempts: 0, maxAttempts: 8 } as never);
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "IMPORT_AMF_MUSIC_ITEM",
      payload: { batchId: "batch", itemId: "item-a", deliveryIds: ["item-a:0", "item-a:1"] },
      dedupeKey: "IMPORT_AMF_MUSIC_ITEM:batch:item-a:item-a:0" }));
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "IMPORT_AMF_MUSIC_ITEM",
      payload: { batchId: "batch", itemId: "item-b", deliveryIds: ["item-b:0"] },
      dedupeKey: "IMPORT_AMF_MUSIC_ITEM:batch:item-b:item-b:0" }));
  });
});

describe("AMF delivery import job splitting (F7)", () => {
  it("splits a many-file item (modeling the live 71-file OST delivery) into multiple chunk jobs and completes the batch exactly once", async () => {
    const fileCount = 71;
    const { root, files } = await stageFiles("request-a", fileCount);
    const fake = createFakeDeliveryRepo({
      batchId: "batch", destination: "anime-ongaku-staging/request-a/batch-0",
      items: [{ id: "ost", index: 0, kind: "OST", deliveries: files }],
    });
    const { mediaStore, importCalls } = await realMediaStore(root);
    const service = new AmfDeliveryImportService({ repo: fake.repo, mediaStore, libraryRoot: root });

    const plan = await service.planImport("batch");
    expect(plan?.chunks.length).toBe(Math.ceil(fileCount / AMF_IMPORT_CHUNK_SIZE));
    const allChunkedIds = plan!.chunks.flatMap((chunk) => chunk.deliveryIds);
    expect(new Set(allChunkedIds).size).toBe(fileCount);
    expect(plan!.chunks.every((chunk) => chunk.itemId === "ost")).toBe(true);

    const outcomes: (AmfBatchImportOutcome | null)[] = [];
    for (const chunk of plan!.chunks) {
      outcomes.push(await service.importItemChunk("batch", chunk.itemId, chunk.deliveryIds));
    }

    expect(outcomes.slice(0, -1).every((outcome) => outcome === "PROCESSING")).toBe(true);
    expect(outcomes.at(-1)).toBe("COMPLETED");
    expect(importCalls.count).toBe(fileCount);
    expect(fake.state.state).toBe("COMPLETED");
    expect(fake.state.completedAt).not.toBeNull();
    const finalBatch = await fake.repo.loadBatch("batch");
    expect(finalBatch!.items[0]!.importState).toBe("READY");
    expect(finalBatch!.items[0]!.deliveries.every((delivery) => delivery.importState === "READY")).toBe(true);
  }, 15_000);

  it("is restart-safe: re-running a chunk job skips already-READY deliveries and does not duplicate media or catalog rows", async () => {
    const { root, files } = await stageFiles("request-b", 5);
    const fake = createFakeDeliveryRepo({
      batchId: "batch", destination: "anime-ongaku-staging/request-b/batch-0",
      items: [{ id: "ost", index: 0, kind: "OST", deliveries: files }],
    });
    const { mediaStore, importCalls } = await realMediaStore(root);
    const service = new AmfDeliveryImportService({ repo: fake.repo, mediaStore, libraryRoot: root });

    const plan = await service.planImport("batch");
    expect(plan?.chunks.length).toBe(1);
    const chunk = plan!.chunks[0]!;
    const first = await service.importItemChunk("batch", chunk.itemId, chunk.deliveryIds);
    expect(first).toBe("COMPLETED");
    expect(importCalls.count).toBe(5);
    expect(fake.calls.reserveCatalog).toBe(5);

    // Simulate the same job (or a duplicate crash-recovery re-enqueue) running again.
    const second = await service.importItemChunk("batch", chunk.itemId, chunk.deliveryIds);
    expect(second).toBe("COMPLETED");
    expect(importCalls.count).toBe(5);
    expect(fake.calls.reserveCatalog).toBe(5);
  });

  it("does not let one invalid delivery block its item's other deliveries, and still rejects bytes that do not match the manifest", async () => {
    const { root, files } = await stageFiles("request-c", 3);
    files[1]!.sha256 = "0".repeat(64); // corrupt the manifest hash for the middle file
    const fake = createFakeDeliveryRepo({
      batchId: "batch", destination: "anime-ongaku-staging/request-c/batch-0",
      items: [{ id: "ost", index: 0, kind: "OST", deliveries: files }],
    });
    const { mediaStore, importCalls } = await realMediaStore(root);
    const service = new AmfDeliveryImportService({ repo: fake.repo, mediaStore, libraryRoot: root });

    const plan = await service.planImport("batch");
    const chunk = plan!.chunks[0]!;
    const outcome = await service.importItemChunk("batch", chunk.itemId, chunk.deliveryIds);

    expect(importCalls.count).toBe(2);
    expect(outcome).toBe("AWAITING_OPERATOR");
    const batch = await fake.repo.loadBatch("batch");
    const deliveries = batch!.items[0]!.deliveries;
    expect(deliveries.find((delivery) => delivery.id === files[0]!.id)!.importState).toBe("READY");
    expect(deliveries.find((delivery) => delivery.id === files[2]!.id)!.importState).toBe("READY");
    const badDelivery = deliveries.find((delivery) => delivery.id === files[1]!.id)!;
    expect(badDelivery.importState).toBe("ATTENTION");
    expect(fake.importErrorFor(files[1]!.id)).toMatch(/hash/i);
  });

  it("imports a follow-up job's delivery through the shared parent destination and keeps containment (MC-S13)", async () => {
    // A child job writes into the *parent's* destination (34/34 live) but into
    // its own file_index window, so its delivery must still pass the batch
    // destination containment check and import like any other.
    const destination = "anime-ongaku-staging/request-child/batch-0";
    const root = await mkdtemp(join(tmpdir(), "ongaku-amf-library-"));
    const relativePath = `${destination}/ed3.flac`;
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(join(absolutePath, ".."), { recursive: true });
    const bytes = Buffer.from("delegated-ed3-payload");
    await writeFile(absolutePath, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const childFileIndex = AMF_PROVIDER_JOB_FILE_INDEX_STRIDE;

    // Containment is asserted directly against the batch destination, not assumed.
    await expect(validateAmfDeliveryFile(root, { relativePath, size: bytes.length, sha256 }, destination))
      .resolves.toEqual({ path: absolutePath, byteSize: bytes.length, sha256 });

    const fake = createFakeDeliveryRepo({
      batchId: "batch", destination,
      items: [{ id: "ed3", index: 4, kind: "ED", deliveries: [
        { id: `ed3:${childFileIndex}`, fileIndex: childFileIndex, relativePath, byteSize: bytes.length, sha256 },
      ] }],
    });
    const { mediaStore, importCalls } = await realMediaStore(root);
    const service = new AmfDeliveryImportService({ repo: fake.repo, mediaStore, libraryRoot: root });

    const plan = await service.planImport("batch");
    expect(plan?.chunks).toEqual([{ itemId: "ed3", deliveryIds: [`ed3:${childFileIndex}`] }]);
    const outcome = await service.importItemChunk("batch", "ed3", [`ed3:${childFileIndex}`]);

    expect(outcome).toBe("COMPLETED");
    expect(importCalls.count).toBe(1);
    const batch = await fake.repo.loadBatch("batch");
    expect(batch!.items[0]!.deliveries[0]!.importState).toBe("READY");
    // A child's offset never collapses into a sibling's track ordering.
    expect(releaseTrackDisplayOrder(1, null, childFileIndex)).toBe(1_000_000 + childFileIndex);
  });

  it("classifies an unsupported-format delivery distinctly, does not strand the batch, and re-affirms on retry without touching the filesystem", async () => {
    const root = await mkdtemp(join(tmpdir(), "ongaku-amf-library-"));
    const relativePath = "anime-ongaku-staging/request-d/batch-0/album.ape";
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, Buffer.alloc(2048, 3));
    const fake = createFakeDeliveryRepo({
      batchId: "batch", destination: "anime-ongaku-staging/request-d/batch-0",
      items: [{ id: "ost", index: 0, kind: "OST", deliveries: [{ id: "ost:0", fileIndex: 0, relativePath, byteSize: null, sha256: null }] }],
    });
    const { mediaStore, importCalls } = await realMediaStore(root);
    const service = new AmfDeliveryImportService({ repo: fake.repo, mediaStore, libraryRoot: root });

    const plan = await service.planImport("batch");
    const chunk = plan!.chunks[0]!;
    const outcome = await service.importItemChunk("batch", chunk.itemId, chunk.deliveryIds);

    expect(outcome).toBe("COMPLETED_WITH_WARNINGS");
    expect(fake.state.completedAt).not.toBeNull();
    const batch = await fake.repo.loadBatch("batch");
    const delivery = batch!.items[0]!.deliveries[0]!;
    expect(delivery.importState).toBe("ATTENTION");
    expect(delivery.metadata[AMF_DELIVERY_CLASSIFICATION_KEY]).toBe(AMF_DELIVERY_CLASSIFICATION_UNSUPPORTED_FORMAT);
    expect(fake.importErrorFor("ost:0")).toMatch(new RegExp(AMF_UNSUPPORTED_FORMAT_ERROR_PREFIX));
    expect(fake.importErrorFor("ost:0")).toBe(unsupportedFormatImportError(".ape"));
    expect(importCalls.count).toBe(0);

    // The file is gone (e.g. staging cleanup, or AMF removed it) — a retried
    // job must not need to read it again to re-affirm the classification.
    await rm(absolutePath);
    const retry = await service.importItemChunk("batch", chunk.itemId, chunk.deliveryIds);
    expect(retry).toBe("COMPLETED_WITH_WARNINGS");
    expect(importCalls.count).toBe(0);
  });
});

function fakeDeliveryRepo(): AmfDeliveryRepository {
  return { loadBatch: vi.fn(), reserveCatalog: vi.fn(), publishDelivery: vi.fn(), markAttention: vi.fn(), ignoreFullSizeVariants: vi.fn(),
    markUnsupportedFormat: vi.fn(), finishBatch: vi.fn(), listRecoverableBatchIds: vi.fn(), withContentLock: vi.fn(),
    markOperationalExhausted: vi.fn(), markItemOperationalExhausted: vi.fn() } as unknown as AmfDeliveryRepository;
}

/** Stages `count` small, distinct-content flac files under a request/batch
 * destination and returns delivery seeds with their real size/hash, so tests
 * exercise the real `validateAmfDeliveryFile` + `MediaStore` copy/verify path
 * rather than a mocked one. */
async function stageFiles(requestSlug: string, count: number): Promise<{
  root: string;
  files: Array<{ id: string; fileIndex: number; relativePath: string; byteSize: number; sha256: string }>;
}> {
  const root = await mkdtemp(join(tmpdir(), "ongaku-amf-library-"));
  const destination = `anime-ongaku-staging/${requestSlug}/batch-0`;
  const files: Array<{ id: string; fileIndex: number; relativePath: string; byteSize: number; sha256: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const relativePath = `${destination}/track-${index}.flac`;
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(join(absolutePath, ".."), { recursive: true });
    const bytes = Buffer.from(`ost-track-${index}-${"x".repeat(64)}`);
    await writeFile(absolutePath, bytes);
    files.push({ id: `ost:${index}`, fileIndex: index, relativePath, byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return { root, files };
}

class FakeCatalogMediaRepo implements MediaFileRepo {
  records = new Map<string, MediaFileRecord>();
  async find(descriptor: MediaDescriptor): Promise<MediaFileRecord | null> {
    return this.records.get(`${descriptor.kind}:${descriptor.refId}:${descriptor.variant}`) ?? null;
  }
  async markDownloading(input: SaveMediaFileInput): Promise<void> {
    this.records.set(`${input.kind}:${input.refId}:${input.variant}`, { ...blankRecord(input), state: "DOWNLOADING" });
  }
  async markReady(input: SaveMediaFileInput & { byteSize: number; sha256: string }): Promise<void> {
    this.records.set(`${input.kind}:${input.refId}:${input.variant}`, { ...blankRecord(input), state: "READY",
      filePath: input.filePath, byteSize: input.byteSize, sha256: input.sha256 });
  }
  async markFailed(input: SaveMediaFileInput & { errorMessage: string }): Promise<void> {
    this.records.set(`${input.kind}:${input.refId}:${input.variant}`, { ...blankRecord(input), state: "FAILED", errorMessage: input.errorMessage });
  }
}

function blankRecord(input: SaveMediaFileInput): MediaFileRecord {
  return { id: 1, kind: input.kind, refId: input.refId, variant: input.variant, originUrl: input.originUrl, state: "DOWNLOADING",
    filePath: null, byteSize: null, sha256: null, errorMessage: null, attempts: 0, fetchedAt: null, updatedAt: new Date(),
    videoFallback: false, contentType: input.contentType ?? null, sourceFileName: input.sourceFileName ?? null };
}

/** A real `MediaStore` backed by a real temp media root, so the "second read"
 * (copy + independent hash verification) genuinely happens — this proves the
 * chunking/orchestration changes did not weaken that verification. */
async function realMediaStore(providerRoot: string): Promise<{ mediaStore: MediaStore; importCalls: { count: number } }> {
  const importCalls = { count: 0 };
  const mediaRoot = await mkdtemp(join(tmpdir(), "ongaku-amf-media-"));
  const inner = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo: new FakeCatalogMediaRepo(), minBytes: 1 });
  const mediaStore = { importLocalSongFile: (input: Parameters<MediaStore["importLocalSongFile"]>[0]) => {
    importCalls.count += 1;
    return inner.importLocalSongFile(input);
  } } as unknown as MediaStore;
  return { mediaStore, importCalls };
}

interface FakeDeliverySeed { id: string; fileIndex: number; relativePath: string; byteSize: number | null; sha256: string | null }
interface FakeItemSeed { id: string; index: number; kind: string; deliveries: FakeDeliverySeed[] }

/**
 * A minimal, in-memory stand-in for `PgAmfDeliveryRepository` that mirrors
 * its real state-machine semantics (delivery/item settle states, the
 * `finishBatch` attention/unsupported-format/pending bucketing, and the
 * unsupported-format item-level "don't downgrade" guard) closely enough to
 * unit-test the job-splitting orchestration without a real PostgreSQL
 * instance. The authoritative SQL-level coverage lives in
 * `db.amfDeliveryPublication.integration.test.ts`.
 */
function createFakeDeliveryRepo(seed: { batchId: string; destination: string; warningCount?: number; items: FakeItemSeed[] }) {
  interface DeliveryState extends FakeDeliverySeed { metadata: Record<string, unknown>; importState: DeliveryRecord["importState"]; importError: string | null }
  interface ItemState { id: string; index: number; kind: string; resultStatus: string | null; importState: DeliveryItemRecord["importState"]; importError: string | null; deliveries: Map<string, DeliveryState> }

  const items = new Map<string, ItemState>(seed.items.map((item) => [item.id, {
    id: item.id, index: item.index, kind: item.kind, resultStatus: "delivered", importState: "PENDING", importError: null,
    deliveries: new Map(item.deliveries.map((delivery) => [delivery.id, { ...delivery, metadata: {}, importState: "PENDING", importError: null }])),
  }]));
  const state = { state: "PROCESSING" as AmfBatchImportOutcome, completedAt: null as Date | null, warningCount: seed.warningCount ?? 0 };
  const contentIndex = new Map<string, { songId: number; releaseId: number }>();
  let nextId = 1;
  const calls = { reserveCatalog: 0, publishDelivery: 0, finishBatch: 0 };

  function findDelivery(deliveryId: string): { item: ItemState; delivery: DeliveryState } | null {
    for (const item of items.values()) {
      const delivery = item.deliveries.get(deliveryId);
      if (delivery) return { item, delivery };
    }
    return null;
  }

  const repo: AmfDeliveryRepository = {
    async loadBatch(batchId): Promise<DeliveryBatchRecord | null> {
      if (batchId !== seed.batchId) return null;
      return {
        id: seed.batchId, animeId: 1, destination: seed.destination, warningCount: state.warningCount,
        items: [...items.values()].map((item) => ({
          id: item.id, index: item.index, kind: item.kind, number: null, themeId: null,
          resultStatus: item.resultStatus, importState: item.importState,
          deliveries: [...item.deliveries.values()].map((delivery) => ({
            id: delivery.id, fileIndex: delivery.fileIndex, relativePath: delivery.relativePath,
            byteSize: delivery.byteSize, sha256: delivery.sha256, metadata: delivery.metadata, importState: delivery.importState,
          })),
        })),
      };
    },
    async reserveCatalog(deliveryId, verified) {
      calls.reserveCatalog += 1;
      const found = findDelivery(deliveryId);
      if (!found) throw new Error(`unknown delivery ${deliveryId}`);
      let reservation = contentIndex.get(verified.sha256);
      if (!reservation) {
        reservation = { songId: nextId++, releaseId: nextId++ };
        contentIndex.set(verified.sha256, reservation);
      }
      found.delivery.importState = "IMPORTING";
      if (found.item.importState === "PENDING") found.item.importState = "IMPORTING";
      return reservation;
    },
    async publishDelivery(deliveryId) {
      calls.publishDelivery += 1;
      const found = findDelivery(deliveryId);
      if (!found) throw new Error(`unknown delivery ${deliveryId}`);
      found.delivery.importState = "READY";
      found.delivery.importError = null;
      const allReady = [...found.item.deliveries.values()].every((delivery) => delivery.importState === "READY");
      if (allReady) found.item.importState = "READY";
    },
    async markAttention(deliveryId, itemId, error) {
      if (deliveryId) {
        const found = findDelivery(deliveryId);
        if (found && found.delivery.importState !== "READY") { found.delivery.importState = "ATTENTION"; found.delivery.importError = error; }
      }
      const item = items.get(itemId);
      if (item && item.importState !== "READY") { item.importState = "ATTENTION"; item.importError = error; }
    },
    async ignoreFullSizeVariants(_itemId, _selectedDeliveryId, _ignoredDeliveryIds, _reason) {},
    async markUnsupportedFormat(deliveryId, itemId, extension) {
      const message = unsupportedFormatImportError(extension);
      const found = findDelivery(deliveryId);
      if (found && found.delivery.importState !== "READY") {
        found.delivery.importState = "ATTENTION";
        found.delivery.importError = message;
        found.delivery.metadata = { ...found.delivery.metadata,
          [AMF_DELIVERY_CLASSIFICATION_KEY]: AMF_DELIVERY_CLASSIFICATION_UNSUPPORTED_FORMAT, amfUnsupportedExtension: extension };
      }
      const item = items.get(itemId);
      if (item && item.importState !== "READY"
        && (item.importState !== "ATTENTION" || (item.importError ?? "").startsWith(AMF_UNSUPPORTED_FORMAT_ERROR_PREFIX))) {
        item.importState = "ATTENTION";
        item.importError = message;
      }
    },
    async finishBatch(batchId) {
      calls.finishBatch += 1;
      if (batchId !== seed.batchId) return "PROCESSING";
      const values = [...items.values()];
      const pending = values.filter((item) => item.importState !== "READY" && item.importState !== "ATTENTION").length;
      if (pending > 0) return "PROCESSING";
      const attention = values.filter((item) => item.importState === "ATTENTION"
        && !(item.importError ?? "").startsWith(AMF_UNSUPPORTED_FORMAT_ERROR_PREFIX)).length;
      const unsupportedFormat = values.filter((item) => item.importState === "ATTENTION"
        && (item.importError ?? "").startsWith(AMF_UNSUPPORTED_FORMAT_ERROR_PREFIX)).length;
      const outcome: AmfBatchImportOutcome = attention > 0 ? "AWAITING_OPERATOR"
        : (state.warningCount > 0 || unsupportedFormat > 0) ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
      state.state = outcome;
      state.completedAt = outcome === "AWAITING_OPERATOR" ? null : new Date();
      return outcome;
    },
    async listRecoverableBatchIds() { return []; },
    async withContentLock(_sha256, action) { return action(); },
    async markOperationalExhausted(batchId, error) {
      for (const item of items.values()) {
        if (item.importState === "READY") continue;
        item.importState = "ATTENTION"; item.importError = error.slice(0, 500);
        for (const delivery of item.deliveries.values()) {
          if (delivery.importState !== "READY") { delivery.importState = "ATTENTION"; delivery.importError = error.slice(0, 500); }
        }
      }
      await repo.finishBatch(batchId, new Date());
    },
    async markItemOperationalExhausted(itemId, deliveryIds, error) {
      const item = items.get(itemId);
      if (!item) return;
      const wanted = new Set(deliveryIds);
      for (const delivery of item.deliveries.values()) {
        if (wanted.has(delivery.id) && delivery.importState !== "READY") {
          delivery.importState = "ATTENTION"; delivery.importError = error.slice(0, 500);
        }
      }
      if (item.importState !== "READY") { item.importState = "ATTENTION"; item.importError = error.slice(0, 500); }
    },
  };

  return {
    repo, state, calls,
    importErrorFor(deliveryId: string): string | null { return findDelivery(deliveryId)?.delivery.importError ?? null; },
  };
}
