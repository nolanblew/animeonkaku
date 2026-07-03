import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FetchLike } from "../http/types.js";
import type { AppLogger } from "../logging.js";
import { safeExternalUrl } from "../logging.js";
import type { MediaFileRecord, MediaFileRepo, SaveMediaFileInput } from "./types.js";

const DEFAULT_MIN_BYTES = 1024;

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

export interface MediaStoreOptions {
  mediaRoot: string;
  repo: MediaFileRepo;
  fetch?: FetchLike;
  /** Fetch used for image origins (Kitsu CDN etc.); falls back to `fetch`. */
  imageFetch?: FetchLike;
  logger?: AppLogger;
  minBytes?: number;
}

export class MediaStore {
  private readonly fetchImpl: FetchLike;
  private readonly imageFetchImpl: FetchLike;
  private readonly minBytes: number;

  constructor(private readonly options: MediaStoreOptions) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.imageFetchImpl = options.imageFetch ?? this.fetchImpl;
    this.minBytes = options.minBytes ?? DEFAULT_MIN_BYTES;
  }

  async fetchToMediaFile(input: SaveMediaFileInput): Promise<MediaFileRecord> {
    const cached = await this.findReadyCached(input);
    if (cached) return cached;

    const finalPath = join(this.options.mediaRoot, input.filePath);
    const tmpDir = join(this.options.mediaRoot, "audio", "tmp");
    const tmpPath = join(tmpDir, `${input.kind}-${input.refId}-${Date.now()}.tmp`);
    await mkdir(dirname(finalPath), { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    await this.options.repo.markDownloading(input);

    const logData = {
      kind: input.kind,
      refId: input.refId,
      variant: input.variant,
      url: safeExternalUrl(input.originUrl),
      externalHit: true,
    };

    try {
      this.options.logger?.info(logData, "external media download request");
      const fetchForKind =
        input.kind === "AUDIO" || input.kind === "VIDEO" ? this.fetchImpl : this.imageFetchImpl;
      const response = await fetchForKind(input.originUrl);
      this.options.logger?.info(
        {
          ...logData,
          status: response.status,
          contentType: response.headers.get("content-type"),
          contentLength: response.headers.get("content-length"),
        },
        "external media download response",
      );
      if (!response.ok) {
        throw new MediaValidationError(`Origin returned HTTP ${response.status}`);
      }
      validateContentType(input, response.headers.get("content-type"));
      if (!response.body) {
        throw new MediaValidationError("Origin response had no body");
      }

      const { byteSize, sha256 } = await writeAndHash(response.body, tmpPath);
      validateSize(byteSize, response.headers.get("content-length"), this.minBytes);
      await rename(tmpPath, finalPath);
      await this.options.repo.markReady({ ...input, byteSize, sha256 });
      const saved = await stat(finalPath);
      this.options.logger?.info(
        {
          ...logData,
          byteSize: saved.size,
          sha256,
          filePath: input.filePath,
        },
        "external media download saved",
      );
      return {
        id: 0,
        kind: input.kind,
        refId: input.refId,
        variant: input.variant,
        originUrl: input.originUrl,
        state: "READY",
        filePath: input.filePath,
        byteSize: saved.size,
        sha256,
        errorMessage: null,
        attempts: 1,
        fetchedAt: new Date(),
        updatedAt: new Date(),
        videoFallback: input.videoFallback,
      };
    } catch (error) {
      await rm(tmpPath, { force: true });
      await rm(finalPath, { force: true });
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.logger?.warn?.({ ...logData, error: err.message }, "external media download failed");
      await this.options.repo.markFailed({ ...input, errorMessage: err.message });
      throw err;
    }
  }

  /**
   * Each media file is downloaded from the origin at most once: if the repo says
   * READY and the file is still on disk, reuse it. A READY row whose file has
   * disappeared falls through to a normal re-fetch.
   */
  private async findReadyCached(input: SaveMediaFileInput): Promise<MediaFileRecord | null> {
    const existing = await this.options.repo.find?.({
      kind: input.kind,
      refId: input.refId,
      variant: input.variant,
    });
    if (!existing || existing.state !== "READY" || !existing.filePath) return null;
    const fileStat = await stat(join(this.options.mediaRoot, existing.filePath)).catch(() => null);
    if (!fileStat?.isFile()) return null;
    this.options.logger?.info(
      {
        kind: input.kind,
        refId: input.refId,
        variant: input.variant,
        filePath: existing.filePath,
        externalHit: false,
      },
      "media already cached, skipping download",
    );
    return existing;
  }
}

async function writeAndHash(
  body: ReadableStream<Uint8Array>,
  tmpPath: string,
): Promise<{ byteSize: number; sha256: string }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(body), counter, createWriteStream(tmpPath));
  return { byteSize, sha256: hash.digest("hex") };
}

function validateContentType(input: SaveMediaFileInput, contentType: string | null): void {
  const normalized = contentType?.toLowerCase() ?? "";
  if (input.kind === "AUDIO") {
    const valid =
      normalized.startsWith("audio/") ||
      normalized.includes("application/octet-stream") ||
      (input.videoFallback && normalized.startsWith("video/"));
    if (!valid) {
      throw new MediaValidationError(`Unexpected audio content type: ${contentType ?? "missing"}`);
    }
    return;
  }
  if (!normalized.startsWith("image/")) {
    throw new MediaValidationError(`Unexpected image content type: ${contentType ?? "missing"}`);
  }
}

function validateSize(byteSize: number, contentLength: string | null, minBytes: number): void {
  if (byteSize < minBytes) {
    throw new MediaValidationError(`Downloaded file too small: ${byteSize} bytes`);
  }
  if (contentLength) {
    const expected = Number(contentLength);
    if (Number.isFinite(expected) && expected !== byteSize) {
      throw new MediaValidationError(
        `Downloaded size ${byteSize} did not match Content-Length ${expected}`,
      );
    }
  }
}

