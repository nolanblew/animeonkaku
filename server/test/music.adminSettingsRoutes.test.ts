import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

describe("music search admin settings", () => {
  let app: FastifyInstance;
  const settings = {
    getSettings: vi.fn(),
    updateMode: vi.fn(),
  };

  beforeEach(() => {
    settings.getSettings.mockResolvedValue({ mode: "MANUAL", updatedAt: "2026-07-27T12:00:00.000Z" });
    settings.updateMode.mockImplementation(async (mode: string) => ({ mode, updatedAt: "2026-07-27T12:01:00.000Z" }));
    app = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot: process.cwd() },
      musicSearchSettings: settings,
      adminPassword: "Password123",
    });
  });

  afterEach(async () => { vi.clearAllMocks(); await app.close(); });

  async function adminCookie() {
    const response = await app.inject({ method: "POST", url: "/admin/login", payload: { password: "Password123" } });
    expect(response.statusCode).toBe(204);
    return response.headers["set-cookie"]!.split(";")[0]!;
  }

  it("redirects anonymous visitors to a dedicated login page", async () => {
    const response = await app.inject({ method: "GET", url: "/admin" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/admin/login");

    const login = await app.inject({ method: "GET", url: "/admin/login" });
    expect(login.statusCode).toBe(200);
    expect(login.headers["content-type"]).toContain("text/html");
    expect(login.body).toContain("Anime Ongaku Admin");
  });

  it("rejects the wrong password and creates an HttpOnly session for the configured password", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/login", payload: { password: "wrong" } })).statusCode).toBe(401);

    const response = await app.inject({ method: "POST", url: "/admin/login", payload: { password: "Password123" } });
    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toContain("admin_session=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
  });

  it("renders all four modes and explains that manual debug requests remain available", async () => {
    const page = await app.inject({ method: "GET", url: "/admin", headers: { cookie: await adminCookie() } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Full music search policy");
    expect(page.body).toContain("Manually");
    expect(page.body).toContain("Users’ favorites only");
    expect(page.body).toContain("Users’ playlists");
    expect(page.body).toContain("Everything in users’ libraries");
    expect(page.body).toContain("Debug requests always remain available");
    expect(page.body).toContain('value="MANUAL" checked');
  });

  it("protects the settings API and validates updates before queuing the backfill", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/music/settings" })).statusCode).toBe(401);
    const cookie = await adminCookie();
    expect((await app.inject({ method: "PUT", url: "/api/v1/admin/music/settings", headers: { cookie }, payload: { mode: "INVALID" } })).statusCode).toBe(400);

    const response = await app.inject({ method: "PUT", url: "/api/v1/admin/music/settings", headers: { cookie }, payload: { mode: "FAVORITES" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ settings: { mode: "FAVORITES", updatedAt: "2026-07-27T12:01:00.000Z" } });
    expect(settings.updateMode).toHaveBeenCalledWith("FAVORITES");
  });
});
