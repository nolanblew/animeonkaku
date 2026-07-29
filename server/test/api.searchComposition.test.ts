import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ProxyApiService } from "../src/api/proxyRoutes.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

describe("search route composition", () => {
  let app: FastifyInstance;
  const calls: Array<{ userId: string; query: string }> = [];

  beforeEach(() => {
    calls.length = 0;
    const proxyApi: ProxyApiService = {
      search: async (userId, query) => {
        calls.push({ userId, query });
        return {
          query,
          animeThemes: { search: { anime: [{ id: 1 }] } },
          kitsu: [{ id: "1" }],
          music: { releases: [{ id: 200 }], tracks: [{ id: 300 }] },
        };
      },
      artist: async (slug) => ({ slug }),
    };
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot: "." },
      proxyApi,
    });
  });

  afterEach(async () => app.close());

  it("requires auth and preserves legacy keys alongside fresh music search results", async () => {
    const unauthorized = await app.inject({ method: "GET", url: "/v1/search?q=bocchi" });
    expect(unauthorized.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "nolan", password: "hunter2" },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/search?q=bocchi",
      headers: { authorization: `Bearer ${login.json().token as string}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      query: "bocchi",
      animeThemes: { search: { anime: [{ id: 1 }] } },
      kitsu: [{ id: "1" }],
      music: { releases: [{ id: 200 }], tracks: [{ id: 300 }] },
    });
    expect(calls).toEqual([{ userId: "stub-nolan", query: "bocchi" }]);
  });
});
