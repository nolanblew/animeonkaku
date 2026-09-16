import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import type { TopPicksService } from "../src/api/topPicksService.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-top-picks-route-"));
let app: FastifyInstance;
const getTopPicks = vi.fn<TopPicksService["getTopPicks"]>();

beforeEach(() => {
  getTopPicks.mockReset().mockResolvedValue({ serverTime: 1, snapshot: "00000000-0000-4000-8000-000000000001", generatedAt: 1, expiresAt: 2, total: 0, items: [] });
  app = buildApp({
    authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    topPicks: { getTopPicks },
  });
});

afterEach(async () => app.close());

async function bearer(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "nolan", password: "hunter2" } });
  return response.json().token as string;
}

describe("Top picks route", () => {
  it("requires auth and forwards explicit scope", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/home/top-picks" })).statusCode).toBe(401);
    const token = await bearer();
    const response = await app.inject({
      method: "GET", url: "/v1/home/top-picks?limit=60&includeExtras=true&filter=ED",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(getTopPicks).toHaveBeenCalledWith("stub-nolan", { limit: 60, includeExtras: true, filter: "ED", snapshot: null });
  });

  it("requires the complete scope whenever a snapshot is supplied", async () => {
    const token = await bearer();
    const response = await app.inject({
      method: "GET", url: "/v1/home/top-picks?snapshot=00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(getTopPicks).not.toHaveBeenCalled();
  });
});
