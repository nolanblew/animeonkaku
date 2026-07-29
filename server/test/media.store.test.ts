import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaStore, MediaValidationError } from "../src/media/mediaStore.js";
import type {
  MediaFileRecord,
  MediaFileRepo,
  SaveMediaFileInput,
} from "../src/media/types.js";

class FakeMediaRepo implements MediaFileRepo {
  records = new Map<string, MediaFileRecord>();

  async find(descriptor: { kind: string; refId: string; variant: string }): Promise<MediaFileRecord | null> {
    return this.records.get(`${descriptor.kind}:${descriptor.refId}:${descriptor.variant}`) ?? null;
  }

  async markDownloading(input: SaveMediaFileInput): Promise<void> {
    this.records.set(`${input.kind}:${input.refId}:${input.variant}`, {
      id: 1,
      kind: input.kind,
      refId: input.refId,
      variant: input.variant,
      originUrl: input.originUrl,
      state: "DOWNLOADING",
      filePath: null,
      byteSize: null,
      sha256: null,
      errorMessage: null,
      attempts: 0,
      fetchedAt: null,
      updatedAt: new Date(),
      videoFallback: input.videoFallback,
    });
  }

  async markReady(input: SaveMediaFileInput & { filePath: string; byteSize: number; sha256: string }): Promise<void> {
    this.records.set(`${input.kind}:${input.refId}:${input.variant}`, {
      id: 1,
      kind: input.kind,
      refId: input.refId,
      variant: input.variant,
      originUrl: input.originUrl,
      state: "READY",
      filePath: input.filePath,
      byteSize: input.byteSize,
      sha256: input.sha256,
      errorMessage: null,
      attempts: 1,
      fetchedAt: new Date(),
      updatedAt: new Date(),
      videoFallback: input.videoFallback,
    });
  }

  async markFailed(input: SaveMediaFileInput & { errorMessage: string }): Promise<void> {
    const key = `${input.kind}:${input.refId}:${input.variant}`;
    const existing = this.records.get(key);
    this.records.set(key, {
      id: existing?.id ?? 1,
      kind: input.kind,
      refId: input.refId,
      variant: input.variant,
      originUrl: input.originUrl,
      state: "FAILED",
      filePath: null,
      byteSize: null,
      sha256: null,
      errorMessage: input.errorMessage,
      attempts: (existing?.attempts ?? 0) + 1,
      fetchedAt: null,
      updatedAt: new Date(),
      videoFallback: input.videoFallback,
    });
  }
}

function response(body: string, headers: Record<string, string>) {
  return new Response(body, { status: 200, headers });
}

let mediaRoot = "";

afterEach(() => {
  if (mediaRoot) rmSync(mediaRoot, { recursive: true, force: true });
});

describe("MediaStore", () => {
  it("streams to tmp, validates, hashes, atomically moves, and marks READY", async () => {
    mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-media-"));
    const repo = new FakeMediaRepo();
    const logs: Array<{ data: unknown; message: string }> = [];
    const store = new MediaStore({
      mediaRoot,
      repo,
      fetch: async () => response("abcdef", { "content-type": "audio/ogg", "content-length": "6" }),
      logger: {
        info: (data, message) => logs.push({ data, message }),
      },
      minBytes: 4,
    });

    const ready = await store.fetchToMediaFile({
      kind: "AUDIO",
      refId: "3040",
      variant: "SHORT",
      originUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
      filePath: "audio/3040.ogg",
      videoFallback: false,
    });

    expect(ready.state).toBe("READY");
    expect(ready.byteSize).toBe(6);
    expect(ready.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(mediaRoot, "audio", "3040.ogg"), "utf8")).toBe("abcdef");
    expect(readdirSync(join(mediaRoot, "audio", "tmp"))).toEqual([]);
    expect(logs.map((entry) => entry.message)).toEqual([
      "external media download request",
      "external media download response",
      "external media download saved",
    ]);
    expect(logs[0]?.data).toMatchObject({
      kind: "AUDIO",
      refId: "3040",
      variant: "SHORT",
      url: "https://a.animethemes.moe/Toradora-OP1.ogg",
      externalHit: true,
    });
    expect(logs[1]?.data).toMatchObject({
      kind: "AUDIO",
      refId: "3040",
      variant: "SHORT",
      url: "https://a.animethemes.moe/Toradora-OP1.ogg",
      status: 200,
    });
  });

  it("rejects HTML responses and never marks a partial file READY", async () => {
    mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-media-"));
    const repo = new FakeMediaRepo();
    const store = new MediaStore({
      mediaRoot,
      repo,
      fetch: async () => response("<html>maintenance</html>", { "content-type": "text/html" }),
      minBytes: 4,
    });

    await expect(
      store.fetchToMediaFile({
        kind: "AUDIO",
        refId: "3040",
        variant: "SHORT",
        originUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
        filePath: "audio/3040.ogg",
        videoFallback: false,
      }),
    ).rejects.toBeInstanceOf(MediaValidationError);

    expect(repo.records.get("AUDIO:3040:SHORT")?.state).toBe("FAILED");
    expect(existsSync(join(mediaRoot, "audio", "3040.ogg"))).toBe(false);
  });

  it("preserves a pre-existing final file when a later fetch attempt fails", async () => {
    mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-media-"));
    mkdirSync(join(mediaRoot, "audio"), { recursive: true });
    const finalPath = join(mediaRoot, "audio", "3040.ogg");
    writeFileSync(finalPath, "previous-ready-media");
    const repo = new FakeMediaRepo();
    const store = new MediaStore({
      mediaRoot,
      repo,
      fetch: async () => response("<html>maintenance</html>", { "content-type": "text/html" }),
      minBytes: 4,
    });

    await expect(store.fetchToMediaFile({
      kind: "AUDIO",
      refId: "3040",
      variant: "SHORT",
      originUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
      filePath: "audio/3040.ogg",
      videoFallback: false,
    })).rejects.toBeInstanceOf(MediaValidationError);

    expect(await readFile(finalPath, "utf8")).toBe("previous-ready-media");
  });

  it("uses a collision-safe temporary destination for each fetch attempt", async () => {
    mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-media-"));
    mkdirSync(join(mediaRoot, "audio", "tmp"), { recursive: true });
    const collisionPath = join(mediaRoot, "audio", "tmp", "AUDIO-3040-1.tmp");
    writeFileSync(collisionPath, "another attempt is using this file");
    const now = vi.spyOn(Date, "now").mockReturnValue(1);
    const store = new MediaStore({
      mediaRoot,
      repo: new FakeMediaRepo(),
      fetch: async () => response("<html>maintenance</html>", { "content-type": "text/html" }),
      minBytes: 4,
    });

    try {
      await expect(store.fetchToMediaFile({
        kind: "AUDIO",
        refId: "3040",
        variant: "SHORT",
        originUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
        filePath: "audio/3040.ogg",
        videoFallback: false,
      })).rejects.toBeInstanceOf(MediaValidationError);
    } finally {
      now.mockRestore();
    }

    expect(await readFile(collisionPath, "utf8")).toBe("another attempt is using this file");
  });

  it("never re-downloads media that is already READY with the file on disk", async () => {
    mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-media-"));
    const repo = new FakeMediaRepo();
    let originHits = 0;
    const store = new MediaStore({
      mediaRoot,
      repo,
      fetch: async () => {
        originHits++;
        return response("abcdef", { "content-type": "audio/ogg", "content-length": "6" });
      },
      minBytes: 4,
    });
    const input = {
      kind: "AUDIO" as const,
      refId: "3040",
      variant: "SHORT" as const,
      originUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
      filePath: "audio/3040.ogg",
      videoFallback: false,
    };

    const first = await store.fetchToMediaFile(input);
    const second = await store.fetchToMediaFile(input);

    expect(originHits).toBe(1);
    expect(first.state).toBe("READY");
    expect(second.state).toBe("READY");
    expect(second.filePath).toBe("audio/3040.ogg");
  });

  it("re-downloads when the repo says READY but the file is missing from disk", async () => {
    mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-media-"));
    const repo = new FakeMediaRepo();
    let originHits = 0;
    const store = new MediaStore({
      mediaRoot,
      repo,
      fetch: async () => {
        originHits++;
        return response("abcdef", { "content-type": "audio/ogg", "content-length": "6" });
      },
      minBytes: 4,
    });
    const input = {
      kind: "AUDIO" as const,
      refId: "3040",
      variant: "SHORT" as const,
      originUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
      filePath: "audio/3040.ogg",
      videoFallback: false,
    };

    await store.fetchToMediaFile(input);
    rmSync(join(mediaRoot, "audio", "3040.ogg"));
    const recovered = await store.fetchToMediaFile(input);

    expect(originHits).toBe(2);
    expect(recovered.state).toBe("READY");
    expect(existsSync(join(mediaRoot, "audio", "3040.ogg"))).toBe(true);
  });
});

