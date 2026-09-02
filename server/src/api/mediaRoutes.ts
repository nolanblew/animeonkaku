import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import type { FetchLike } from "../http/types.js";
import { JobPriority, type JobQueue } from "../jobs/index.js";
import type { AppLogger } from "../logging.js";
import { safeExternalUrl } from "../logging.js";
import { MediaPathEscapeError, resolveManagedMediaPath } from "../media/mediaPathSafety.js";
import { FfmpegSonosTranscoder, type SonosTranscoder, withSonosTranscodeLimit } from "../media/sonosTranscoder.js";
import type { MediaState } from "../media/types.js";
import type { AudioState } from "./clientRoutes.js";
import { ApiError } from "./errors.js";
import { makeRequireAuth } from "./requireAuth.js";

export type ImageRouteKind = "ANIME_POSTER" | "ANIME_COVER" | "ARTIST_IMAGE";

export interface MediaAudioRecord {
  themeId: number;
  originUrl: string;
  state: MediaState;
  filePath: string | null;
  byteSize: number | null;
  sha256: string | null;
  /** True when the stored file is a webm video track served as audio (doc 08 #11). */
  videoFallback?: boolean;
  loudnessState?: string | null;
  loudnessSha256?: string | null;
}

export interface MediaSongAudioRecord {
  songId: number;
  state: MediaState;
  filePath: string | null;
  byteSize: number | null;
  sha256: string | null;
  contentType: string | null;
  sourceFileName: string | null;
  loudnessState?: string | null;
  loudnessSha256?: string | null;
}

export interface MediaImageRecord {
  originUrl: string;
  state: MediaState;
  filePath: string | null;
  sha256: string | null;
}

export interface MediaApiRepository {
  findAudio(themeId: number): Promise<MediaAudioRecord | null>;
  findSongAudio(songId: number): Promise<MediaSongAudioRecord | null>;
  findImage(kind: ImageRouteKind, refId: string): Promise<MediaImageRecord | null>;
}

export interface MediaStreamingServiceDeps {
  /** Produces Sonos-compatible MP3 derivatives; injectable for tests. */
  sonosTranscoder?: SonosTranscoder;
  repo: MediaApiRepository;
  queue: JobQueue;
  mediaRoot: string;
  /** Listener-facing catalog audio remains hidden while the catalog rollout flag is off. */
  musicCatalogEnabled?: boolean;
  /** When enabled, an uncached AnimeThemes file is never raw-proxied: cache
   * analysis must establish its playback descriptor first. */
  loudnessPlaybackGainEnabled?: boolean;
  fetch?: FetchLike;
  /** Fetch used for image origins (Kitsu CDN etc.); falls back to `fetch`. */
  imageFetch?: FetchLike;
  logger?: AppLogger;
  /** Notified on every cache miss so background hydration can yield to on-demand traffic. */
  activity?: { markMiss(): void };
}

interface ByteRange {
  start: number;
  end: number;
}

interface ReadyMediaFile {
  absolutePath: string;
  size: number;
}

export class MediaStreamingService {
  private readonly mediaRoot: string;
  private readonly fetchImpl: FetchLike;
  private readonly imageFetchImpl: FetchLike;
  private readonly sonosTranscoder: SonosTranscoder;
  private readonly sonosTranscodes = new Map<string, Promise<ReadyMediaFile>>();

  constructor(private readonly deps: MediaStreamingServiceDeps) {
    this.mediaRoot = resolve(deps.mediaRoot);
    this.fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init));
    this.imageFetchImpl = deps.imageFetch ?? this.fetchImpl;
    this.sonosTranscoder = deps.sonosTranscoder ?? new FfmpegSonosTranscoder();
  }

  async sendAudio(
    themeId: number,
    method: "GET" | "HEAD",
    rangeHeader: string | undefined,
    reply: FastifyReply,
    log?: FastifyBaseLogger,
  ): Promise<FastifyReply> {
    const audio = await this.deps.repo.findAudio(themeId);
    if (!audio) throw new ApiError(404, "NOT_FOUND", "Theme not found.");

    const readyAudio = audio.state === "READY" ? await this.readyMediaFile(audio.filePath) : null;
    if (this.deps.loudnessPlaybackGainEnabled
      && (audio.loudnessState !== "READY" || audio.loudnessSha256 !== audio.sha256)) {
      this.deps.activity?.markMiss();
      if (method === "GET") await this.enqueueFetch(themeId, JobPriority.URGENT);
      throw new ApiError(503, "AUDIO_PREPARING", "Audio is being loudness-analyzed. Retry shortly.");
    }
    if (readyAudio) {
      const logger = this.deps.logger ?? log;
      logger?.info(
        {
          themeId,
          state: audio.state,
          method,
          range: rangeHeader,
          originHost: originHost(audio.originUrl),
          originUrl: safeExternalUrl(audio.originUrl),
          externalHit: false,
          byteSize: readyAudio.size,
          videoFallback: audio.videoFallback ?? false,
        },
        "serving cached audio file",
      );
      return this.sendReadyFile({
        absolutePath: readyAudio.absolutePath,
        method,
        rangeHeader,
        reply,
        totalSize: readyAudio.size,
        etag: audio.sha256,
        contentType: audio.videoFallback ? "video/webm" : "audio/ogg",
      });
    }

    if (audio.state === "FAILED") {
      throw new ApiError(503, "AUDIO_UNAVAILABLE", "Audio is currently unavailable after a failed cache fetch.");
    }

    this.deps.activity?.markMiss();
    if (method === "GET") {
      await this.enqueueFetch(themeId, JobPriority.URGENT);
    }
    if (this.deps.loudnessPlaybackGainEnabled) {
      throw new ApiError(503, "AUDIO_PREPARING", "Audio is being cached and loudness-analyzed. Retry shortly.");
    }
    return this.proxyAudio({
      audio,
      method,
      rangeHeader,
      reply,
      log,
    });
  }

  async sendSongAudio(
    songId: number,
    method: "GET" | "HEAD",
    rangeHeader: string | undefined,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    if (!this.deps.musicCatalogEnabled) {
      throw new ApiError(404, "MUSIC_NOT_FOUND", "Song audio is not in the ready catalog.");
    }
    const audio = await this.deps.repo.findSongAudio(songId);
    if (!audio || audio.state !== "READY") {
      throw new ApiError(404, "MUSIC_NOT_FOUND", "Song audio is not in the ready catalog.");
    }
    if (this.deps.loudnessPlaybackGainEnabled
      && (audio.loudnessState !== "READY" || audio.loudnessSha256 !== audio.sha256)) {
      throw new ApiError(503, "MUSIC_AUDIO_PREPARING", "Song audio is being loudness-analyzed. Retry shortly.");
    }
    const readyAudio = await this.readyMediaFile(audio.filePath);
    if (!readyAudio) {
      throw new ApiError(503, "MUSIC_MEDIA_UNAVAILABLE", "Catalog song audio is missing from server storage.");
    }
    if (!audio.contentType?.toLowerCase().startsWith("audio/")) {
      throw new ApiError(503, "MUSIC_MEDIA_UNAVAILABLE", "Catalog song audio metadata is incomplete.");
    }
    return this.sendReadyFile({
      absolutePath: readyAudio.absolutePath,
      method,
      rangeHeader,
      reply,
      totalSize: readyAudio.size,
      etag: audio.sha256,
      contentType: audio.contentType,
      sourceFileName: audio.sourceFileName,
    });
  }

  async sendSonosThemeAudio(
    themeId: number,
    method: "GET" | "HEAD",
    rangeHeader: string | undefined,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const audio = await this.deps.repo.findAudio(themeId);
    if (!audio) throw new ApiError(404, "NOT_FOUND", "Theme not found.");
    if (audio.state !== "READY") throw new ApiError(503, "AUDIO_PREPARING", "Audio is being prepared. Retry shortly.");
    if (this.deps.loudnessPlaybackGainEnabled && (audio.loudnessState !== "READY" || audio.loudnessSha256 !== audio.sha256)) {
      throw new ApiError(503, "AUDIO_PREPARING", "Audio is being loudness-analyzed. Retry shortly.");
    }
    const source = await this.readyMediaFile(audio.filePath);
    if (!source) throw new ApiError(503, "AUDIO_UNAVAILABLE", "Audio is missing from server storage.");
    return this.sendSonosMp3({ kind: "themes", id: themeId, source, sourceSha: audio.sha256, method, rangeHeader, reply });
  }

  async sendSonosSongAudio(
    songId: number,
    method: "GET" | "HEAD",
    rangeHeader: string | undefined,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    if (!this.deps.musicCatalogEnabled) throw new ApiError(404, "MUSIC_NOT_FOUND", "Song audio is not in the ready catalog.");
    const audio = await this.deps.repo.findSongAudio(songId);
    if (!audio || audio.state !== "READY") throw new ApiError(404, "MUSIC_NOT_FOUND", "Song audio is not in the ready catalog.");
    if (this.deps.loudnessPlaybackGainEnabled && (audio.loudnessState !== "READY" || audio.loudnessSha256 !== audio.sha256)) {
      throw new ApiError(503, "MUSIC_AUDIO_PREPARING", "Song audio is being loudness-analyzed. Retry shortly.");
    }
    const source = await this.readyMediaFile(audio.filePath);
    if (!source) throw new ApiError(503, "MUSIC_MEDIA_UNAVAILABLE", "Catalog song audio is missing from server storage.");
    return this.sendSonosMp3({ kind: "songs", id: songId, source, sourceSha: audio.sha256, method, rangeHeader, reply });
  }

  private async sendSonosMp3(input: {
    kind: "themes" | "songs"; id: number; source: ReadyMediaFile; sourceSha: string | null;
    method: "GET" | "HEAD"; rangeHeader: string | undefined; reply: FastifyReply;
  }): Promise<FastifyReply> {
    const fingerprint = createHash("sha256").update(`${input.sourceSha ?? ""}:${input.source.absolutePath}:${input.source.size}`, "utf8").digest("hex").slice(0, 24);
    const outputRelativePath = join("sonos", input.kind, String(input.id), `${fingerprint}.mp3`);
    const ready = await this.prepareSonosMp3(input.source.absolutePath, outputRelativePath);
    return this.sendReadyFile({ absolutePath: ready.absolutePath, method: input.method, rangeHeader: input.rangeHeader,
      reply: input.reply, totalSize: ready.size, etag: fingerprint, contentType: "audio/mpeg" });
  }

  private async prepareSonosMp3(
    sourcePath: string,
    outputRelativePath: string,
  ): Promise<ReadyMediaFile> {
    const outputPath = await this.resolveSonosPath(outputRelativePath, true);
    const existing = await stat(outputPath).catch(() => null);
    if (existing?.isFile() && existing.size > 0) return { absolutePath: outputPath, size: existing.size };
    const pending = this.sonosTranscodes.get(outputPath);
    if (pending) return pending;
    const transcode = this.buildSonosMp3(sourcePath, outputRelativePath);
    this.sonosTranscodes.set(outputPath, transcode);
    try { return await transcode; }
    finally { if (this.sonosTranscodes.get(outputPath) === transcode) this.sonosTranscodes.delete(outputPath); }
  }

  private async buildSonosMp3(
    sourcePath: string,
    outputRelativePath: string,
  ): Promise<ReadyMediaFile> {
    const outputPath = await this.resolveSonosPath(outputRelativePath, true);
    const existing = await stat(outputPath).catch(() => null);
    if (existing?.isFile() && existing.size > 0) return { absolutePath: outputPath, size: existing.size };
    const temporaryRelativePath = `${outputRelativePath}.${randomUUID()}.tmp.mp3`;
    let temporaryPath: string | null = null;
    try {
      temporaryPath = await this.resolveSonosPath(temporaryRelativePath, true);
      await withSonosTranscodeLimit(() => this.sonosTranscoder.transcodeToMp3(sourcePath, temporaryPath!));
      const temporary = await stat(temporaryPath);
      if (!temporary.isFile() || temporary.size <= 0) throw new Error("FFmpeg produced an empty MP3.");
      await rename(temporaryPath, outputPath);
      return { absolutePath: outputPath, size: temporary.size };
    } catch (error) {
      if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      this.deps.logger?.warn?.({ errorName: error instanceof Error ? error.name : "Error" }, "Sonos audio transcoding failed");
      throw new ApiError(503, "SONOS_AUDIO_UNAVAILABLE", "Sonos-compatible audio could not be prepared.");
    }
  }

  private async resolveSonosPath(relativePath: string, createParent: boolean): Promise<string> {
    try {
      let absolutePath = await resolveManagedMediaPath(this.mediaRoot, relativePath);
      if (createParent) {
        await mkdir(dirname(absolutePath), { recursive: true });
        // Recheck after parent creation so a pre-existing junction cannot be
        // hidden by a missing ancestor during the first check.
        absolutePath = await resolveManagedMediaPath(this.mediaRoot, relativePath);
      }
      return absolutePath;
    } catch (error) {
      if (error instanceof MediaPathEscapeError) {
        throw new ApiError(500, "INTERNAL", "Invalid media path.");
      }
      throw error;
    }
  }
  async requestAudio(themeId: number): Promise<{ themeId: number; audioState: AudioState; jobId: number }> {
    const audio = await this.deps.repo.findAudio(themeId);
    if (!audio) throw new ApiError(404, "NOT_FOUND", "Theme not found.");
    // Already cached locally — never re-hit AnimeThemes for media the server owns.
    // jobId 0 signals "no fetch needed"; clients warm-poll this until audioState is READY.
    if (audio.state === "READY" && await this.readyMediaFile(audio.filePath)) {
      return { themeId, audioState: "READY", jobId: 0 };
    }
    if (audio.state === "FAILED") {
      return { themeId, audioState: "FAILED", jobId: 0 };
    }
    this.deps.activity?.markMiss();
    const job = await this.enqueueFetch(themeId, JobPriority.HIGH);
    return {
      themeId,
      audioState: audio.state === "READY" ? "MISSING" : audioState(audio.state),
      jobId: job.id,
    };
  }

  async sendImage(
    kind: ImageRouteKind,
    refId: string,
    reply: FastifyReply,
    log?: FastifyBaseLogger,
  ): Promise<FastifyReply> {
    const image = await this.deps.repo.findImage(kind, refId);
    if (!image) throw new ApiError(404, "NOT_FOUND", "Image not found.");

    const readyImage = image.state === "READY" ? await this.readyMediaFile(image.filePath) : null;
    if (readyImage) {
      return this.sendReadyFile({
        absolutePath: readyImage.absolutePath,
        method: "GET",
        rangeHeader: undefined,
        reply,
        totalSize: readyImage.size,
        etag: image.sha256,
        contentType: "image/jpeg",
      });
    }

    // A client is actively waiting on this image, so the cache-fill job is as
    // urgent as an audio miss — it must jump ahead of background hydration.
    this.deps.activity?.markMiss();
    await this.enqueueImageFetch(kind, refId, JobPriority.URGENT);
    return this.proxyImage(reply, image.originUrl, { kind, refId, log });
  }

  private async enqueueFetch(themeId: number, priority: number) {
    return this.deps.queue.enqueue({
      type: "FETCH_AUDIO",
      priority,
      payload: { themeId },
      dedupeKey: `FETCH_AUDIO:${themeId}`,
    });
  }

  private async enqueueImageFetch(kind: ImageRouteKind, refId: string, priority: number) {
    return this.deps.queue.enqueue({
      type: "FETCH_IMAGE",
      priority,
      payload: { kind, refId },
      dedupeKey: `FETCH_IMAGE:${kind}:${refId}`,
    });
  }

  private async proxyImage(
    reply: FastifyReply,
    originUrl: string,
    input: { kind: ImageRouteKind; refId: string; log: FastifyBaseLogger | undefined },
  ): Promise<FastifyReply> {
    const logger = this.deps.logger ?? input.log;
    const logData = {
      kind: input.kind,
      refId: input.refId,
      originHost: originHost(originUrl),
      originUrl: safeExternalUrl(originUrl),
      externalHit: true,
    };
    logger?.info(logData, "external image origin request");
    const response = await this.imageFetchImpl(originUrl);
    logger?.info(
      {
        ...logData,
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
      },
      "external image origin response",
    );
    if (!response.ok) {
      logger?.warn?.({ ...logData, status: response.status }, "external image origin returned an error");
      throw new ApiError(502, "UPSTREAM_FAILED", `Image origin returned HTTP ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new ApiError(502, "UPSTREAM_FAILED", "Image origin returned a non-image response.");
    }
    const body = Buffer.from(await response.arrayBuffer());
    reply
      .code(200)
      .header("Cache-Control", "private, max-age=3600")
      .header("Content-Type", contentType)
      .header("Content-Length", String(body.length));
    return reply.send(body);
  }

  private async proxyAudio(input: {
    audio: MediaAudioRecord;
    method: "GET" | "HEAD";
    rangeHeader: string | undefined;
    reply: FastifyReply;
    log: FastifyBaseLogger | undefined;
  }): Promise<FastifyReply> {
    const headers = new Headers();
    if (input.rangeHeader) headers.set("Range", input.rangeHeader);
    const logger = this.deps.logger ?? input.log;

    logger?.info(
      {
        themeId: input.audio.themeId,
        state: input.audio.state,
        method: input.method,
        range: input.rangeHeader,
        originHost: originHost(input.audio.originUrl),
        originUrl: safeExternalUrl(input.audio.originUrl),
        externalHit: true,
      },
      "external audio origin request",
    );

    const response = await this.fetchImpl(input.audio.originUrl, {
      method: input.method,
      headers,
    });

    const contentType = response.headers.get("content-type") ?? fallbackAudioContentType(input.audio);
    logger?.info(
      {
        themeId: input.audio.themeId,
        method: input.method,
        range: input.rangeHeader,
        originHost: originHost(input.audio.originUrl),
        originUrl: safeExternalUrl(input.audio.originUrl),
        externalHit: true,
        status: response.status,
        contentType,
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
      },
      "audio origin response",
    );

    if (!response.ok) {
      logger?.warn?.(
        {
          themeId: input.audio.themeId,
          method: input.method,
          range: input.rangeHeader,
          originHost: originHost(input.audio.originUrl),
          originUrl: safeExternalUrl(input.audio.originUrl),
          externalHit: true,
          status: response.status,
        },
        "audio origin returned an error",
      );
      throw new ApiError(502, "UPSTREAM_FAILED", `Audio origin returned HTTP ${response.status}.`);
    }
    validateAudioContentType(contentType, input.audio.originUrl);

    input.reply
      .code(response.status)
      .header("Cache-Control", "private, max-age=3600")
      .header("Content-Type", contentType)
      .header("Accept-Ranges", response.headers.get("accept-ranges") ?? "bytes");
    copyHeader(response, input.reply, "content-length", "Content-Length");
    copyHeader(response, input.reply, "content-range", "Content-Range");
    copyHeader(response, input.reply, "etag", "ETag");
    copyHeader(response, input.reply, "last-modified", "Last-Modified");

    if (input.method === "HEAD") {
      return input.reply.send();
    }
    if (!response.body) {
      throw new ApiError(502, "UPSTREAM_FAILED", "Audio origin returned no body.");
    }
    return input.reply.send(Readable.fromWeb(response.body));
  }

  private sendReadyFile(input: {
    absolutePath: string;
    method: "GET" | "HEAD";
    rangeHeader: string | undefined;
    reply: FastifyReply;
    totalSize: number;
    etag: string | null;
    contentType: string;
    sourceFileName?: string | null;
  }): FastifyReply {
    setCacheHeaders(input.reply, input.totalSize, input.etag, input.contentType);
    if (input.sourceFileName) {
      input.reply.header("Content-Disposition", contentDisposition(input.sourceFileName));
    }

    if (input.method === "HEAD") {
      return input.reply.code(200).send();
    }

    const range = parseRange(input.rangeHeader, input.totalSize);
    if (range === "invalid") {
      return input.reply
        .code(416)
        .header("Content-Range", `bytes */${input.totalSize}`)
        .send();
    }

    if (range) {
      input.reply
        .code(206)
        .header("Content-Range", `bytes ${range.start}-${range.end}/${input.totalSize}`)
        .header("Content-Length", String(range.end - range.start + 1));
      return input.reply.send(createReadStream(input.absolutePath, range));
    }

    input.reply.code(200).header("Content-Length", String(input.totalSize));
    return input.reply.send(createReadStream(input.absolutePath));
  }

  private async readyMediaFile(relativePath: string | null): Promise<ReadyMediaFile | null> {
    if (!relativePath) return null;
    let absolutePath: string;
    try {
      absolutePath = await resolveManagedMediaPath(this.mediaRoot, relativePath);
    } catch {
      throw new ApiError(500, "INTERNAL", "Invalid media path.");
    }
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat?.isFile()) return null;
    return { absolutePath, size: fileStat.size };
  }
}

const audioParams = z.object({
  themeId: z.coerce.number().int().positive(),
});

const songAudioParams = z.object({
  songId: z.coerce.number().int().positive(),
});

const animeImageParams = z.object({
  kitsuId: z.string().min(1),
  variant: z.enum(["poster", "cover"]),
});

const artistImageParams = z.object({
  slug: z.string().min(1),
});

export function registerMediaRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  service: MediaStreamingService,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.get(
    "/v1/media/audio/:themeId",
    { schema: { params: audioParams }, preHandler: requireAuth, exposeHeadRoute: false },
    async (request, reply) =>
      service.sendAudio(
        request.params.themeId,
        "GET",
        headerValue(request.headers.range),
        reply,
        request.log,
      ),
  );

  app.head(
    "/v1/media/audio/:themeId",
    { schema: { params: audioParams }, preHandler: requireAuth },
    async (request, reply) =>
      service.sendAudio(
        request.params.themeId,
        "HEAD",
        headerValue(request.headers.range),
        reply,
        request.log,
      ),
  );

  app.get(
    "/v1/media/sonos/themes/:themeId.mp3",
    { schema: { params: audioParams }, preHandler: requireAuth, exposeHeadRoute: false },
    async (request, reply) => service.sendSonosThemeAudio(request.params.themeId, "GET", headerValue(request.headers.range), reply),
  );

  app.head(
    "/v1/media/sonos/themes/:themeId.mp3",
    { schema: { params: audioParams }, preHandler: requireAuth },
    async (request, reply) => service.sendSonosThemeAudio(request.params.themeId, "HEAD", headerValue(request.headers.range), reply),
  );

  app.get(
    "/v1/media/sonos/songs/:songId.mp3",
    { schema: { params: songAudioParams }, preHandler: requireAuth, exposeHeadRoute: false },
    async (request, reply) => service.sendSonosSongAudio(request.params.songId, "GET", headerValue(request.headers.range), reply),
  );

  app.head(
    "/v1/media/sonos/songs/:songId.mp3",
    { schema: { params: songAudioParams }, preHandler: requireAuth },
    async (request, reply) => service.sendSonosSongAudio(request.params.songId, "HEAD", headerValue(request.headers.range), reply),
  );

  app.post(
    "/v1/media/audio/:themeId/request",
    { schema: { params: audioParams }, preHandler: requireAuth },
    async (request) => service.requestAudio(request.params.themeId),
  );

  app.get(
    "/v1/media/songs/:songId/audio",
    { schema: { params: songAudioParams }, preHandler: requireAuth, exposeHeadRoute: false },
    async (request, reply) =>
      service.sendSongAudio(
        request.params.songId,
        "GET",
        headerValue(request.headers.range),
        reply,
      ),
  );

  app.head(
    "/v1/media/songs/:songId/audio",
    { schema: { params: songAudioParams }, preHandler: requireAuth },
    async (request, reply) =>
      service.sendSongAudio(
        request.params.songId,
        "HEAD",
        headerValue(request.headers.range),
        reply,
      ),
  );

  app.get(
    "/v1/media/images/anime/:kitsuId/:variant",
    { schema: { params: animeImageParams } },
    async (request, reply) => {
      const kind = request.params.variant === "poster" ? "ANIME_POSTER" : "ANIME_COVER";
      return service.sendImage(kind, request.params.kitsuId, reply, request.log);
    },
  );

  app.get(
    "/v1/media/images/artists/:slug",
    { schema: { params: artistImageParams } },
    async (request, reply) => service.sendImage("ARTIST_IMAGE", request.params.slug, reply, request.log),
  );
}

function setCacheHeaders(reply: FastifyReply, totalSize: number, etag: string | null, contentType: string): void {
  reply
    .header("Accept-Ranges", "bytes")
    .header("Cache-Control", "private, max-age=31536000, immutable")
    .header("Content-Type", contentType)
    .header("Content-Length", String(totalSize));
  if (etag) reply.header("ETag", `"${etag}"`);
}

function parseRange(header: string | undefined, totalSize: number): ByteRange | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";

  const [, startText, endText] = match;
  if (!startText && !endText) return "invalid";

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "invalid";
    const start = Math.max(totalSize - suffixLength, 0);
    return { start, end: totalSize - 1 };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : totalSize - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= totalSize
  ) {
    return "invalid";
  }
  return { start, end: Math.min(end, totalSize - 1) };
}

function audioState(state: MediaState): AudioState {
  if (state === "READY") return "READY";
  if (state === "FAILED") return "FAILED";
  if (state === "QUEUED" || state === "DOWNLOADING") return "PENDING";
  return "MISSING";
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function copyHeader(response: Response, reply: FastifyReply, source: string, target: string): void {
  const value = response.headers.get(source);
  if (value) reply.header(target, value);
}

function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename*=UTF-8''${encoded}`;
}

function fallbackAudioContentType(audio: MediaAudioRecord): string {
  return audio.videoFallback || /\.webm($|\?)/i.test(audio.originUrl) ? "video/webm" : "audio/ogg";
}

function validateAudioContentType(contentType: string, originUrl: string): void {
  const normalized = contentType.toLowerCase();
  const valid =
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/") ||
    normalized.includes("application/octet-stream");
  if (!valid) {
    throw new ApiError(502, "UPSTREAM_FAILED", `Audio origin returned non-audio content: ${contentType}.`);
  }
  if (normalized.startsWith("video/") && !/\.webm($|\?)/i.test(originUrl)) {
    throw new ApiError(502, "UPSTREAM_FAILED", `Audio origin returned unexpected video content: ${contentType}.`);
  }
}

function originHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
