import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FetchLike } from "../http/types.js";
import type { AppLogger } from "../logging.js";
import { safeExternalUrl } from "../logging.js";
import { catalogSongMediaFilePath, catalogSongRefId } from "./mediaLayout.js";
import { resolveManagedMediaPath } from "./mediaPathSafety.js";
import type {
  ImportLocalSongFileInput,
  MediaFileRecord,
  MediaFileRepo,
  SaveMediaFileInput,
} from "./types.js";

const DEFAULT_MIN_BYTES = 1024;

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

export interface MediaStoreOptions {
  mediaRoot: string;
  /** Read-only root mounted from the acquisition provider. Required for local imports. */
  providerImportRoot?: string;
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

  async importLocalSongFile(input: ImportLocalSongFileInput): Promise<MediaFileRecord> {
    const providerRoot = this.options.providerImportRoot;
    if (!providerRoot) {
      throw new MediaValidationError("A provider import root is not configured.");
    }

    const sourcePath = await safeProviderFile(providerRoot, input.sourcePath);
    const format = audioFormatForPath(sourcePath);
    const sourceFileName = basename(sourcePath);
    const filePath = catalogSongMediaFilePath(input.songId, format.extension);
    const mediaInput: SaveMediaFileInput = {
      kind: "AUDIO",
      refId: catalogSongRefId(input.songId),
      variant: "ORIGINAL",
      originUrl: `provider-import:${encodeURIComponent(sourceFileName)}`,
      filePath,
      videoFallback: false,
      contentType: format.contentType,
      sourceFileName,
    };

    const descriptor = { kind: mediaInput.kind, refId: mediaInput.refId, variant: mediaInput.variant };
    const previous = await this.options.repo.find?.(descriptor) ?? null;
    const cached = await this.findReadyImported(previous, input.songId);
    if (cached) return cached;

    const tmpRelativePath = `audio/tmp/song-${input.songId}-${randomUUID()}.tmp`;
    let finalPath: string;
    let tmpPath: string;
    try {
      finalPath = await resolveManagedMediaPath(this.options.mediaRoot, filePath);
      const tmpDir = await resolveManagedMediaPath(this.options.mediaRoot, "audio/tmp");
      await mkdir(dirname(finalPath), { recursive: true });
      await mkdir(tmpDir, { recursive: true });
      // Recheck after directory creation so a pre-existing junction cannot be
      // hidden by a missing ancestor during the first check.
      finalPath = await resolveManagedMediaPath(this.options.mediaRoot, filePath);
      tmpPath = await resolveManagedMediaPath(this.options.mediaRoot, tmpRelativePath);
    } catch (error) {
      throw new MediaValidationError(
        error instanceof Error ? error.message : "Invalid managed media path.",
      );
    }
    const recovered = await this.recoverOrphanedImported(mediaInput, previous, finalPath, sourcePath);
    if (recovered) return recovered;
    await this.options.repo.markDownloading(mediaInput);

    try {
      const { byteSize, sha256 } = await copyAndHash(sourcePath, tmpPath);
      validateSize(byteSize, null, this.minBytes);
      // The rename is the publication boundary: readers never observe the
      // partially copied temporary file.
      await rename(tmpPath, finalPath);
      await this.options.repo.markReady({ ...mediaInput, byteSize, sha256 });
      const saved = await stat(finalPath);
      await this.removePreviousSongFile(input.songId, previous, filePath);
      this.options.logger?.info(
        {
          kind: mediaInput.kind,
          refId: mediaInput.refId,
          variant: mediaInput.variant,
          sourceFileName,
          byteSize: saved.size,
          sha256,
          filePath,
          externalHit: false,
        },
        "local provider media imported",
      );
      return readyRecord(mediaInput, saved.size, sha256);
    } catch (error) {
      await rm(tmpPath, { force: true });
      const err = error instanceof Error ? error : new Error(String(error));
      await this.options.repo.markFailed({ ...mediaInput, errorMessage: err.message });
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

  private async findReadyImported(
    existing: MediaFileRecord | null,
    songId: number,
  ): Promise<MediaFileRecord | null> {
    if (
      !existing ||
      existing.state !== "READY" ||
      !existing.filePath ||
      !isManagedCatalogSongPath(songId, existing.filePath) ||
      !existing.sha256
    ) {
      return null;
    }
    const absolutePath = await resolveManagedMediaPath(this.options.mediaRoot, existing.filePath)
      .catch(() => null);
    if (!absolutePath) return null;
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat?.isFile()) return null;
    const currentHash = await hashFile(absolutePath);
    return currentHash === existing.sha256 ? existing : null;
  }

  private async removePreviousSongFile(
    songId: number,
    previous: MediaFileRecord | null,
    currentFilePath: string,
  ): Promise<void> {
    const previousPath = previous?.filePath;
    if (
      previous?.state !== "READY" ||
      !previousPath ||
      previousPath === currentFilePath ||
      !isManagedCatalogSongPath(songId, previousPath)
    ) {
      return;
    }
    try {
      const absolutePath = await resolveManagedMediaPath(this.options.mediaRoot, previousPath);
      await rm(absolutePath, { force: true });
    } catch (error) {
      this.options.logger?.warn?.(
        {
          refId: catalogSongRefId(songId),
          filePath: previousPath,
          error: error instanceof Error ? error.message : String(error),
        },
        "old catalog-song media cleanup skipped",
      );
    }
  }

  /**
   * A process/DB failure can happen after atomic rename but before markReady.
   * On Windows a later rename may not replace that orphan reliably, so adopt
   * the already-complete managed file before starting another copy.
   */
  private async recoverOrphanedImported(
    input: SaveMediaFileInput,
    previous: MediaFileRecord | null,
    finalPath: string,
    sourcePath: string,
  ): Promise<MediaFileRecord | null> {
    if (previous?.state === "READY") return null;
    const saved = await stat(finalPath).catch(() => null);
    if (!saved?.isFile() || saved.size < this.minBytes) return null;
    const source = await stat(sourcePath);
    const [sha256, sourceSha256] = await Promise.all([hashFile(finalPath), hashFile(sourcePath)]);
    if (saved.size !== source.size || sha256 !== sourceSha256) {
      await rm(finalPath, { force: true });
      return null;
    }
    await this.options.repo.markReady({ ...input, byteSize: saved.size, sha256 });
    return readyRecord(input, saved.size, sha256);
  }
}

const AUDIO_FORMATS = new Map<string, { extension: string; contentType: string }>([
  [".flac", { extension: "flac", contentType: "audio/flac" }],
  [".mp3", { extension: "mp3", contentType: "audio/mpeg" }],
  [".m4a", { extension: "m4a", contentType: "audio/mp4" }],
  [".aac", { extension: "aac", contentType: "audio/aac" }],
  [".ogg", { extension: "ogg", contentType: "audio/ogg" }],
  [".opus", { extension: "opus", contentType: "audio/opus" }],
  [".wav", { extension: "wav", contentType: "audio/wav" }],
]);

function isManagedCatalogSongPath(songId: number, filePath: string): boolean {
  const prefix = `audio/songs/${songId}/original.`;
  if (!filePath.startsWith(prefix)) return false;
  const extension = filePath.slice(prefix.length);
  return [...AUDIO_FORMATS.values()].some((format) => format.extension === extension);
}

function audioFormatForPath(sourcePath: string): { extension: string; contentType: string } {
  const format = AUDIO_FORMATS.get(extname(sourcePath).toLowerCase());
  if (!format) {
    throw new MediaValidationError(`Unsupported original audio extension: ${extname(sourcePath) || "missing"}`);
  }
  return format;
}

async function safeProviderFile(providerRoot: string, sourcePath: string): Promise<string> {
  const canonicalRoot = await realpath(resolve(providerRoot)).catch(() => null);
  if (!canonicalRoot) throw new MediaValidationError("The configured provider root is unavailable.");
  const requestedPath = isAbsolute(sourcePath) ? sourcePath : join(canonicalRoot, sourcePath);
  const canonicalSource = await realpath(resolve(requestedPath)).catch(() => null);
  if (!canonicalSource) throw new MediaValidationError("The provider source file is unavailable.");
  const relativeToRoot = relative(canonicalRoot, canonicalSource);
  if (relativeToRoot === ".." || relativeToRoot.startsWith(`..${sep}`) || isAbsolute(relativeToRoot)) {
    throw new MediaValidationError("The provider source path is outside the configured provider root.");
  }
  const sourceStat = await stat(canonicalSource);
  if (!sourceStat.isFile()) throw new MediaValidationError("The provider source path is not a file.");
  return canonicalSource;
}

function readyRecord(input: SaveMediaFileInput, byteSize: number, sha256: string): MediaFileRecord {
  const now = new Date();
  return {
    id: 0,
    kind: input.kind,
    refId: input.refId,
    variant: input.variant,
    originUrl: input.originUrl,
    state: "READY",
    filePath: input.filePath,
    byteSize,
    sha256,
    errorMessage: null,
    attempts: 1,
    fetchedAt: now,
    updatedAt: now,
    videoFallback: input.videoFallback,
    contentType: input.contentType ?? null,
    sourceFileName: input.sourceFileName ?? null,
  };
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

async function copyAndHash(sourcePath: string, tmpPath: string): Promise<{ byteSize: number; sha256: string }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(sourcePath), counter, createWriteStream(tmpPath, { flags: "wx" }));
  return { byteSize, sha256: hash.digest("hex") };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
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

