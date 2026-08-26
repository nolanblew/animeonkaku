import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService, SESSION_IDLE_REAUTH_AFTER_MS } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { KitsuAuthError, type KitsuAuthClient } from "../src/auth/types.js";
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
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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
    expect(setCookie).toContain("Path=/api");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain(`Max-Age=${Math.floor(SESSION_IDLE_REAUTH_AFTER_MS / 1000)}`);
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
    expect(logout.headers["set-cookie"]).toMatch(/ongaku_session=; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=0/);

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

  it("does not trust caller-controlled forwarded headers for CSRF origin checks", async () => {
    const originRepo = new FakeAuthRepo();
    const originApp = buildApp({
      authService: new AuthService(originRepo, new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      webAuth: {
        profile: new UserProfileService(originRepo, mediaRoot),
        secureCookies: true,
        publicOrigin: "https://music.example",
      },
    });
    const login = await originApp.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://music.example" },
      payload: { username: "origin-test", password: "hunter2" },
    });
    const cookie = cookieFrom(login);

    const spoofed = await originApp.inject({
      method: "PATCH",
      url: "/api/auth/profile",
      headers: {
        cookie,
        origin: "https://evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
      payload: { displayName: "Compromised" },
    });
    expect(spoofed.statusCode).toBe(403);

    const allowed = await originApp.inject({
      method: "PATCH",
      url: "/api/auth/profile",
      headers: { cookie, origin: "https://music.example" },
      payload: { displayName: "Safe" },
    });
    expect(allowed.statusCode).toBe(200);
    await originApp.close();
  });

  it("does not apply cookie CSRF checks when a bearer token takes precedence", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "bearer-csrf", password: "hunter2" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        authorization: `Bearer ${login.json().token as string}`,
        cookie: "ongaku_session=stale-cookie",
      },
    });
    expect(response.statusCode).toBe(204);
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

    const signatureOnly = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/auth/profile/avatar",
      headers: { cookie, ...sameOrigin, "content-type": "image/png" },
      payload: signatureOnly,
    });
    expect(malformed.statusCode).toBe(400);

    const uploaded = await app.inject({
      method: "POST",
      url: "/api/auth/profile/avatar",
      headers: { cookie, ...sameOrigin, "content-type": "image/png" },
      payload: onePixelPng,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().profile.avatarUrl).toBe("/api/auth/profile/avatar");

    const profile = repo.users.get("stub-nolan")!;
    expect(profile.avatarPath).toMatch(/^images[\\/]avatars[\\/].+\.webp$/);
    const storedPath = join(mediaRoot, profile.avatarPath!);
    expect(statSync(storedPath).size).toBeGreaterThan(0);
    expect(readFileSync(storedPath)).not.toEqual(onePixelPng);

    const served = await app.inject({
      method: "GET",
      url: "/api/auth/profile/avatar",
      headers: { cookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/webp");
    expect(served.rawPayload.subarray(0, 4).toString("ascii")).toBe("RIFF");

    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/auth/profile/avatar",
      headers: { cookie, ...sameOrigin, "content-type": "image/png" },
      payload: Buffer.concat([onePixelPng, Buffer.alloc(2 * 1024 * 1024)]),
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
      payload: Buffer.concat([head, onePixelPng, tail]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profile.avatarUrl).toBe("/api/auth/profile/avatar");
  });

  it("serializes concurrent avatar replacement so only the current file remains", async () => {
    const concurrentRoot = mkdtempSync(join(tmpdir(), "ongaku-avatar-concurrency-"));
    const concurrentRepo = new FakeAuthRepo();
    const concurrentApp = buildApp({
      authService: new AuthService(concurrentRepo, new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot: concurrentRoot },
      webAuth: { profile: new UserProfileService(concurrentRepo, concurrentRoot), secureCookies: false },
    });
    const login = await concurrentApp.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "parallel-avatar", password: "hunter2" },
    });
    const cookie = cookieFrom(login);

    const responses = await Promise.all(Array.from({ length: 20 }, () => concurrentApp.inject({
      method: "POST",
      url: "/api/auth/profile/avatar",
      headers: { cookie, ...sameOrigin, "content-type": "image/png" },
      payload: onePixelPng,
    })));

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(readdirSync(join(concurrentRoot, "images", "avatars"))).toHaveLength(1);
    await concurrentApp.close();
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

  it("does not expose upstream Kitsu authentication details", async () => {
    const upstreamMessage = "token=upstream-secret internal-auth-host";
    const failingKitsu: KitsuAuthClient = {
      login: async () => { throw new KitsuAuthError(upstreamMessage); },
      refresh: async () => { throw new KitsuAuthError(upstreamMessage); },
    };
    const failingRepo = new FakeAuthRepo();
    const failingApp = buildApp({
      authService: new AuthService(failingRepo, failingKitsu),
      health: { pingDb: async () => {}, mediaRoot },
      webAuth: { profile: new UserProfileService(failingRepo, mediaRoot), secureCookies: false },
    });

    const response = await failingApp.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: sameOrigin,
      payload: { username: "nolan", password: "hunter2" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe("Kitsu authentication failed.");
    expect(response.body).not.toContain("upstream-secret");
    expect(response.body).not.toContain("internal-auth-host");
    await failingApp.close();
  });
});
