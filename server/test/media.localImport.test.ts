import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaStore, MediaValidationError } from "../src/media/mediaStore.js";
import type { MediaDescriptor, MediaFileRecord, MediaFileRepo, SaveMediaFileInput } from "../src/media/types.js";

class FakeMediaRepo implements MediaFileRepo {
  records = new Map<string, MediaFileRecord>();
  beforeMarkReady?: (input: SaveMediaFileInput) => void;

  async find(descriptor: MediaDescriptor): Promise<MediaFileRecord | null> {
    return this.records.get(key(descriptor)) ?? null;
  }

  async markDownloading(input: SaveMediaFileInput): Promise<void> {
    this.records.set(key(input), record(input, "DOWNLOADING"));
  }

  async markReady(input: SaveMediaFileInput & { byteSize: number; sha256: string }): Promise<void> {
    this.beforeMarkReady?.(input);
    this.records.set(key(input), {
      ...record(input, "READY"),
      filePath: input.filePath,
      byteSize: input.byteSize,
      sha256: input.sha256,
      contentType: input.contentType ?? null,
      sourceFileName: input.sourceFileName ?? null,
    });
  }

  async markFailed(input: SaveMediaFileInput & { errorMessage: string }): Promise<void> {
    this.records.set(key(input), { ...record(input, "FAILED"), errorMessage: input.errorMessage });
  }
}

function key(input: Pick<SaveMediaFileInput, "kind" | "refId" | "variant">): string {
  return `${input.kind}:${input.refId}:${input.variant}`;
}

function record(input: SaveMediaFileInput, state: MediaFileRecord["state"]): MediaFileRecord {
  return {
    id: 1,
    kind: input.kind,
    refId: input.refId,
    variant: input.variant,
    originUrl: input.originUrl,
    state,
    filePath: null,
    byteSize: null,
    sha256: null,
    errorMessage: null,
    attempts: 0,
    fetchedAt: null,
    updatedAt: new Date(),
    videoFallback: false,
    contentType: input.contentType ?? null,
    sourceFileName: input.sourceFileName ?? null,
  };
}

let testRoot = "";

afterEach(() => {
  if (testRoot) rmSync(testRoot, { recursive: true, force: true });
  testRoot = "";
});

describe("MediaStore local catalog-song import", () => {
  it.each([
    ["flac", "audio/flac"],
    ["mp3", "audio/mpeg"],
    ["m4a", "audio/mp4"],
    ["aac", "audio/aac"],
    ["ogg", "audio/ogg"],
    ["opus", "audio/opus"],
    ["wav", "audio/wav"],
  ])("copies .%s byte-for-byte and persists original metadata", async (extension, contentType) => {
    const { mediaRoot, providerRoot } = makeRoots();
    const sourceBytes = Buffer.from(`original-${extension}-bytes`);
    const sourcePath = join(providerRoot, `Track.${extension.toUpperCase()}`);
    writeFileSync(sourcePath, sourceBytes);
    const repo = new FakeMediaRepo();
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });

    const ready = await store.importLocalSongFile({ songId: 77, sourcePath });

    expect(ready).toMatchObject({
      kind: "AUDIO",
      refId: "song:77",
      variant: "ORIGINAL",
      state: "READY",
      filePath: `audio/songs/77/original.${extension}`,
      byteSize: sourceBytes.length,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      contentType,
      sourceFileName: basename(sourcePath),
    });
    expect(await readFile(join(mediaRoot, ready.filePath!), null)).toEqual(sourceBytes);
    expect(await readFile(sourcePath, null)).toEqual(sourceBytes);
  });

  it("is idempotent while the READY file and matching hash exist", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const sourcePath = join(providerRoot, "Track.mp3");
    writeFileSync(sourcePath, "first-bytes");
    const repo = new FakeMediaRepo();
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });

    const first = await store.importLocalSongFile({ songId: 77, sourcePath });
    writeFileSync(sourcePath, "changed-provider-bytes");
    const second = await store.importLocalSongFile({ songId: 77, sourcePath });

    expect(second.sha256).toBe(first.sha256);
    expect(await readFile(join(mediaRoot, first.filePath!), "utf8")).toBe("first-bytes");
  });

  it("imports again when a READY file is missing", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const sourcePath = join(providerRoot, "Track.flac");
    writeFileSync(sourcePath, "first-bytes");
    const repo = new FakeMediaRepo();
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });
    const first = await store.importLocalSongFile({ songId: 77, sourcePath });
    await rm(join(mediaRoot, first.filePath!));
    writeFileSync(sourcePath, "replacement-bytes");

    const recovered = await store.importLocalSongFile({ songId: 77, sourcePath });

    expect(await readFile(join(mediaRoot, recovered.filePath!), "utf8")).toBe("replacement-bytes");
    expect(recovered.sha256).not.toBe(first.sha256);
  });

  it("atomically replaces a READY file whose stored hash no longer matches", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const sourcePath = join(providerRoot, "Track.mp3");
    writeFileSync(sourcePath, "original-bytes");
    const repo = new FakeMediaRepo();
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });
    const first = await store.importLocalSongFile({ songId: 77, sourcePath });
    writeFileSync(join(mediaRoot, first.filePath!), "corrupt-cache");
    writeFileSync(sourcePath, "replacement-bytes");

    const recovered = await store.importLocalSongFile({ songId: 77, sourcePath });

    expect(await readFile(join(mediaRoot, recovered.filePath!), "utf8")).toBe("replacement-bytes");
    expect(recovered.sha256).toBe(createHash("sha256").update("replacement-bytes").digest("hex"));
  });

  it("reuses a verified READY original even when a later provider path has another extension", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const mp3Path = join(providerRoot, "Track.mp3");
    const flacPath = join(providerRoot, "Track.flac");
    writeFileSync(mp3Path, "mp3-bytes");
    writeFileSync(flacPath, "flac-bytes");
    const repo = new FakeMediaRepo();
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });
    const first = await store.importLocalSongFile({ songId: 77, sourcePath: mp3Path });
    repo.beforeMarkReady = () => { throw new Error("READY media must not be rewritten"); };

    const replacement = await store.importLocalSongFile({ songId: 77, sourcePath: flacPath });

    expect(first.filePath).toBe("audio/songs/77/original.mp3");
    expect(replacement.filePath).toBe("audio/songs/77/original.mp3");
    expect(existsSync(join(mediaRoot, first.filePath!))).toBe(true);
    expect(await readFile(join(mediaRoot, replacement.filePath!), "utf8")).toBe("mp3-bytes");
    expect(repo.records.get("AUDIO:song:77:ORIGINAL")?.filePath).toBe(replacement.filePath);
  });

  it("never removes an old row path outside MEDIA_ROOT during extension replacement", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const mp3Path = join(providerRoot, "Track.mp3");
    const flacPath = join(providerRoot, "Track.flac");
    writeFileSync(mp3Path, "mp3-bytes");
    writeFileSync(flacPath, "flac-bytes");
    const repo = new FakeMediaRepo();
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });
    await store.importLocalSongFile({ songId: 77, sourcePath: mp3Path });
    const outsidePath = join(testRoot, "outside.mp3");
    writeFileSync(outsidePath, "operator-file");
    repo.records.get("AUDIO:song:77:ORIGINAL")!.filePath = "../outside.mp3";

    await store.importLocalSongFile({ songId: 77, sourcePath: flacPath });

    expect(await readFile(outsidePath, "utf8")).toBe("operator-file");
  });

  it("rejects a catalog destination redirected outside MEDIA_ROOT by a junction", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const sourcePath = join(providerRoot, "Track.mp3");
    writeFileSync(sourcePath, "mp3-bytes");
    const escapedDirectory = join(testRoot, "escaped-destination");
    mkdirSync(escapedDirectory, { recursive: true });
    mkdirSync(join(mediaRoot, "audio", "songs"), { recursive: true });
    symlinkSync(escapedDirectory, join(mediaRoot, "audio", "songs", "77"), "junction");
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo: new FakeMediaRepo(), minBytes: 1 });

    await expect(store.importLocalSongFile({ songId: 77, sourcePath })).rejects.toThrow(/media root/i);
    expect(existsSync(join(escapedDirectory, "original.mp3"))).toBe(false);
  });

  it("rejects sources outside the configured provider root and unsupported extensions", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const outside = join(testRoot, "outside.mp3");
    const unsupported = join(providerRoot, "Track.exe");
    writeFileSync(outside, "bytes");
    writeFileSync(unsupported, "bytes");
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo: new FakeMediaRepo(), minBytes: 1 });

    await expect(store.importLocalSongFile({ songId: 77, sourcePath: outside })).rejects.toThrow(/provider root/i);
    await expect(store.importLocalSongFile({ songId: 77, sourcePath: unsupported })).rejects.toBeInstanceOf(MediaValidationError);
  });

  it("does not leave a partial destination when validation fails", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const sourcePath = join(providerRoot, "Empty.wav");
    writeFileSync(sourcePath, "");
    const repo = new FakeMediaRepo();
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });

    await expect(store.importLocalSongFile({ songId: 77, sourcePath })).rejects.toBeInstanceOf(MediaValidationError);
    await expect(readFile(join(mediaRoot, "audio/songs/77/original.wav"))).rejects.toThrow();
    expect(repo.records.get("AUDIO:song:77:ORIGINAL")?.state).toBe("FAILED");
  });

  it("adopts an atomically renamed orphan after DB READY publication crashes", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const sourcePath = join(providerRoot, "Track.flac");
    writeFileSync(sourcePath, "orphan-recovery-bytes");
    const repo = new FakeMediaRepo();
    let crashOnce = true;
    repo.beforeMarkReady = () => {
      if (crashOnce) {
        crashOnce = false;
        throw new Error("database disconnected after rename");
      }
    };
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });

    await expect(store.importLocalSongFile({ songId: 77, sourcePath })).rejects.toThrow("database disconnected");
    expect(await readFile(join(mediaRoot, "audio/songs/77/original.flac"), "utf8")).toBe("orphan-recovery-bytes");

    await expect(store.importLocalSongFile({ songId: 77, sourcePath })).resolves.toMatchObject({
      state: "READY", filePath: "audio/songs/77/original.flac",
    });
    expect(repo.records.get("AUDIO:song:77:ORIGINAL")?.state).toBe("READY");
  });

  it("does not adopt orphaned final bytes when the current provider source changed", async () => {
    const { mediaRoot, providerRoot } = makeRoots();
    const sourcePath = join(providerRoot, "Track.flac");
    writeFileSync(sourcePath, "old-provider-bytes");
    const repo = new FakeMediaRepo();
    let crashOnce = true;
    repo.beforeMarkReady = () => {
      if (crashOnce) {
        crashOnce = false;
        throw new Error("database disconnected after rename");
      }
    };
    const store = new MediaStore({ mediaRoot, providerImportRoot: providerRoot, repo, minBytes: 1 });
    await expect(store.importLocalSongFile({ songId: 77, sourcePath })).rejects.toThrow();
    writeFileSync(sourcePath, "new-provider-bytes-with-different-size");

    await store.importLocalSongFile({ songId: 77, sourcePath });

    expect(await readFile(join(mediaRoot, "audio/songs/77/original.flac"), "utf8")).toBe("new-provider-bytes-with-different-size");
  });
});

function makeRoots(): { mediaRoot: string; providerRoot: string } {
  testRoot = mkdtempSync(join(tmpdir(), "ongaku-local-import-"));
  const mediaRoot = join(testRoot, "media");
  const providerRoot = join(testRoot, "provider");
  mkdirSync(mediaRoot, { recursive: true });
  mkdirSync(providerRoot, { recursive: true });
  return { mediaRoot, providerRoot };
}
