import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

describe("comprehensive admin dashboard", () => {
  let app: FastifyInstance;
  const settings = {
    getSettings: vi.fn(),
    updateMode: vi.fn(),
  };
  const dashboard = {
    overview: vi.fn(),
    listUsers: vi.fn(),
    listAnime: vi.fn(),
    listSongs: vi.fn(),
    listLogs: vi.fn(),
    listRequests: vi.fn(),
    listJobs: vi.fn(),
    syncUser: vi.fn(),
    revokeUserSessions: vi.fn(),
    refreshAnime: vi.fn(),
    requestAnimeMusic: vi.fn(),
    refreshThemeMedia: vi.fn(),
    removeThemeMedia: vi.fn(),
    removeMedia: vi.fn(),
    clearCache: vi.fn(),
    retryJob: vi.fn(),
    operateBatch: vi.fn(),
  };

  beforeEach(() => {
    settings.getSettings.mockResolvedValue({ mode: "MANUAL", updatedAt: "2026-07-28T12:00:00.000Z" });
    settings.updateMode.mockImplementation(async (mode: string) => ({ mode, updatedAt: "2026-07-28T12:01:00.000Z" }));
    dashboard.overview.mockResolvedValue({
      counts: { users: 2, anime: 12, themes: 24, songs: 8, activeJobs: 3, failedJobs: 1 },
      storage: { totalBytes: 1500, tvSongsBytes: 500, fullSongsBytes: 700, artworkBytes: 200, cacheBytes: 100 },
    });
    dashboard.listUsers.mockResolvedValue([{ id: "7", username: "nolan", authState: "OK", sessionCount: 2 }]);
    dashboard.listAnime.mockResolvedValue([{ kitsuId: "1", title: "Toradora!", mapped: true, themeCount: 4, tvReady: 3, fullReady: 1 }]);
    dashboard.listSongs.mockResolvedValue([{ id: 9, title: "Pre-Parade", artist: "Rie Kugimiya", mediaState: "READY", byteSize: 700 }]);
    dashboard.listLogs.mockReturnValue([{ id: 1, level: "INFO", message: "server started", time: "2026-07-28T12:00:00.000Z", data: {} }]);
    dashboard.listRequests.mockResolvedValue([]);
    dashboard.listJobs.mockResolvedValue([]);
    dashboard.syncUser.mockResolvedValue({ queued: true });
    dashboard.revokeUserSessions.mockResolvedValue({ revoked: 2 });
    dashboard.refreshAnime.mockResolvedValue({ queued: true });
    dashboard.requestAnimeMusic.mockResolvedValue({ requestId: "request-1", replayed: false });
    dashboard.refreshThemeMedia.mockResolvedValue({ queued: 3 });
    dashboard.removeThemeMedia.mockResolvedValue({ removedFiles: 3, removedBytes: 1500 });
    dashboard.removeMedia.mockResolvedValue({ removedFiles: 1, removedBytes: 500 });
    dashboard.clearCache.mockResolvedValue({ removedFiles: 2, removedBytes: 300 });
    dashboard.retryJob.mockResolvedValue({ queued: true });
    dashboard.operateBatch.mockResolvedValue({ queued: true });

    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot: process.cwd() },
      musicSearchSettings: settings,
      adminDashboard: dashboard,
      adminPassword: "Password123",
    });
  });

  afterEach(async () => { vi.clearAllMocks(); await app.close(); });

  async function cookie() {
    const login = await app.inject({ method: "POST", url: "/admin/login", payload: { password: "Password123" } });
    return login.headers["set-cookie"]!.split(";")[0]!;
  }

  it("renders a navigable operations dashboard", async () => {
    const response = await app.inject({ method: "GET", url: "/admin", headers: { cookie: await cookie() } });
    expect(response.statusCode).toBe(200);
    for (const label of ["Overview", "Users", "Anime", "Songs", "Requests", "Jobs", "Logs", "Storage & cache"]) {
      expect(response.body).toContain(label);
    }
  });

  it("protects and serves dashboard projections", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/overview" })).statusCode).toBe(401);
    const headers = { cookie: await cookie() };
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/overview", headers })).json().storage.fullSongsBytes).toBe(700);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/users?q=nol", headers })).json().users[0].username).toBe("nolan");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/anime?q=tora", headers })).json().anime[0].themeCount).toBe(4);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/songs?q=parade", headers })).json().songs[0].mediaState).toBe("READY");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/logs?level=INFO", headers })).json().logs[0].message).toBe("server started");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/logs?level=", headers })).statusCode).toBe(200);
    expect(dashboard.listUsers).toHaveBeenCalledWith({ query: "nol", limit: 100 });
  });

  it("offers explicit user, anime, media, and cache operations", async () => {
    const headers = { cookie: await cookie() };
    const cases: Array<[string, string, unknown, keyof typeof dashboard]> = [
      ["POST", "/api/v1/admin/users/7/sync", undefined, "syncUser"],
      ["DELETE", "/api/v1/admin/users/7/sessions", undefined, "revokeUserSessions"],
      ["POST", "/api/v1/admin/anime/1/refresh", undefined, "refreshAnime"],
      ["POST", "/api/v1/admin/anime/1/music-requests", undefined, "requestAnimeMusic"],
      ["POST", "/api/v1/admin/anime/1/tv-media/refresh", undefined, "refreshThemeMedia"],
      ["DELETE", "/api/v1/admin/anime/1/tv-media", undefined, "removeThemeMedia"],
      ["DELETE", "/api/v1/admin/media/AUDIO/9/ORIGINAL", undefined, "removeMedia"],
      ["DELETE", "/api/v1/admin/cache?category=artwork", undefined, "clearCache"],
    ];
    for (const [method, url, payload, call] of cases) {
      const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
      expect(response.statusCode, `${method} ${url}: ${response.body}`).toBe(202);
      expect(dashboard[call]).toHaveBeenCalled();
    }
  });

  it("rejects malformed destructive media targets", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/media/NOT_MEDIA/9/ORIGINAL",
      headers: { cookie: await cookie() },
    });
    expect(response.statusCode).toBe(400);
    expect(dashboard.removeMedia).not.toHaveBeenCalled();
  });
});
