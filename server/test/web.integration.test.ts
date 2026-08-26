import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import type { UserProfileApi } from "../src/auth/profile.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import type { ClientApiService } from "../src/api/clientRoutes.js";
import { LiveLibraryHub } from "../src/web/liveRoutes.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-web-integration-"));

const home = {
  async getHome() {
    return {
      serverTime: 1,
      continueWatching: [],
      recentlyAdded: [],
      playlists: [],
      nextCursor: null,
    };
  },
};

function profileApi(): UserProfileApi {
  return {
    getProfile: vi.fn(async () => ({ displayName: null, avatarPath: null })),
    updateDisplayName: vi.fn(async () => ({ displayName: "Nolan", avatarPath: null })),
    saveAvatar: vi.fn(async () => ({ displayName: null, avatarPath: null })),
    removeAvatar: vi.fn(async () => ({ displayName: null, avatarPath: null })),
    readAvatar: vi.fn(async () => null),
  };
}

function clientApi(): ClientApiService {
  return {
    getLibrary: vi.fn(),
    getChanges: vi.fn(),
    getAnime: vi.fn(),
    getAnimeMusic: vi.fn(),
    getMusicRelease: vi.fn(),
    getMusicCatalog: vi.fn(),
    searchMusic: vi.fn(),
    ensureLibraryForUserData: vi.fn(async () => false),
    ensureLibraryForThemeIds: vi.fn(async () => false),
    addLibraryAnime: vi.fn(async () => ({ accepted: true, queuedJobIds: [] })),
    removeLibraryAnime: vi.fn(async () => true),
    getThemePrefs: vi.fn(),
    updateThemePref: vi.fn(async () => ({ themeId: 1, liked: true })),
    getSongPrefs: vi.fn(),
    updateSongPref: vi.fn(async () => ({ songId: 1, liked: true })),
    deleteSongPref: vi.fn(async () => true),
    refreshAutoPlaylists: vi.fn(async () => {}),
    recordPlays: vi.fn(async () => ({ accepted: 1 })),
    listPlaylists: vi.fn(async () => []),
    createPlaylist: vi.fn(async () => ({ id: 1, name: "New" })),
    updatePlaylist: vi.fn(async () => ({ id: 1, name: "Updated" })),
    updatePlaylistSpec: vi.fn(async () => ({ id: 1, name: "Updated" })),
    deletePlaylist: vi.fn(async () => true),
  } as unknown as ClientApiService;
}

function cookieFrom(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("response did not set a cookie");
  return first.split(";", 1)[0]!;
}

describe("production web route integration", () => {
  let app: FastifyInstance;
  let hub: LiveLibraryHub;
  let client: ClientApiService;

  beforeEach(() => {
    hub = new LiveLibraryHub({ heartbeatMs: 0 });
    vi.spyOn(hub, "publish");
    client = clientApi();
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      webAuth: { profile: profileApi(), secureCookies: false },
      webLive: { hub, home },
      clientApi: client,
    } as Parameters<typeof buildApp>[0]);
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves live and home only under /api and authenticates them with the browser cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/library/live" })).statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost" },
      payload: { username: "nolan", password: "hunter2" },
    });
    const cookie = cookieFrom(login);

    const homeResponse = await app.inject({ method: "GET", url: "/api/v1/home", headers: { cookie } });
    expect(homeResponse.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/home", headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/library/live", headers: { cookie } })).statusCode).toBe(404);
  });

  it("publishes canonical categories only after successful cookie-authenticated mutations", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost" },
      payload: { username: "nolan", password: "hunter2" },
    });
    const cookie = cookieFrom(login);

    const profile = await app.inject({
      method: "PATCH",
      url: "/api/auth/profile",
      headers: { cookie, origin: "http://localhost" },
      payload: { displayName: "Nolan" },
    });
    expect(profile.statusCode).toBe(200);

    const library = await app.inject({
      method: "POST",
      url: "/api/v1/library/anime",
      headers: { cookie, origin: "http://localhost" },
      payload: { kitsuId: "1" },
    });
    expect(library.statusCode).toBe(200);

    const playlist = await app.inject({
      method: "POST",
      url: "/api/v1/playlists",
      headers: { cookie, origin: "http://localhost" },
      payload: { name: "New" },
    });
    expect(playlist.statusCode).toBe(201);

    expect(hub.publish).toHaveBeenCalledTimes(3);
    expect(hub.publish).toHaveBeenNthCalledWith(1, "stub-nolan", ["profile"]);
    expect(hub.publish).toHaveBeenNthCalledWith(2, "stub-nolan", ["library"]);
    expect(hub.publish).toHaveBeenNthCalledWith(3, "stub-nolan", ["playlist"]);

    const failed = await app.inject({
      method: "PATCH",
      url: "/api/auth/profile",
      headers: { cookie, origin: "http://localhost" },
      payload: {},
    });
    expect(failed.statusCode).toBe(400);
    expect(hub.publish).toHaveBeenCalledTimes(3);
  });
});
