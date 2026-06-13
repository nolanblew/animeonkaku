import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaStore, MediaValidationError } from "../src/media/mediaStore.js";
import type {
  MediaFileRecord,
  MediaFileRepo,
  SaveMediaFileInput,
} from "../src/media/types.js";

class FakeMediaRepo implements MediaFileRepo {
  records = new Map<string, MediaFileRecord>();

  async markDownloading(input: SaveMediaFileInput): Promise<void> {
    this.records.set(`${input.kind}:${input.refId}`, {
      id: 1,
      kind: input.kind,
      refId: input.refId,
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
    this.records.set(`${input.kind}:${input.refId}`, {
      id: 1,
      kind: input.kind,
      refId: input.refId,
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
    const key = `${input.kind}:${input.refId}`;
    const existing = this.records.get(key);
    this.records.set(key, {
      id: existing?.id ?? 1,
      kind: input.kind,
      refId: input.refId,
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
    const store = new MediaStore({
      mediaRoot,
      repo,
      fetch: async () => response("abcdef", { "content-type": "audio/ogg", "content-length": "6" }),
      minBytes: 4,
    });

    const ready = await store.fetchToMediaFile({
      kind: "AUDIO",
      refId: "3040",
      originUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
      filePath: "audio/3040.ogg",
      videoFallback: false,
    });

    expect(ready.state).toBe("READY");
    expect(ready.byteSize).toBe(6);
    expect(ready.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(mediaRoot, "audio", "3040.ogg"), "utf8")).toBe("abcdef");
    expect(readdirSync(join(mediaRoot, "audio", "tmp"))).toEqual([]);
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
        originUrl: "https://a.animethemes.moe/Toradora-OP1.ogg",
        filePath: "audio/3040.ogg",
        videoFallback: false,
      }),
    ).rejects.toBeInstanceOf(MediaValidationError);

    expect(repo.records.get("AUDIO:3040")?.state).toBe("FAILED");
    expect(existsSync(join(mediaRoot, "audio", "3040.ogg"))).toBe(false);
  });
});

