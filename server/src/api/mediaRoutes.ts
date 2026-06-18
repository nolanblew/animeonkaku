import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import type { FetchLike } from "../http/types.js";
import { JobPriority, type JobQueue } from "../jobs/index.js";
import type { AppLogger } from "../logging.js";
import { safeExternalUrl } from "../logging.js";
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
}

export interface MediaImageRecord {
  originUrl: string;
  state: MediaState;
  filePath: string | null;
  sha256: string | null;
}

export interface MediaApiRepository {
  findAudio(themeId: number): Promise<MediaAudioRecord | null>;
  findImage(kind: ImageRouteKind, refId: string): Promise<MediaImageRecord | null>;
}

export interface MediaStreamingServiceDeps {
  repo: MediaApiRepository;
  queue: JobQueue;
  mediaRoot: string;
  fetch?: FetchLike;
  logger?: AppLogger;
}

interface ByteRange {
  start: number;
  end: number;
}

export class MediaStreamingService {
  private readonly mediaRoot: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly deps: MediaStreamingServiceDeps) {
    this.mediaRoot = resolve(deps.mediaRoot);
    this.fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init));
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

    if (audio.state === "READY" && audio.filePath) {
      const absolutePath = this.safeMediaPath(audio.filePath);
      const fileStat = await stat(absolutePath).catch(() => null);
      if (fileStat?.isFile()) {
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
            byteSize: fileStat.size,
            videoFallback: audio.videoFallback ?? false,
          },
          "serving cached audio file",
        );
        return this.sendReadyFile({
          absolutePath,
          method,
          rangeHeader,
          reply,
          totalSize: fileStat.size,
          etag: audio.sha256,
          contentType: audio.videoFallback ? "video/webm" : "audio/ogg",
        });
      }
    }

    if (audio.state === "FAILED") {
      throw new ApiError(503, "AUDIO_UNAVAILABLE", "Audio is currently unavailable after a failed cache fetch.");
    }

    if (method === "GET") {
      await this.enqueueFetch(themeId, JobPriority.URGENT);
    }
    return this.proxyAudio({
      audio,
      method,
      rangeHeader,
      reply,
      log,
    });
  }

  async requestAudio(themeId: number): Promise<{ themeId: number; audioState: AudioState; jobId: number }> {
    const audio = await this.deps.repo.findAudio(themeId);
    if (!audio) throw new ApiError(404, "NOT_FOUND", "Theme not found.");
    // Already cached locally — never re-hit AnimeThemes for media the server owns.
    // jobId 0 signals "no fetch needed"; clients warm-poll this until audioState is READY.
    if (audio.state === "READY" && audio.filePath) {
      return { themeId, audioState: "READY", jobId: 0 };
    }
    if (audio.state === "FAILED") {
      return { themeId, audioState: "FAILED", jobId: 0 };
    }
    const job = await this.enqueueFetch(themeId, JobPriority.HIGH);
    return { themeId, audioState: audioState(audio.state), jobId: job.id };
  }

  async sendImage(
    kind: ImageRouteKind,
    refId: string,
    reply: FastifyReply,
    log?: FastifyBaseLogger,
  ): Promise<FastifyReply> {
    const image = await this.deps.repo.findImage(kind, refId);
    if (!image) throw new ApiError(404, "NOT_FOUND", "Image not found.");

    if (image.state === "READY" && image.filePath) {
      const absolutePath = this.safeMediaPath(image.filePath);
      const fileStat = await stat(absolutePath).catch(() => null);
      if (fileStat?.isFile()) {
        return this.sendReadyFile({
          absolutePath,
          method: "GET",
          rangeHeader: undefined,
          reply,
          totalSize: fileStat.size,
          etag: image.sha256,
          contentType: "image/jpeg",
        });
      }
    }

    await this.enqueueImageFetch(kind, refId, JobPriority.NORMAL);
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
    const response = await this.fetchImpl(originUrl);
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
  }): FastifyReply {
    setCacheHeaders(input.reply, input.totalSize, input.etag, input.contentType);

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

  private safeMediaPath(relativePath: string): string {
    const absolutePath = resolve(join(this.mediaRoot, relativePath));
    const relativeToRoot = relative(this.mediaRoot, absolutePath);
    if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
      throw new ApiError(500, "INTERNAL", "Invalid media path.");
    }
    return absolutePath;
  }
}

const audioParams = z.object({
  themeId: z.coerce.number().int().positive(),
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
    { schema: { params: audioParams }, exposeHeadRoute: false },
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
    { schema: { params: audioParams } },
    async (request, reply) =>
      service.sendAudio(
        request.params.themeId,
        "HEAD",
        headerValue(request.headers.range),
        reply,
        request.log,
      ),
  );

  app.post(
    "/v1/media/audio/:themeId/request",
    { schema: { params: audioParams }, preHandler: requireAuth },
    async (request) => service.requestAudio(request.params.themeId),
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
