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
  PlayInput,
} from "../src/api/clientRoutes.js";
import type { SyncApiService } from "../src/api/syncRoutes.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-test-"));

class FakeClientApi implements ClientApiService {
  libraryCalls: Array<{ userId: string; since: number | null }> = [];
  ensureUserDataCalls: string[] = [];
  ensureThemeCalls: Array<{ userId: string; themeIds: number[] }> = [];
  autoRefreshes: string[] = [];
  events: string[] = [];
  prefs = new Map<number, { liked: boolean; disliked: boolean; dislikedTvSize: boolean; dislikedFullSize: boolean; playCount: number; lastPlayedAt: number | null }>();
  songPrefs = new Map<number, { liked: boolean; disliked: boolean; playCount: number; lastPlayedAt: number | null }>();
  recordedPlays: PlayInput[] = [];
  playlists = new Map<number, {
    id: number;
    name: string;
    entries: number[];
    defaultMode: "TV_SIZE" | "FULL_SIZE";
    items: Array<{ entryId: number; itemType: "THEME" | "SONG"; itemId: number; modeOverride: "TV_SIZE" | "FULL_SIZE" | null }>;
    isAuto: boolean;
    isDynamic: boolean;
    autoUpdate: boolean;
    updatedAt: number;
    deleted: boolean;
    dynamicSpecJson: unknown | null;
    dynamicSortJson: unknown | null;
  }>();
  deletedPlaylistCalls: Array<{ userId: string; id: number; opTs: number | null }> = [];
  private nextPlaylistId = 1;

  async getAnimeMusic(_userId: string, kitsuId: string) {
    if (kitsuId !== "1") return null;
    return {
      anime: { kitsuId: "1", title: "Bocchi the Rock!", titleEn: "Bocchi the Rock!", posterUrl: null },
      releases: [{
        id: 200,
        title: "Bocchi the Rock! Original Soundtrack",
        artistCredit: "Tomoki Kikuya",
        relationshipType: "SOUNDTRACK",
        releaseDate: "2022-12-28",
        artworkUrl: "https://example.invalid/ost.jpg",
        tracks: [{ id: 300, title: "Rockn' Roll, Morning Light Falls on You", artistCredit: "Kessoku Band", durationSeconds: 271, audioUrl: "/v1/media/songs/300/audio", fileSize: 1234 }],
      }],
    };
  }

  async getMusicRelease(_userId: string, releaseId: number) {
    const result = await this.getAnimeMusic(_userId, "1");
    return releaseId === 200 ? result!.releases[0]! : null;
  }

  async getMusicCatalog(_userId: string) {
    const result = await this.getAnimeMusic(_userId, "1");
    return result ? [result] : [];
  }

  async searchMusic(_userId: string, query: string) {
    const tracks = query.toLowerCase().includes("kessoku")
      ? [{ anime: { kitsuId: "1", title: "Bocchi the Rock!", titleEn: "Bocchi the Rock!", posterUrl: null }, releaseId: 200, releaseTitle: "Bocchi the Rock! Original Soundtrack", track: { id: 300, title: "Rockn' Roll, Morning Light Falls on You", artistCredit: "Kessoku Band", durationSeconds: 271, audioUrl: "/v1/media/songs/300/audio", fileSize: 1234 } }]
      : [];
    return { releases: [], tracks };
  }

  private prefDto(themeId: number, pref: { liked: boolean; disliked: boolean; dislikedTvSize: boolean; dislikedFullSize: boolean; playCount: number; lastPlayedAt: number | null }) {
    return { themeId, ...pref, updatedAt: 1, deleted: false };
  }

  async getLibrary(userId: string, since: number | null): Promise<LibraryResponse> {
    this.events.push("library");
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
          mediaModes: {
            tvSize: { url: "/v1/media/audio/100", durationSeconds: 90, fileSize: 5_242_880 },
            fullSize: { songId: 300, url: "/v1/media/songs/300/audio", durationSeconds: 271, fileSize: 1234, sourceReleaseId: 200 },
            video: { url: "https://example.invalid/op.webm", mimeType: "video/webm", spoiler: false, nsfw: false, entryVersion: 1 },
          },
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

  async getThemePrefs(_userId: string, _since: number | null = null) {
    return [...this.prefs.entries()].map(([themeId, pref]) => this.prefDto(themeId, pref));
  }

  async getChanges(userId: string, since: number | null) {
    this.events.push("changes");
    const library = await this.getLibrary(userId, since);
    return {
      serverTime: library.serverTime,
      anime: library.anime,
      themes: library.themes,
      prefs: await this.getThemePrefs(userId, since),
      songPrefs: await this.getSongPrefs(userId, since),
      playlists: await this.listPlaylists(userId, { since }),
      musicCatalog: await this.getMusicCatalog(userId),
    };
  }

  async updateThemePref(_userId: string, themeId: number, patch: ThemePrefPatch) {
    this.events.push("pref");
    const current = this.prefs.get(themeId) ?? {
      liked: false,
      disliked: false,
      dislikedTvSize: false,
      dislikedFullSize: false,
      playCount: 0,
      lastPlayedAt: null,
    };
    const { opTs: _opTs, ...prefPatch } = patch;
    const updated = { ...current, ...prefPatch };
    if (patch.liked) Object.assign(updated, { disliked: false, dislikedTvSize: false, dislikedFullSize: false });
    if (patch.disliked) Object.assign(updated, { liked: false, dislikedTvSize: false, dislikedFullSize: false });
    if (patch.dislikedTvSize) Object.assign(updated, { liked: false, disliked: false });
    if (patch.dislikedFullSize) Object.assign(updated, { liked: false, disliked: false });
    this.prefs.set(themeId, updated);
    return this.prefDto(themeId, updated);
  }

  async getSongPrefs(_userId: string, _since: number | null = null) {
    return [...this.songPrefs.entries()].map(([songId, pref]) => ({ songId, ...pref, updatedAt: 1, deleted: false }));
  }

  async updateSongPref(_userId: string, songId: number, patch: { liked?: boolean; disliked?: boolean; opTs?: number }) {
    const current = this.songPrefs.get(songId) ?? { liked: false, disliked: false, playCount: 0, lastPlayedAt: null };
    const next = { ...current, liked: patch.liked ?? current.liked, disliked: patch.disliked ?? current.disliked };
    if (patch.liked) next.disliked = false;
    if (patch.disliked) next.liked = false;
    this.songPrefs.set(songId, next);
    return { songId, ...next, updatedAt: 1, deleted: false };
  }

  async deleteSongPref(_userId: string, songId: number, _opTs?: number | null) {
    return this.songPrefs.delete(songId);
  }

  async refreshAutoPlaylists(userId: string) {
    this.events.push("refresh");
    this.autoRefreshes.push(userId);
    const likedThemeIds = [...this.prefs.entries()]
      .filter(([, pref]) => pref.liked)
      .map(([themeId]) => themeId);
    const existing = [...this.playlists.values()].find((playlist) => playlist.name === "Liked Songs");
    const playlist = {
      id: existing?.id ?? this.nextPlaylistId++,
      name: "Liked Songs",
      entries: likedThemeIds,
      defaultMode: existing?.defaultMode ?? "TV_SIZE" as const,
      items: likedThemeIds.map((itemId, index) => ({ entryId: index + 1, itemType: "THEME" as const, itemId, modeOverride: null })),
      isAuto: true,
      isDynamic: false,
      autoUpdate: true,
      updatedAt: Date.now(),
      deleted: false,
      dynamicSpecJson: null,
      dynamicSortJson: null,
    };
    this.playlists.set(playlist.id, playlist);
  }

  async recordPlays(_userId: string, plays: PlayInput[]) {
    this.events.push("plays");
    this.recordedPlays.push(...plays);
    for (const play of plays) {
      const themeId = "themeId" in play ? play.themeId : play.itemType === "THEME" ? play.itemId : null;
      if (themeId === null) {
        const current = this.songPrefs.get(play.itemId) ?? { liked: false, disliked: false, playCount: 0, lastPlayedAt: null };
        this.songPrefs.set(play.itemId, { ...current, playCount: current.playCount + 1, lastPlayedAt: Math.max(current.lastPlayedAt ?? 0, play.playedAt) });
        continue;
      }
      const current = this.prefs.get(themeId) ?? {
        liked: false,
        disliked: false,
        dislikedTvSize: false,
        dislikedFullSize: false,
        playCount: 0,
        lastPlayedAt: null,
      };
      this.prefs.set(themeId, {
        ...current,
        playCount: current.playCount + 1,
        lastPlayedAt: Math.max(current.lastPlayedAt ?? 0, play.playedAt),
      });
    }
    return { accepted: plays.length };
  }

  async listPlaylists(_userId: string, options: { autoOnly?: boolean; since?: number | null } = {}) {
    this.events.push("playlists");
    return [...this.playlists.values()].filter((playlist) => !options.autoOnly || playlist.isAuto);
  }

  async createPlaylist(_userId: string, input: PlaylistCreateInput) {
    this.events.push("create-playlist");
    const isDynamic = input.dynamicSpecJson !== undefined && input.dynamicSpecJson !== null;
    const inputItems = input.items ?? (input.entries ?? []).map((itemId) => ({ itemType: "THEME" as const, itemId, modeOverride: null }));
    const items = inputItems.map((item, index) => ({ ...item, entryId: index + 1, modeOverride: item.modeOverride ?? null }));
    const playlist = {
      id: this.nextPlaylistId++,
      name: input.name,
      entries: items.flatMap((item) => item.itemType === "THEME" ? [item.itemId] : []),
      defaultMode: input.defaultMode ?? "TV_SIZE",
      items,
      isAuto: false,
      isDynamic,
      autoUpdate: input.autoUpdate ?? true,
      updatedAt: Date.now(),
      deleted: false,
      dynamicSpecJson: input.dynamicSpecJson ?? null,
      dynamicSortJson: input.dynamicSortJson ?? null,
    };
    this.playlists.set(playlist.id, playlist);
    return playlist;
  }

  async updatePlaylist(_userId: string, id: number, input: PlaylistInput) {
    this.events.push("update-playlist");
    const existing = this.playlists.get(id);
    if (!existing || existing.isAuto) return null;
    const inputItems = input.items ?? (input.entries === undefined ? undefined : input.entries.map((itemId) => ({ itemType: "THEME" as const, itemId, modeOverride: null })));
    const items = inputItems?.map((item, index) => ({ ...item, entryId: index + 1, modeOverride: item.modeOverride ?? null })) ?? existing.items;
    const updated = {
      ...existing,
      name: input.name ?? existing.name,
      entries: items.flatMap((item) => item.itemType === "THEME" ? [item.itemId] : []),
      defaultMode: input.defaultMode ?? existing.defaultMode,
      items,
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

  async deletePlaylist(userId: string, id: number, opTs: number | null = null) {
    this.deletedPlaylistCalls.push({ userId, id, opTs });
    const existing = this.playlists.get(id);
    if (!existing || existing.isAuto) return false;
    this.playlists.delete(id);
    return true;
  }

  async ensureLibraryForUserData(userId: string) {
    this.events.push("ensure-user-data");
    this.ensureUserDataCalls.push(userId);
    return true;
  }

  async ensureLibraryForThemeIds(userId: string, themeIds: number[]) {
    this.events.push(`ensure-themes:${themeIds.join(",")}`);
    this.ensureThemeCalls.push({ userId, themeIds });
    return themeIds.length > 0;
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
      mapping: { state: "RUNNING", lastError: null },
      upstreamBlocked: false,
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

  it("repairs library membership from existing user data before returning a resync snapshot", async () => {
    const token = await bearer();

    const res = await app.inject({
      method: "GET",
      url: "/v1/changes",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(clientApi.ensureUserDataCalls).toEqual(["stub-nolan"]);
    expect(clientApi.autoRefreshes).toEqual(["stub-nolan"]);
    expect(clientApi.events.slice(0, 3)).toEqual(["ensure-user-data", "refresh", "changes"]);
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
      { themeId: 100, liked: true, disliked: false, dislikedTvSize: false, dislikedFullSize: false, playCount: 3, lastPlayedAt: 20, updatedAt: 1, deleted: false },
    ]);
  });

  it("round-trips mode-specific theme reactions and Related song prefs", async () => {
    const token = await bearer();
    const theme = await app.inject({
      method: "PUT",
      url: "/v1/prefs/themes/100",
      headers: { authorization: `Bearer ${token}` },
      payload: { dislikedTvSize: true, opTs: 1000 },
    });
    expect(theme.statusCode).toBe(200);
    expect(theme.json()).toMatchObject({
      themeId: 100,
      liked: false,
      disliked: false,
      dislikedTvSize: true,
      dislikedFullSize: false,
    });

    const song = await app.inject({
      method: "PUT",
      url: "/v1/prefs/songs/300",
      headers: { authorization: `Bearer ${token}` },
      payload: { liked: true, opTs: 1000 },
    });
    expect(song.statusCode).toBe(200);
    expect(song.json()).toMatchObject({ songId: 300, liked: true, disliked: false });

    const changes = await app.inject({
      method: "GET",
      url: "/v1/changes",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(changes.json()).toMatchObject({ songPrefs: [{ songId: 300, liked: true }] });
  });

  it("accepts actual-mode events with stable UUIDs while preserving legacy plays", async () => {
    const token = await bearer();
    const eventId = "fd3dc12e-bf70-4f86-87e4-f04efb7ea113";
    const modern = await app.inject({
      method: "POST",
      url: "/v1/plays",
      headers: { authorization: `Bearer ${token}` },
      payload: [{ clientEventId: eventId, itemType: "THEME", itemId: 100, actualMode: "FULL_SIZE", playedAt: 20 }],
    });
    expect(modern.statusCode).toBe(200);
    expect(clientApi.ensureThemeCalls.at(-1)).toEqual({ userId: "stub-nolan", themeIds: [100] });
    expect(clientApi.recordedPlays.at(-1)).toEqual({ clientEventId: eventId, itemType: "THEME", itemId: 100, actualMode: "FULL_SIZE", playedAt: 20 });

    const related = await app.inject({
      method: "POST",
      url: "/v1/plays",
      headers: { authorization: `Bearer ${token}` },
      payload: [{ clientEventId: "2ec24567-bf06-4d10-8bc2-a307579efc5a", itemType: "SONG", itemId: 300, actualMode: "AUDIO", playedAt: 21 }],
    });
    expect(related.statusCode).toBe(200);
    expect(clientApi.ensureThemeCalls.at(-1)).toEqual({ userId: "stub-nolan", themeIds: [] });
    expect(clientApi.recordedPlays.at(-1)).toEqual({ clientEventId: "2ec24567-bf06-4d10-8bc2-a307579efc5a", itemType: "SONG", itemId: 300, actualMode: "AUDIO", playedAt: 21 });

    const legacy = await app.inject({
      method: "POST",
      url: "/v1/plays",
      headers: { authorization: `Bearer ${token}` },
      payload: [{ themeId: 100, playedAt: 22 }],
    });
    expect(legacy.statusCode).toBe(200);
  });

  it("authenticates song prefs and rejects unstable or mismatched play contracts", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/prefs/songs" })).statusCode).toBe(401);
    const token = await bearer();
    for (const payload of [
      [{ clientEventId: "not-a-uuid", itemType: "THEME", itemId: 100, actualMode: "TV_SIZE", playedAt: 20 }],
      [{ clientEventId: "fd3dc12e-bf70-4f86-87e4-f04efb7ea113", itemType: "THEME", itemId: 100, actualMode: "AUDIO", playedAt: 20 }],
      [{ clientEventId: "fd3dc12e-bf70-4f86-87e4-f04efb7ea113", itemType: "SONG", itemId: 300, actualMode: "FULL_SIZE", playedAt: 20 }],
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/plays",
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("refreshes server auto playlists before returning from a theme preference write", async () => {
    const token = await bearer();
    const pref = await app.inject({
      method: "PUT",
      url: "/v1/prefs/themes/100",
      headers: { authorization: `Bearer ${token}` },
      payload: { liked: true },
    });

    expect(pref.statusCode).toBe(200);
    expect(clientApi.ensureThemeCalls).toEqual([{ userId: "stub-nolan", themeIds: [100] }]);
    expect(clientApi.autoRefreshes).toEqual(["stub-nolan"]);
    expect(clientApi.events.slice(0, 3)).toEqual(["ensure-themes:100", "pref", "refresh"]);

    const playlists = await app.inject({
      method: "GET",
      url: "/v1/playlists",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(playlists.statusCode).toBe(200);
    expect(playlists.json()).toContainEqual(
      expect.objectContaining({
        name: "Liked Songs",
        isAuto: true,
        entries: [100],
      }),
    );
  });

  it("ensures played themes are in the library before recording play counts", async () => {
    const token = await bearer();
    const played = await app.inject({
      method: "POST",
      url: "/v1/plays",
      headers: { authorization: `Bearer ${token}` },
      payload: [
        { themeId: 100, playedAt: 10 },
        { themeId: 100, playedAt: 20 },
        { themeId: 101, playedAt: 30 },
      ],
    });

    expect(played.statusCode).toBe(200);
    expect(clientApi.ensureThemeCalls).toEqual([{ userId: "stub-nolan", themeIds: [100, 101] }]);
    expect(clientApi.autoRefreshes).toEqual(["stub-nolan"]);
    expect(clientApi.events.slice(0, 3)).toEqual(["ensure-themes:100,101", "plays", "refresh"]);
  });

  it("refreshes server auto playlists before returning from manual library mutations", async () => {
    const token = await bearer();

    const added = await app.inject({
      method: "POST",
      url: "/v1/library/anime",
      headers: { authorization: `Bearer ${token}` },
      payload: { kitsuId: "1" },
    });
    expect(added.statusCode).toBe(200);
    expect(clientApi.autoRefreshes).toEqual(["stub-nolan"]);

    const removed = await app.inject({
      method: "DELETE",
      url: "/v1/library/anime/1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(204);
    expect(clientApi.autoRefreshes).toEqual(["stub-nolan", "stub-nolan"]);

    const missing = await app.inject({
      method: "DELETE",
      url: "/v1/library/anime/does-not-exist",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(404);
    expect(clientApi.autoRefreshes).toEqual(["stub-nolan", "stub-nolan"]);
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

  it("accepts opTs on playlist delete for last-write-wins conflict resolution", async () => {
    const token = await bearer();
    await app.inject({
      method: "POST",
      url: "/v1/playlists",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Road Trip", entries: [100] },
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/playlists/1?opTs=1760000000123",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(deleted.statusCode).toBe(204);
    expect(clientApi.deletedPlaylistCalls).toEqual([
      { userId: "stub-nolan", id: 1, opTs: 1_760_000_000_123 },
    ]);
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

  it("defaults manual sync requests to full reconciliation", async () => {
    const token = await bearer();
    const sync = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(sync.statusCode).toBe(200);
    expect(syncApi.enqueued).toEqual([{ userId: "stub-nolan", full: true }]);
  });

  it("round-trips mixed playlist items, duplicates, and mode policy", async () => {
    const token = await bearer();
    const items = [
      { itemType: "THEME", itemId: 100, modeOverride: "FULL_SIZE" },
      { itemType: "SONG", itemId: 300, modeOverride: null },
      { itemType: "SONG", itemId: 300, modeOverride: null },
      { itemType: "THEME", itemId: 101, modeOverride: null },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/v1/playlists",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Mixed", defaultMode: "FULL_SIZE", items },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().playlist).toMatchObject({
      defaultMode: "FULL_SIZE",
      entries: [100, 101],
      items,
    });
  });

  it("rejects Video and SONG mode overrides in playlist writes", async () => {
    const token = await bearer();
    for (const payload of [
      { name: "Video", defaultMode: "VIDEO", items: [] },
      { name: "Song override", defaultMode: "TV_SIZE", items: [{ itemType: "SONG", itemId: 300, modeOverride: "FULL_SIZE" }] },
      { name: "Ambiguous", entries: [100], items: [{ itemType: "THEME", itemId: 100, modeOverride: null }] },
    ]) {
      const response = await app.inject({ method: "POST", url: "/v1/playlists", headers: { authorization: `Bearer ${token}` }, payload });
      expect(response.statusCode).toBe(400);
    }
  });

  it("returns additive media modes and a complete ready music snapshot in changes", async () => {
    const token = await bearer();
    const response = await app.inject({
      method: "GET",
      url: "/v1/changes?since=1750000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().themes[0]).toMatchObject({
      audioUrl: "/v1/media/audio/100",
      mediaModes: {
        tvSize: { url: "/v1/media/audio/100" },
        fullSize: { songId: 300, url: "/v1/media/songs/300/audio" },
        video: { url: "https://example.invalid/op.webm" },
      },
    });
    expect(response.json().musicCatalog[0]).toMatchObject({
      anime: { kitsuId: "1" },
      releases: [{ id: 200, tracks: [{ id: 300 }] }],
    });
  });

  it("serves authenticated ready-only anime music and release detail routes", async () => {
    const token = await bearer();
    const anime = await app.inject({ method: "GET", url: "/v1/anime/1/music", headers: { authorization: `Bearer ${token}` } });
    expect(anime.statusCode).toBe(200);
    expect(anime.json()).toMatchObject({ anime: { kitsuId: "1" }, releases: [{ id: 200, tracks: [{ id: 300 }] }] });

    const release = await app.inject({ method: "GET", url: "/v1/music/releases/200", headers: { authorization: `Bearer ${token}` } });
    expect(release.statusCode).toBe(200);
    expect(release.json()).toMatchObject({ id: 200, tracks: [{ audioUrl: "/v1/media/songs/300/audio" }] });

    const missing = await app.inject({ method: "GET", url: "/v1/music/releases/999", headers: { authorization: `Bearer ${token}` } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "MUSIC_NOT_FOUND" } });
  });
});
