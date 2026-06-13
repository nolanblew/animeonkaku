import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { JobPriority, type JobQueue } from "../jobs/index.js";
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
}

interface ByteRange {
  start: number;
  end: number;
}

export class MediaStreamingService {
  private readonly mediaRoot: string;

  constructor(private readonly deps: MediaStreamingServiceDeps) {
    this.mediaRoot = resolve(deps.mediaRoot);
  }

  async sendAudio(
    themeId: number,
    method: "GET" | "HEAD",
    rangeHeader: string | undefined,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const audio = await this.deps.repo.findAudio(themeId);
    if (!audio) throw new ApiError(404, "NOT_FOUND", "Theme not found.");

    if (audio.state === "READY" && audio.filePath) {
      const absolutePath = this.safeMediaPath(audio.filePath);
      const fileStat = await stat(absolutePath).catch(() => null);
      if (fileStat?.isFile()) {
        return this.sendReadyFile({
          absolutePath,
          method,
          rangeHeader,
          reply,
          totalSize: fileStat.size,
          etag: audio.sha256,
          contentType: "audio/ogg",
        });
      }
    }

    if (method === "GET") {
      await this.enqueueFetch(themeId, JobPriority.URGENT);
    }
    return redirect(reply, audio.originUrl);
  }

  async requestAudio(themeId: number): Promise<{ themeId: number; audioState: AudioState; jobId: number }> {
    const audio = await this.deps.repo.findAudio(themeId);
    if (!audio) throw new ApiError(404, "NOT_FOUND", "Theme not found.");
    const job = await this.enqueueFetch(themeId, JobPriority.HIGH);
    return { themeId, audioState: audioState(audio.state), jobId: job.id };
  }

  async sendImage(kind: ImageRouteKind, refId: string, reply: FastifyReply): Promise<FastifyReply> {
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

    return redirect(reply, image.originUrl);
  }

  private async enqueueFetch(themeId: number, priority: number) {
    return this.deps.queue.enqueue({
      type: "FETCH_AUDIO",
      priority,
      payload: { themeId },
      dedupeKey: `FETCH_AUDIO:${themeId}`,
    });
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
    { schema: { params: audioParams }, preHandler: requireAuth, exposeHeadRoute: false },
    async (request, reply) =>
      service.sendAudio(
        request.params.themeId,
        "GET",
        headerValue(request.headers.range),
        reply,
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
      return service.sendImage(kind, request.params.kitsuId, reply);
    },
  );

  app.get(
    "/v1/media/images/artists/:slug",
    { schema: { params: artistImageParams } },
    async (request, reply) => service.sendImage("ARTIST_IMAGE", request.params.slug, reply),
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

function redirect(reply: FastifyReply, location: string): FastifyReply {
  return reply.code(302).header("Location", location).send();
}
