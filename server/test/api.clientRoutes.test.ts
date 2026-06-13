import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import type {
  ClientApiService,
  LibraryResponse,
  PlaylistCreateInput,
  PlaylistInput,
  ThemePrefPatch,
} from "../src/api/clientRoutes.js";
import type { SyncApiService } from "../src/api/syncRoutes.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-test-"));

class FakeClientApi implements ClientApiService {
  libraryCalls: Array<{ userId: string; since: number | null }> = [];
  prefs = new Map<number, { liked: boolean; disliked: boolean; playCount: number; lastPlayedAt: number | null }>();
  playlists = new Map<number, {
    id: number;
    name: string;
    entries: number[];
    isAuto: boolean;
    updatedAt: number;
    dynamicSpecJson: unknown | null;
  }>();
  private nextPlaylistId = 1;

  async getLibrary(userId: string, since: number | null): Promise<LibraryResponse> {
    this.libraryCalls.push({ userId, since });
    return {
      serverTime: 1_760_000_000_000,
      anime: [
        {
          kitsuId: "1",
          animeThemesId: 10,
          title: "Bocchi the Rock!",
          titleEn: "Bocchi the Rock!",
          titleRomaji: null,
          titleJa: null,
          posterUrl: "/v1/media/images/anime/1/poster",
          coverUrl: null,
          watchingStatus: "current",
          subtype: "TV",
          startDate: "2022-10-09",
          endDate: null,
          episodeCount: 12,
          ageRating: "PG",
          averageRating: 8.7,
          userRating: 9,
          libraryUpdatedAt: 1_758_000_000_000,
          slug: "bocchi-the-rock",
          genres: ["music"],
          updatedAt: 1_759_000_000_000,
          deleted: false,
        },
        {
          kitsuId: "gone",
          animeThemesId: null,
          title: null,
          titleEn: null,
          titleRomaji: null,
          titleJa: null,
          posterUrl: null,
          coverUrl: null,
          watchingStatus: null,
          subtype: null,
          startDate: null,
          endDate: null,
          episodeCount: null,
          ageRating: null,
          averageRating: null,
          userRating: null,
          libraryUpdatedAt: null,
          slug: null,
          genres: [],
          updatedAt: 1_759_500_000_000,
          deleted: true,
        },
      ],
      themes: [
        {
          id: 100,
          animeThemesAnimeId: 10,
          kitsuAnimeIds: ["1"],
          title: "Seishun Complex",
          themeType: "OP1",
          artists: [{ name: "Kessoku Band", asCharacter: null, alias: null }],
          audioUrl: "/v1/media/audio/100",
          videoUrl: null,
          audioState: "READY",
          durationSeconds: 90,
          fileSize: 5_242_880,
          updatedAt: 1_759_000_000_000,
          deleted: false,
        },
      ],
    };
  }

  async getAnime(userId: string, kitsuId: string) {
    const library = await this.getLibrary(userId, null);
    const anime = library.anime.find((item) => item.kitsuId === kitsuId && !item.deleted);
    return anime ? { anime, themes: library.themes } : null;
  }

  async addLibraryAnime(_userId: string, _input: { kitsuId?: string; animeThemesId?: number }) {
    return { accepted: true, queuedJobIds: [7] };
  }

  async removeLibraryAnime(_userId: string, kitsuId: string) {
    return kitsuId === "1";
  }

  async getThemePrefs(_userId: string) {
    return [...this.prefs.entries()].map(([themeId, pref]) => ({ themeId, ...pref }));
  }

  async updateThemePref(_userId: string, themeId: number, patch: ThemePrefPatch) {
    const current = this.prefs.get(themeId) ?? {
      liked: false,
      disliked: false,
      playCount: 0,
      lastPlayedAt: null,
    };
    const updated = { ...current, ...patch };
    this.prefs.set(themeId, updated);
    return { themeId, ...updated };
  }

  async recordPlays(_userId: string, plays: Array<{ themeId: number; playedAt: number }>) {
    for (const play of plays) {
      const current = this.prefs.get(play.themeId) ?? {
        liked: false,
        disliked: false,
        playCount: 0,
        lastPlayedAt: null,
      };
      this.prefs.set(play.themeId, {
        ...current,
        playCount: current.playCount + 1,
        lastPlayedAt: Math.max(current.lastPlayedAt ?? 0, play.playedAt),
      });
    }
    return { accepted: plays.length };
  }

  async listPlaylists(_userId: string, options: { autoOnly?: boolean } = {}) {
    return [...this.playlists.values()].filter((playlist) => !options.autoOnly || playlist.isAuto);
  }

  async createPlaylist(_userId: string, input: PlaylistCreateInput) {
    const playlist = {
      id: this.nextPlaylistId++,
      name: input.name,
      entries: input.entries ?? [],
      isAuto: false,
      updatedAt: Date.now(),
      dynamicSpecJson: input.dynamicSpecJson ?? null,
    };
    this.playlists.set(playlist.id, playlist);
    return playlist;
  }

  async updatePlaylist(_userId: string, id: number, input: PlaylistInput) {
    const existing = this.playlists.get(id);
    if (!existing || existing.isAuto) return null;
    const updated = {
      ...existing,
      name: input.name ?? existing.name,
      entries: input.entries ?? existing.entries,
      dynamicSpecJson: input.dynamicSpecJson ?? existing.dynamicSpecJson,
      updatedAt: Date.now(),
    };
    this.playlists.set(id, updated);
    return updated;
  }

  async updatePlaylistSpec(_userId: string, id: number, spec: unknown) {
    const existing = this.playlists.get(id);
    if (!existing || existing.isAuto) return null;
    const updated = { ...existing, dynamicSpecJson: spec, updatedAt: Date.now() };
    this.playlists.set(id, updated);
    return updated;
  }

  async deletePlaylist(_userId: string, id: number) {
    const existing = this.playlists.get(id);
    if (!existing || existing.isAuto) return false;
    this.playlists.delete(id);
    return true;
  }
}

class FakeSyncApi implements SyncApiService {
  enqueued: Array<{ userId: string; full: boolean }> = [];

  async enqueueSync(userId: string, full: boolean) {
    this.enqueued.push({ userId, full });
    return { jobId: 99 };
  }

  async getStatus(_userId: string) {
    return {
      state: "RUNNING",
      phase: "MAPPING_THEMES",
      progress: { mapped: 3 },
      lastCompletedAt: 123,
      unmatched: ["Unknown Show"],
    };
  }
}

let app: FastifyInstance;
let clientApi: FakeClientApi;
let syncApi: FakeSyncApi;

beforeEach(() => {
  clientApi = new FakeClientApi();
  syncApi = new FakeSyncApi();
  app = buildApp({
    authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    clientApi,
    syncApi,
  });
});

afterEach(async () => {
  await app.close();
});

async function bearer() {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username: "nolan", password: "hunter2" },
  });
  return res.json().token as string;
}

describe("client API routes", () => {
  it("requires bearer auth for the library feed", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/library" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the authenticated user's delta library feed", async () => {
    const token = await bearer();
    const res = await app.inject({
      method: "GET",
      url: "/v1/library?since=1759000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(clientApi.libraryCalls).toEqual([{ userId: "stub-nolan", since: 1_759_000_000_000 }]);
    expect(res.json()).toMatchObject({
      serverTime: 1_760_000_000_000,
      anime: [{ kitsuId: "1", deleted: false }, { kitsuId: "gone", deleted: true }],
      themes: [{ id: 100, audioState: "READY", audioUrl: "/v1/media/audio/100" }],
    });
  });

  it("records plays additively while prefs stay last-write-wins", async () => {
    const token = await bearer();
    await app.inject({
      method: "PUT",
      url: "/v1/prefs/themes/100",
      headers: { authorization: `Bearer ${token}` },
      payload: { liked: true },
    });
    await app.inject({
      method: "POST",
      url: "/v1/plays",
      headers: { authorization: `Bearer ${token}` },
      payload: [
        { themeId: 100, playedAt: 10 },
        { themeId: 100, playedAt: 20 },
      ],
    });
    await app.inject({
      method: "POST",
      url: "/v1/plays",
      headers: { authorization: `Bearer ${token}` },
      payload: [{ themeId: 100, playedAt: 15 }],
    });

    const prefs = await app.inject({
      method: "GET",
      url: "/v1/prefs/themes",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(prefs.statusCode).toBe(200);
    expect(prefs.json()).toEqual([
      { themeId: 100, liked: true, disliked: false, playCount: 3, lastPlayedAt: 20 },
    ]);
  });

  it("creates, updates, stores specs, and deletes manual playlists", async () => {
    const token = await bearer();
    const created = await app.inject({
      method: "POST",
      url: "/v1/playlists",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Road Trip", entries: [100, 101] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().playlist).toMatchObject({ id: 1, name: "Road Trip", entries: [100, 101] });

    const updated = await app.inject({
      method: "PUT",
      url: "/v1/playlists/1/spec",
      headers: { authorization: `Bearer ${token}` },
      payload: { rules: [{ field: "liked", value: true }] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().playlist.dynamicSpecJson).toEqual({
      rules: [{ field: "liked", value: true }],
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/playlists/1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("enqueues manual sync and returns status progress", async () => {
    const token = await bearer();
    const sync = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: `Bearer ${token}` },
      payload: { full: true },
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toEqual({ jobId: 99 });
    expect(syncApi.enqueued).toEqual([{ userId: "stub-nolan", full: true }]);

    const status = await app.inject({
      method: "GET",
      url: "/v1/sync/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ state: "RUNNING", phase: "MAPPING_THEMES" });
  });
});
