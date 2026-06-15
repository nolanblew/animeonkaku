import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import type { StatusDashboardService } from "../src/status/statusRoutes.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-test-"));

const statusPayload = {
  generatedAt: 1_700_000_000_000,
  disk: {
    mediaRoot: "C:\\ongaku\\media",
    totalBytes: 1000,
    freeBytes: 250,
    usedBytes: 750,
    availablePercent: 25,
  },
  mediaStorage: {
    totalBytes: 420,
    fileCount: 6,
    byDirectory: [
      { name: "audio", bytes: 300, fileCount: 3 },
      { name: "images", bytes: 120, fileCount: 3 },
    ],
    byExtension: [
      { extension: ".ogg", bytes: 300, fileCount: 3 },
      { extension: ".jpg", bytes: 120, fileCount: 3 },
    ],
  },
  catalog: {
    users: 2,
    anime: 10,
    songs: 42,
    artists: 15,
    playlists: 5,
    mediaFiles: 60,
    readyMediaFiles: 48,
    images: 18,
    audio: 40,
    video: 2,
  },
  mediaByKind: [
    { kind: "AUDIO", total: 40, ready: 36, bytes: 300 },
    { kind: "ANIME_POSTER", total: 18, ready: 12, bytes: 120 },
  ],
};

class FakeStatusService implements StatusDashboardService {
  async getStatus() {
    return statusPayload;
  }
}

let app: FastifyInstance;

beforeEach(() => {
  app = buildApp({
    authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    status: new FakeStatusService(),
  });
});

afterEach(async () => {
  await app.close();
});

describe("status dashboard routes", () => {
  it("returns JSON status stats", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/status" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      disk: {
        mediaRoot: "C:\\ongaku\\media",
        freeBytes: 250,
        availablePercent: 25,
      },
      mediaStorage: {
        totalBytes: 420,
        fileCount: 6,
      },
      catalog: {
        songs: 42,
        images: 18,
        readyMediaFiles: 48,
      },
    });
    expect(res.json().mediaStorage.byDirectory).toEqual(
      expect.arrayContaining([{ name: "audio", bytes: 300, fileCount: 3 }]),
    );
    expect(res.json().mediaByKind).toEqual(
      expect.arrayContaining([{ kind: "AUDIO", total: 40, ready: 36, bytes: 300 }]),
    );
  });

  it("renders an operator dashboard", async () => {
    const res = await app.inject({ method: "GET", url: "/status" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Anime Ongaku Server Status");
    expect(res.body).toContain("Disk Available");
    expect(res.body).toContain("Songs");
    expect(res.body).toContain("42");
    expect(res.body).toContain("Media Storage");
    expect(res.body).toContain("audio");
  });
});
