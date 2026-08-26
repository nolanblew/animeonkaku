import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { UserProfileService } from "../src/auth/profile.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-web-auth-"));

let repo: FakeAuthRepo;
let app: FastifyInstance;

beforeEach(() => {
  repo = new FakeAuthRepo();
  app = buildApp({
    authService: new AuthService(repo, new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    webAuth: {
      profile: new UserProfileService(repo, mediaRoot),
      secureCookies: false,
    },
  });
});

afterEach(async () => {
  await app.close();
});

function cookieFrom(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("response did not set a cookie");
  return first.split(";", 1)[0]!;
}

const sameOrigin = { origin: "http://localhost" };

describe("same-origin web authentication", () => {
  it("logs in through Kitsu-backed AuthService and sets an HttpOnly cookie without returning a token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { kitsuUserId: "stub-nolan", username: "nolan", displayName: null, avatarUrl: null },
      isNewUser: true,
      syncMode: "FULL",
    });
    expect(response.json()).not.toHaveProperty("token");
    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toMatch(/ongaku_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=/);
    expect(setCookie).not.toMatch(/; Secure(?:;|$)/);
  });

  it("marks the browser cookie Secure when production wiring enables it", async () => {
    const secureApp = buildApp({
      authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      webAuth: { profile: new UserProfileService(new FakeAuthRepo(), mediaRoot), secureCookies: true },
    });
    const response = await secureApp.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });
    expect(response.headers["set-cookie"]).toMatch(/; Secure(?:;|$)/);
    await secureApp.close();
  });

  it("authenticates /api/auth/me from the browser cookie and exposes only safe profile fields", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookieFrom(login) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      kitsuUserId: "stub-nolan",
      username: "nolan",
      displayName: null,
      avatarUrl: null,
    });
    expect(JSON.stringify(response.json())).not.toContain("accessToken");
    expect(JSON.stringify(response.json())).not.toContain("refreshToken");
  });

  it("also accepts the browser cookie on existing /api/v1 protected reads", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: cookieFrom(login) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toEqual({ kitsuUserId: "stub-nolan", username: "nolan" });
  });

  it("requires a same-origin signal for cookie-authenticated logout", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });
    const cookie = cookieFrom(login);

    const blocked = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("CSRF_ORIGIN_REQUIRED");

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, ...sameOrigin },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toMatch(/ongaku_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("updates and clears a display name, rejecting cross-origin mutations", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });
    const cookie = cookieFrom(login);

    const blocked = await app.inject({
      method: "PATCH",
      url: "/api/auth/profile",
      headers: { cookie, origin: "https://evil.example" },
      payload: { displayName: "Nolan" },
    });
    expect(blocked.statusCode).toBe(403);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/auth/profile",
      headers: { cookie, ...sameOrigin },
      payload: { displayName: "  Nolan  " },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ profile: { displayName: "Nolan", avatarUrl: null } });

    const cleared = await app.inject({
      method: "PATCH",
      url: "/api/auth/profile",
      headers: { cookie, ...sameOrigin },
      payload: { displayName: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().profile.displayName).toBeNull();
  });

  it("validates avatar type and size, then stores valid image bytes below the media root", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });
    const cookie = cookieFrom(login);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/profile/avatar",
      headers: { cookie, ...sameOrigin, "content-type": "image/png" },
      payload: Buffer.from("not an image"),
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVALID_AVATAR");

    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/auth/profile/avatar",
      headers: { cookie, ...sameOrigin, "content-type": "image/png" },
      payload: png,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().profile.avatarUrl).toBe("/api/auth/profile/avatar");

    const profile = repo.users.get("stub-nolan")!;
    expect(profile.avatarPath).toMatch(/^images[\\/]avatars[\\/].+\.png$/);
    const storedPath = join(mediaRoot, profile.avatarPath!);
    expect(statSync(storedPath).size).toBe(png.length);
    expect(readFileSync(storedPath)).toEqual(png);

    const served = await app.inject({
      method: "GET",
      url: "/api/auth/profile/avatar",
      headers: { cookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(served.rawPayload).toEqual(png);

    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/auth/profile/avatar",
      headers: { cookie, ...sameOrigin, "content-type": "image/png" },
      payload: Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]),
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().error.code).toBe("INVALID_AVATAR");
  });

  it("accepts a multipart avatar field while retaining the declared media type", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });
    const cookie = cookieFrom(login);
    const boundary = "web-avatar-test";
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 5, 4]);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`,
      "latin1",
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "latin1");
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/profile/avatar",
      headers: {
        cookie,
        ...sameOrigin,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([head, png, tail]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profile.avatarUrl).toBe("/api/auth/profile/avatar");
  });
});

describe("bearer compatibility", () => {
  it("continues to authenticate the existing Android bearer endpoints", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "nolan", password: "hunter2" },
    });
    const token = login.json().token as string;
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toEqual({ kitsuUserId: "stub-nolan", username: "nolan" });
  });
});
