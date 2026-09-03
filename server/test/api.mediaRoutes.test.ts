import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { JobPriority, JobQueue } from "../src/jobs/index.js";
import {
  MediaStreamingService,
  type MediaApiRepository,
  type MediaStreamingServiceDeps,
} from "../src/api/mediaRoutes.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

class FakeMediaRepo implements MediaApiRepository {
  audio = new Map<number, Awaited<ReturnType<MediaApiRepository["findAudio"]>>>();
  songs = new Map<number, Awaited<ReturnType<MediaApiRepository["findSongAudio"]>>>();
  images = new Map<string, Awaited<ReturnType<MediaApiRepository["findImage"]>>>();
  songLookups = 0;

  async findAudio(themeId: number) {
    return this.audio.get(themeId) ?? null;
  }

  async findSongAudio(songId: number) {
    this.songLookups++;
    return this.songs.get(songId) ?? null;
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
let fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }>;
let mediaFetch: NonNullable<MediaStreamingServiceDeps["fetch"]>;
let logs: Array<{ data: unknown; message: string }>;
let extraRoots: string[];

beforeEach(async () => {
  mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-media-api-"));
  await mkdir(join(mediaRoot, "audio"), { recursive: true });
  repo = new FakeMediaRepo();
  jobs = new FakeJobRepository();
  queue = new JobQueue(jobs);
  fetchCalls = [];
  logs = [];
  extraRoots = [];
  mediaFetch = async (input, init) => {
    fetchCalls.push({ input, init });
    return new Response(Buffer.from("jpeg-bytes"), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };
  app = buildApp({
    authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    mediaApi: new MediaStreamingService({
      repo,
      queue,
      mediaRoot,
      fetch: (input, init) => mediaFetch(input, init),
      logger: {
        info: (data, message) => logs.push({ data, message }),
      },
      musicCatalogEnabled: true,
    }),
  });
});

afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
  await Promise.all(extraRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function bearer(prefix = "") {
  const res = await app.inject({
    method: "POST",
    url: `${prefix}/v1/auth/login`,
    payload: { username: "nolan", password: "hunter2" },
  });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

describe("media API routes", () => {
  it.each(["GET", "HEAD"] as const)("requires bearer auth for Sonos theme MP3 %s", async (method) => {
    const res = await app.inject({ method, url: "/v1/media/sonos/themes/100.mp3" });
    expect(res.statusCode).toBe(401);
  });

  it("transcodes and caches READY theme audio for Sonos byte-range playback", async () => {
    const contents = Buffer.from("0123456789abcdef");
    writeFileSync(join(mediaRoot, "audio", "100.ogg"), contents);
    repo.audio.set(100, { themeId: 100, originUrl: "https://a.animethemes.moe/Ready.ogg",
      state: "READY", filePath: "audio/100.ogg", byteSize: contents.length, sha256: "source-sha" });
    let transcodes = 0;
    await app.close();
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      mediaApi: new MediaStreamingService({ repo, queue, mediaRoot, musicCatalogEnabled: true,
        sonosTranscoder: { transcodeToMp3: async (sourcePath: string, outputPath: string) => {
          transcodes += 1; await copyFile(sourcePath, outputPath);
        } },
      } as MediaStreamingServiceDeps & { sonosTranscoder: unknown }),
    });
    const token = await bearer();

    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const res = await app.inject({ method: "GET", url: "/v1/media/sonos/themes/100.mp3",
        headers: { authorization: `Bearer ${token}`, range: "bytes=2-5" } });
      expect(res.statusCode).toBe(206);
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.headers["content-range"]).toBe("bytes 2-5/16");
      expect(res.body).toBe("2345");
    }
    expect(transcodes).toBe(1);
  });

  it("transcodes READY catalog songs to MP3 for Sonos", async () => {
    const contents = Buffer.from("full-size-song");
    const filePath = "audio/songs/77/original.flac";
    await mkdir(join(mediaRoot, "audio", "songs", "77"), { recursive: true });
    writeFileSync(join(mediaRoot, filePath), contents);
    repo.songs.set(77, { songId: 77, state: "READY", filePath, byteSize: contents.length,
      sha256: "song-sha", contentType: "audio/flac", sourceFileName: "Full Song.flac" });
    await app.close();
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      mediaApi: new MediaStreamingService({ repo, queue, mediaRoot, musicCatalogEnabled: true,
        sonosTranscoder: { transcodeToMp3: copyFile },
      } as MediaStreamingServiceDeps & { sonosTranscoder: unknown }),
    });
    const token = await bearer();

    const res = await app.inject({ method: "GET", url: "/v1/media/sonos/songs/77.mp3",
      headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect(res.body).toBe(contents.toString());
  });

  it("rejects a Sonos derivative destination redirected outside MEDIA_ROOT by a junction", async () => {
    const contents = Buffer.from("source-audio");
    writeFileSync(join(mediaRoot, "audio", "100.ogg"), contents);
    const escapedDirectory = mkdtempSync(join(tmpdir(), "ongaku-sonos-escape-"));
    extraRoots.push(escapedDirectory);
    symlinkSync(escapedDirectory, join(mediaRoot, "sonos"), "junction");
    repo.audio.set(100, { themeId: 100, originUrl: "https://a.animethemes.moe/Ready.ogg",
      state: "READY", filePath: "audio/100.ogg", byteSize: contents.length, sha256: "source-sha" });
    const transcoder = { transcodeToMp3: vi.fn(async (sourcePath: string, outputPath: string) => copyFile(sourcePath, outputPath)) };
    await app.close();
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      mediaApi: new MediaStreamingService({ repo, queue, mediaRoot, musicCatalogEnabled: true,
        sonosTranscoder: transcoder } as MediaStreamingServiceDeps & { sonosTranscoder: unknown }),
    });
    const token = await bearer();

    const res = await app.inject({ method: "GET", url: "/v1/media/sonos/themes/100.mp3",
      headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: "INTERNAL" } });
    expect(transcoder.transcodeToMp3).not.toHaveBeenCalled();
    expect(existsSync(join(escapedDirectory, "themes", "100"))).toBe(false);
  });

  it("limits Sonos transcodes globally when different outputs are requested concurrently", async () => {
    const contents = Buffer.from("source-audio");
    const transcodeState = { active: 0, maxActive: 0 };
    const transcoder = {
      transcodeToMp3: vi.fn(async (sourcePath: string, outputPath: string) => {
        transcodeState.active += 1;
        transcodeState.maxActive = Math.max(transcodeState.maxActive, transcodeState.active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        await copyFile(sourcePath, outputPath);
        transcodeState.active -= 1;
      }),
    };
    for (const themeId of [100, 101, 102]) {
      writeFileSync(join(mediaRoot, "audio", `${themeId}.ogg`), contents);
      repo.audio.set(themeId, { themeId, originUrl: `https://a.animethemes.moe/${themeId}.ogg`,
        state: "READY", filePath: `audio/${themeId}.ogg`, byteSize: contents.length, sha256: `source-${themeId}` });
    }
    await app.close();
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      mediaApi: new MediaStreamingService({ repo, queue, mediaRoot, musicCatalogEnabled: true,
        sonosTranscoder: transcoder } as MediaStreamingServiceDeps & { sonosTranscoder: unknown }),
    });
    const token = await bearer();

    const responses = await Promise.all([100, 101, 102].map((themeId) => app.inject({
      method: "GET", url: `/v1/media/sonos/themes/${themeId}.mp3`,
      headers: { authorization: `Bearer ${token}` },
    })));

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(transcodeState.maxActive).toBeLessThanOrEqual(2);
  });
  it.each(["GET", "HEAD"] as const)("requires bearer auth for catalog-song %s", async (method) => {
    const res = await app.inject({ method, url: "/v1/media/songs/77/audio" });
    expect(res.statusCode).toBe(401);
  });

  it("hides catalog-song audio behind MUSIC_CATALOG_ENABLED without querying storage", async () => {
    await app.close();
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      mediaApi: new MediaStreamingService({
        repo,
        queue,
        mediaRoot,
        fetch: (input, init) => mediaFetch(input, init),
        musicCatalogEnabled: false,
      }),
    });
    const token = await bearer();

    const [res, head] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v1/media/songs/77/audio",
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: "HEAD",
        url: "/v1/media/songs/77/audio",
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "MUSIC_NOT_FOUND" } });
    expect(head.statusCode).toBe(404);
    expect(repo.songLookups).toBe(0);
  });

  it.each([
    ["mp3", "audio/mpeg"],
    ["flac", "audio/flac"],
  ])("serves READY catalog-song .%s audio with its persisted content type and ranges", async (extension, contentType) => {
    const contents = Buffer.from("0123456789abcdef");
    const filePath = `audio/songs/77/original.${extension}`;
    await mkdir(join(mediaRoot, "audio", "songs", "77"), { recursive: true });
    writeFileSync(join(mediaRoot, filePath), contents);
    repo.songs.set(77, {
      songId: 77,
      state: "READY",
      filePath,
      byteSize: contents.length,
      sha256: "abc123",
      contentType,
      sourceFileName: `Theme Song.${extension}`,
    });
    const token = await bearer();

    const res = await app.inject({
      method: "GET",
      url: "/v1/media/songs/77/audio",
      headers: { authorization: `Bearer ${token}`, range: "bytes=2-5" },
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers["content-type"]).toBe(contentType);
    expect(res.headers["content-range"]).toBe("bytes 2-5/16");
    expect(res.headers.etag).toBe('"abc123"');
    expect(res.headers["content-disposition"]).toBe(
      `inline; filename*=UTF-8''Theme%20Song.${extension}`,
    );
    expect(res.body).toBe("2345");
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns HEAD metadata and rejects invalid catalog-song ranges", async () => {
    const contents = Buffer.from("0123456789abcdef");
    const filePath = "audio/songs/77/original.flac";
    await mkdir(join(mediaRoot, "audio", "songs", "77"), { recursive: true });
    writeFileSync(join(mediaRoot, filePath), contents);
    repo.songs.set(77, {
      songId: 77,
      state: "READY",
      filePath,
      byteSize: contents.length,
      sha256: "abc123",
      contentType: "audio/flac",
      sourceFileName: "Theme Song.flac",
    });
    const token = await bearer();

    const head = await app.inject({
      method: "HEAD",
      url: "/v1/media/songs/77/audio",
      headers: { authorization: `Bearer ${token}`, range: "bytes=2-5" },
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/v1/media/songs/77/audio",
      headers: { authorization: `Bearer ${token}`, range: "bytes=99-100" },
    });

    expect(head.statusCode).toBe(200);
    expect(head.headers["content-type"]).toBe("audio/flac");
    expect(head.headers["content-length"]).toBe(String(contents.length));
    expect(head.headers["content-range"]).toBeUndefined();
    expect(head.body).toBe("");
    expect(invalid.statusCode).toBe(416);
    expect(invalid.headers["content-range"]).toBe("bytes */16");
  });

  it("exposes only READY catalog-song media and reports a missing READY file", async () => {
    repo.songs.set(77, {
      songId: 77,
      state: "DOWNLOADING",
      filePath: null,
      byteSize: null,
      sha256: null,
      contentType: null,
      sourceFileName: null,
    });
    repo.songs.set(78, {
      songId: 78,
      state: "READY",
      filePath: "audio/songs/78/original.mp3",
      byteSize: 10,
      sha256: "missing",
      contentType: "audio/mpeg",
      sourceFileName: "Missing.mp3",
    });
    const token = await bearer();

    const hidden = await app.inject({
      method: "GET",
      url: "/v1/media/songs/77/audio",
      headers: { authorization: `Bearer ${token}` },
    });
    const unavailable = await app.inject({
      method: "GET",
      url: "/v1/media/songs/78/audio",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toMatchObject({ error: { code: "MUSIC_NOT_FOUND" } });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ error: { code: "MUSIC_MEDIA_UNAVAILABLE" } });
  });

  it("refuses to stream a READY path redirected outside MEDIA_ROOT by a junction", async () => {
    const escapedDirectory = mkdtempSync(join(tmpdir(), "ongaku-media-escape-"));
    extraRoots.push(escapedDirectory);
    writeFileSync(join(escapedDirectory, "original.mp3"), "must-not-stream");
    await mkdir(join(mediaRoot, "audio", "songs"), { recursive: true });
    symlinkSync(escapedDirectory, join(mediaRoot, "audio", "songs", "77"), "junction");
    repo.songs.set(77, {
      songId: 77,
      state: "READY",
      filePath: "audio/songs/77/original.mp3",
      byteSize: 15,
      sha256: "outside",
      contentType: "audio/mpeg",
      sourceFileName: "Outside.mp3",
    });
    const token = await bearer();

    const res = await app.inject({
      method: "GET",
      url: "/v1/media/songs/77/audio",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: "INTERNAL" } });
    expect(res.body).not.toContain("must-not-stream");
  });

  it("requires bearer auth for audio playback", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/media/audio/100",
      headers: { range: "bytes=2-5" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("requires bearer auth for HEAD audio metadata", async () => {
    const res = await app.inject({
      method: "HEAD",
      url: "/v1/media/audio/100",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

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
    expect(fetchCalls).toHaveLength(0);
    expect(logs).toContainEqual({
      data: {
        themeId: 100,
        state: "READY",
        method: "GET",
        range: "bytes=2-5",
        originHost: "a.animethemes.moe",
        originUrl: "https://a.animethemes.moe/Ready.ogg",
        externalHit: false,
        byteSize: contents.length,
        videoFallback: false,
      },
      message: "serving cached audio file",
    });
  });

  it("supports api-prefixed base URLs for READY audio playback", async () => {
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
    const token = await bearer("/api");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/media/audio/100",
      headers: { authorization: `Bearer ${token}`, range: "bytes=2-5" },
    });

    expect(res.statusCode).toBe(206);
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

  it("serves a video-fallback audio file as video/webm", async () => {
    const contents = Buffer.from("0123456789abcdef");
    writeFileSync(join(mediaRoot, "audio", "101.ogg"), contents);
    repo.audio.set(101, {
      themeId: 101,
      originUrl: "https://v.animethemes.moe/Fallback.webm",
      state: "READY",
      filePath: "audio/101.ogg",
      byteSize: contents.length,
      sha256: "deadbeef",
      videoFallback: true,
    });
    const token = await bearer();

    const res = await app.inject({
      method: "GET",
      url: "/v1/media/audio/101",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("video/webm");
  });

  it("streams missing audio through the server and dedupes the URGENT fetch job", async () => {
    repo.audio.set(100, {
      themeId: 100,
      originUrl: "https://a.animethemes.moe/Missing.ogg",
      state: "MISSING",
      filePath: null,
      byteSize: null,
      sha256: null,
    });
    mediaFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(Buffer.from("2345"), {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-length": "4",
          "content-range": "bytes 2-5/16",
          "content-type": "audio/ogg",
        },
      });
    };
    const token = await bearer();

    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: "/v1/media/audio/100",
        headers: { authorization: `Bearer ${token}`, range: "bytes=2-5" },
      });
      expect(res.statusCode).toBe(206);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers["accept-ranges"]).toBe("bytes");
      expect(res.headers["content-range"]).toBe("bytes 2-5/16");
      expect(res.headers["content-type"]).toBe("audio/ogg");
      expect(res.body).toBe("2345");
    }

    expect(fetchCalls).toHaveLength(2);
    expect(String(fetchCalls[0]!.input)).toBe("https://a.animethemes.moe/Missing.ogg");
    expect(headersOf(fetchCalls[0]!.init?.headers).get("range")).toBe("bytes=2-5");
    expect(logs).toContainEqual({
      data: {
        themeId: 100,
        state: "MISSING",
        method: "GET",
        range: "bytes=2-5",
        originHost: "a.animethemes.moe",
        originUrl: "https://a.animethemes.moe/Missing.ogg",
        externalHit: true,
      },
      message: "external audio origin request",
    });
    const queued = await queue.list("QUEUED");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: "FETCH_AUDIO",
      priority: JobPriority.URGENT,
      payload: { themeId: 100 },
      dedupeKey: "FETCH_AUDIO:100",
    });
  });

  it("does not re-fetch already-cached audio on explicit request", async () => {
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
      method: "POST",
      url: "/v1/media/audio/100/request",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ themeId: 100, audioState: "READY", jobId: 0 });
    expect(await queue.list("QUEUED")).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it("re-warms READY audio when the cached file is missing on disk", async () => {
    repo.audio.set(100, {
      themeId: 100,
      originUrl: "https://a.animethemes.moe/Ready.ogg",
      state: "READY",
      filePath: "audio/missing.ogg",
      byteSize: 16,
      sha256: "abc123",
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
      type: "FETCH_AUDIO",
      priority: JobPriority.HIGH,
      payload: { themeId: 100 },
      dedupeKey: "FETCH_AUDIO:100",
    });
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns a stable failure for FAILED audio without re-hitting the origin", async () => {
    repo.audio.set(100, {
      themeId: 100,
      originUrl: "https://a.animethemes.moe/Failed.ogg",
      state: "FAILED",
      filePath: null,
      byteSize: null,
      sha256: null,
    });
    mediaFetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return new Response(Buffer.from("blocked"), {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    };
    const token = await bearer();

    const res = await app.inject({
      method: "GET",
      url: "/v1/media/audio/100",
      headers: { authorization: `Bearer ${token}`, range: "bytes=0-" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: "AUDIO_UNAVAILABLE",
        message: "Audio is currently unavailable after a failed cache fetch.",
      },
    });
    expect(fetchCalls).toHaveLength(0);
    expect(await queue.list("QUEUED")).toHaveLength(0);
  });

  it("does not reset the failed fetch loop on explicit audio request", async () => {
    repo.audio.set(100, {
      themeId: 100,
      originUrl: "https://a.animethemes.moe/Failed.ogg",
      state: "FAILED",
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
    expect(res.json()).toEqual({ themeId: 100, audioState: "FAILED", jobId: 0 });
    expect(await queue.list("QUEUED")).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
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

  it("proxies missing image media without requiring bearer auth and queues a cache fetch", async () => {
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

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.body).toBe("jpeg-bytes");
    expect(logs).toContainEqual({
      data: {
        kind: "ANIME_COVER",
        refId: "123",
        originHost: "media.kitsu.test",
        originUrl: "https://media.kitsu.test/anime-cover.jpg",
        externalHit: true,
      },
      message: "external image origin request",
    });
    // A client is actively waiting on the image, so the cache fetch is urgent —
    // it must jump ahead of background hydration.
    expect((await queue.list("QUEUED"))[0]).toMatchObject({
      type: "FETCH_IMAGE",
      priority: JobPriority.URGENT,
      payload: { kind: "ANIME_COVER", refId: "123" },
      dedupeKey: "FETCH_IMAGE:ANIME_COVER:123",
    });
  });
});

function headersOf(headers: HeadersInit | undefined): Headers {
  return new Headers(headers);
}
