import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";
import { MusicRequestConflictError } from "../src/music/requests/service.js";
import type { MusicRequestSummary } from "../src/music/requests/types.js";

describe("music request API", () => {
  let app: FastifyInstance;
  const summary: MusicRequestSummary = { id: "11111111-1111-4111-8111-111111111111", kitsuId: "42", scope: "FULL_SONGS", state: "QUEUED", active: true, batchCount: 1,
    fullThemeCount: 1,
    counts: { queued: 1, searching: 0, awaitingOperator: 0, downloading: 0, processing: 0, completed: 0, completedWithWarnings: 0, failed: 0, cancelled: 0 },
    requiresOperatorAction: false, lastUpdatedAt: "2026-07-21T12:00:00.000Z", pollAfterSeconds: 5 };
  const status = { kitsuId: "42", scopes: [
    { scope: "FULL_SONGS", latest: summary, active: true, eligibleCount: 2, availableCount: 1, missingCount: 1 },
    { scope: "EXTRA_MUSIC", latest: null, active: false, eligibleCount: 4, availableCount: 0, missingCount: 4 },
  ] };
  const service = { trigger: vi.fn(), triggerTheme: vi.fn(), get: vi.fn(), latest: vi.fn(), status: vi.fn() };

  beforeEach(() => {
    service.trigger.mockResolvedValue({ request: summary, replayed: false });
    service.triggerTheme.mockResolvedValue({ request: summary, replayed: false, themeId: 11, manualSelectionRequired: false });
    service.get.mockResolvedValue(summary);
    service.latest.mockResolvedValue(null);
    service.status.mockResolvedValue(status);
    app = buildApp({ authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot: process.cwd() }, musicRequests: service as any });
  });
  afterEach(async () => { vi.clearAllMocks(); await app.close(); });

  async function token() {
    const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "nolan", password: "secret" } });
    return response.json().token as string;
  }

  it("requires auth and returns 202 + Location for creation/replay", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/anime/42/music-requests" })).statusCode).toBe(401);
    const bearer = await token();
    const response = await app.inject({ method: "POST", url: "/v1/anime/42/music-requests", headers: { authorization: `Bearer ${bearer}` } });
    expect(response.statusCode).toBe(202);
    expect(response.headers.location).toBe(`/v1/music-requests/${summary.id}`);
    expect(response.json()).toEqual({ request: summary, replayed: false });
    expect(service.trigger).toHaveBeenCalledWith("stub-nolan", "42", "DEBUG_USER", "FULL_SONGS");
  });

  it("adds authenticated full, extra, and independent status endpoints", async () => {
    const bearer = await token();
    const headers = { authorization: `Bearer ${bearer}` };

    expect((await app.inject({ method: "POST", url: "/v1/anime/42/music-requests/full-songs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/anime/42/music-requests/extra-music" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/anime/42/music-requests/status" })).statusCode).toBe(401);

    await app.inject({ method: "POST", url: "/v1/anime/42/music-requests/full-songs", headers });
    expect(service.trigger).toHaveBeenLastCalledWith("stub-nolan", "42", "DEBUG_USER", "FULL_SONGS");
    await app.inject({ method: "POST", url: "/v1/anime/42/music-requests/extra-music", headers });
    expect(service.trigger).toHaveBeenLastCalledWith("stub-nolan", "42", "DEBUG_USER", "EXTRA_MUSIC");

    const response = await app.inject({ method: "GET", url: "/v1/anime/42/music-requests/status", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
    expect(service.status).toHaveBeenCalledWith("42");
  });

  it("hydrates a safe resource and represents no latest request as null", async () => {
    const bearer = await token();
    const resource = await app.inject({ method: "GET", url: `/v1/music-requests/${summary.id}`, headers: { authorization: `Bearer ${bearer}` } });
    expect(resource.json()).toEqual({ request: summary });
    expect(service.get).toHaveBeenCalledWith("stub-nolan", summary.id);
    const latest = await app.inject({ method: "GET", url: "/v1/anime/42/music-requests/latest", headers: { authorization: `Bearer ${bearer}` } });
    expect(latest.json()).toEqual({ request: null });
  });

  it("requires auth, validates the target theme, and returns the targeted request contract", async () => {
    expect((await app.inject({
      method: "POST",
      url: "/v1/anime/42/themes/11/music-requests",
      payload: { reason: "REQUEST_FULL_SIZE" },
    })).statusCode).toBe(401);
    const bearer = await token();
    const invalidReason = await app.inject({
      method: "POST",
      url: "/v1/anime/42/themes/11/music-requests",
      headers: { authorization: `Bearer ${bearer}` },
      payload: { reason: "WRONG" },
    });
    expect(invalidReason.statusCode).toBe(400);
    const invalidTheme = await app.inject({
      method: "POST",
      url: "/v1/anime/42/themes/0/music-requests",
      headers: { authorization: `Bearer ${bearer}` },
      payload: { reason: "REQUEST_FULL_SIZE" },
    });
    expect(invalidTheme.statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: "/v1/anime/42/themes/11/music-requests",
      headers: { authorization: `Bearer ${bearer}` },
      payload: { reason: "REQUEST_FULL_SIZE" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.headers.location).toBe(`/v1/music-requests/${summary.id}`);
    expect(response.json()).toEqual({ request: summary, replayed: false, themeId: 11, manualSelectionRequired: false });
    expect(service.triggerTheme).toHaveBeenCalledWith("stub-nolan", "42", 11, "REQUEST_FULL_SIZE");
  });

  it("reports a targeted conflict instead of claiming the request was accepted", async () => {
    service.triggerTheme.mockRejectedValueOnce(new MusicRequestConflictError());
    const bearer = await token();
    const response = await app.inject({
      method: "POST",
      url: "/v1/anime/42/themes/11/music-requests",
      headers: { authorization: `Bearer ${bearer}` },
      payload: { reason: "INCORRECT_FULL_SIZE" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({ code: "MUSIC_REQUEST_CONFLICT" });
  });
});
