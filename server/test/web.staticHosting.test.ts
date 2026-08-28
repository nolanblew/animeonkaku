import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

describe("web static hosting", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "ongaku-web-dist-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>Anime Ongaku</title>");
    writeFileSync(join(root, "assets", "index-ABC123.js"), "export const ready = true;");
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot: root },
      web: { distPath: root },
    });
  });

  afterEach(async () => app.close());

  it("serves the SPA root and browser routes without caching index.html", async () => {
    for (const url of ["/", "/library", "/anime/16bit-sensation"]) {
      const response = await app.inject({ method: "GET", url, headers: { accept: "text/html" } });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["cache-control"]).toContain("no-cache");
      expect(response.body).toContain("Anime Ongaku");
    }
  });

  it("serves fingerprinted assets with immutable caching", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/index-ABC123.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toMatch(/max-age=31536000/);
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it.each(["/api/not-a-route", "/v1/not-a-route", "/admin/not-a-route", "/missing.js"])(
    "keeps reserved and asset misses on the JSON 404 surface: %s",
    async (url) => {
      const response = await app.inject({ method: "GET", url, headers: { accept: "text/html" } });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("NOT_FOUND");
    },
  );
});
