import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import {
  MediaStreamingService,
  type MediaApiRepository,
} from "../src/api/mediaRoutes.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

class FakeMediaRepo implements MediaApiRepository {
  audio = new Map<number, Awaited<ReturnType<MediaApiRepository["findAudio"]>>>();
  images = new Map<string, Awaited<ReturnType<MediaApiRepository["findImage"]>>>();

  async findAudio(themeId: number) {
    return this.audio.get(themeId) ?? null;
  }

  async findImage(kind: "ANIME_POSTER" | "ANIME_COVER" | "ARTIST_IMAGE", refId: string) {
    return this.images.get(`${kind}:${refId}`) ?? null;
  }
}

let app: FastifyInstance;
let repo: FakeMediaRepo;
let queue: JobQueue;
let jobs: FakeJobRepository;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-media-api-"));
  await mkdir(join(mediaRoot, "audio"), { recursive: true });
  repo = new FakeMediaRepo();
  jobs = new FakeJobRepository();
  queue = new JobQueue(jobs);
  app = buildApp({
    authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    mediaApi: new MediaStreamingService({ repo, queue, mediaRoot }),
  });
});

afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function bearer() {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username: "nolan", password: "hunter2" },
  });
  return res.json().token as string;
}

describe("media API routes", () => {
  it("serves READY audio with byte range semantics", async () => {
    const contents = Buffer.from("0123456789abcdef");
    writeFileSync(join(mediaRoot, "audio", "100.ogg"), contents);
    repo.audio.set(100, {
      themeId: 100,
      originUrl: "https://a.animethemes.moe/Ready.ogg",
      state: "READY",
      filePath: "audio/100.ogg",
      byteSize: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
    const token = await bearer();

    const res = await app.inject({
      method: "GET",
      url: "/v1/media/audio/100",
      headers: { authorization: `Bearer ${token}`, range: "bytes=2-5" },
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-range"]).toBe("bytes 2-5/16");
    expect(res.body).toBe("2345");
  });

  it("returns HEAD metadata for READY audio without a body", async () => {
    const contents = Buffer.from("0123456789abcdef");
    writeFileSync(join(mediaRoot, "audio", "100.ogg"), contents);
    repo.audio.set(100, {
      themeId: 100,
      originUrl: "https://a.animethemes.moe/Ready.ogg",
      state: "READY",
      filePath: "audio/100.ogg",
      byteSize: contents.length,
      sha256: "abc123",
    });
    const token = await bearer();

    const res = await app.inject({
      method: "HEAD",
      url: "/v1/media/audio/100",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe('"abc123"');
    expect(res.body).toBe("");
  });

  it("redirects missing audio to origin and dedupes the URGENT fetch job", async () => {
    repo.audio.set(100, {
      themeId: 100,
      originUrl: "https://a.animethemes.moe/Missing.ogg",
      state: "MISSING",
      filePath: null,
      byteSize: null,
      sha256: null,
    });
    const token = await bearer();

    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: "/v1/media/audio/100",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("https://a.animethemes.moe/Missing.ogg");
    }

    const queued = await queue.list("QUEUED");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 100 },
      dedupeKey: "FETCH_AUDIO:100",
    });
  });

  it("explicit audio requests enqueue HIGH priority and return current state", async () => {
    repo.audio.set(100, {
      themeId: 100,
      originUrl: "https://a.animethemes.moe/Missing.ogg",
      state: "MISSING",
      filePath: null,
      byteSize: null,
      sha256: null,
    });
    const token = await bearer();

    const res = await app.inject({
      method: "POST",
      url: "/v1/media/audio/100/request",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ themeId: 100, audioState: "MISSING", jobId: 1 });
    expect((await queue.list("QUEUED"))[0]).toMatchObject({
      priority: JobPriority.HIGH,
      dedupeKey: "FETCH_AUDIO:100",
    });
  });

  it("redirects missing image media without requiring bearer auth", async () => {
    repo.images.set("ANIME_COVER:123", {
      originUrl: "https://media.kitsu.test/anime-cover.jpg",
      state: "MISSING",
      filePath: null,
      sha256: null,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/media/images/anime/123/cover",
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://media.kitsu.test/anime-cover.jpg");
  });
});
