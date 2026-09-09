import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { ArtistCatalogApiService, ProxyApiService } from "../src/api/proxyRoutes.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-artist-catalog-routes-"));

class FakeProxyApi implements ProxyApiService {
  async search() {
    return { results: [] };
  }

  async artist(slug: string) {
    return { artist: { slug } };
  }
}

class FakeArtistCatalogApi implements ArtistCatalogApiService {
  catalogCalls: string[] = [];
  refreshCalls: string[] = [];

  async catalog(slug: string) {
    this.catalogCalls.push(slug);
    return { artist: { slug }, themes: [], fullSongs: [], catalogState: { status: "ready", hasData: true, lastUpdatedAt: null } };
  }

  async refresh(slug: string) {
    this.refreshCalls.push(slug);
    return { artist: { slug }, themes: [], fullSongs: [], catalogState: { status: "refreshing", hasData: true, lastUpdatedAt: null } };
  }
}

let app: FastifyInstance;
let catalog: FakeArtistCatalogApi;

beforeEach(() => {
  catalog = new FakeArtistCatalogApi();
  app = buildApp({
    authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    proxyApi: new FakeProxyApi(),
    artistCatalog: catalog,
  });
});

afterEach(async () => {
  await app.close();
});

async function bearer(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username: "nolan", password: "hunter2" },
  });
  return response.json().token as string;
}

describe("artist catalog routes", () => {
  it("requires bearer auth for both catalog endpoints", async () => {
    const get = await app.inject({ method: "GET", url: "/v1/artists/kessoku-band/catalog" });
    const post = await app.inject({ method: "POST", url: "/v1/artists/kessoku-band/catalog/refresh" });

    expect(get.statusCode).toBe(401);
    expect(post.statusCode).toBe(401);
    expect(catalog.catalogCalls).toEqual([]);
    expect(catalog.refreshCalls).toEqual([]);
  });

  it("dispatches authenticated catalog reads and refreshes with the route slug", async () => {
    const token = await bearer();

    const get = await app.inject({
      method: "GET",
      url: "/v1/artists/Kessoku-Band/catalog",
      headers: { authorization: `Bearer ${token}` },
    });
    const post = await app.inject({
      method: "POST",
      url: "/v1/artists/Kessoku-Band/catalog/refresh",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ artist: { slug: "Kessoku-Band" }, catalogState: { status: "ready" } });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toMatchObject({ artist: { slug: "Kessoku-Band" }, catalogState: { status: "refreshing" } });
    expect(catalog.catalogCalls).toEqual(["Kessoku-Band"]);
    expect(catalog.refreshCalls).toEqual(["Kessoku-Band"]);
  });
});
