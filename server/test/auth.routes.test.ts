import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService, SESSION_TTL_MS } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-test-"));

let repo: FakeAuthRepo;
let app: FastifyInstance;

beforeEach(() => {
  repo = new FakeAuthRepo();
  app = buildApp({
    authService: new AuthService(repo, new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
  });
});

afterEach(async () => {
  await app.close();
});

async function login(username = "nolan", deviceName = "Pixel 9") {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username, password: "hunter2", deviceName },
  });
  return res;
}

describe("POST /v1/auth/login", () => {
  it("returns a session token, user info, and isNewUser=true on first login", async () => {
    const res = await login();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user).toEqual({ kitsuUserId: "stub-nolan", username: "nolan" });
    expect(body.isNewUser).toBe(true);
  });

  it("returns isNewUser=false on subsequent logins and issues a distinct token per device", async () => {
    const first = await login("nolan", "Pixel 9");
    const second = await login("nolan", "Tablet");
    expect(second.json().isNewUser).toBe(false);
    expect(second.json().token).not.toBe(first.json().token);
    expect(repo.sessions.size).toBe(2);
  });

  it("rejects bad credentials with a 401 error envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "nolan", password: "" },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe("KITSU_AUTH_FAILED");
    expect(typeof body.error.message).toBe("string");
  });

  it("rejects a malformed body with a 400 error envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "nolan" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_REQUEST");
  });

  it("rejects malformed JSON with a 400 error envelope, not a 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_REQUEST");
  });

  it("does not store the raw token in the repo", async () => {
    const res = await login();
    const token = res.json().token as string;
    const hashes = [...repo.sessions.values()].map((s) => s.tokenHash);
    expect(hashes).not.toContain(token);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("bearer authentication", () => {
  it("rejects requests without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects unknown tokens", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects expired sessions", async () => {
    const token = (await login()).json().token as string;
    for (const session of repo.sessions.values()) {
      session.expiresAt = new Date(Date.now() - 1000);
    }
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/auth/me", () => {
  it("returns user info and the device list with the current device flagged", async () => {
    const token = (await login("nolan", "Pixel 9")).json().token as string;
    await login("nolan", "Tablet");

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toEqual({ kitsuUserId: "stub-nolan", username: "nolan" });
    expect(body.kitsuAuthState).toBe("OK");
    expect(body.lastSyncAt).toBeNull();
    expect(body.devices).toHaveLength(2);
    const current = body.devices.filter((d: { current: boolean }) => d.current);
    expect(current).toHaveLength(1);
    expect(current[0].deviceName).toBe("Pixel 9");
  });

  it("creates a session with the documented TTL", async () => {
    const before = Date.now();
    await login();
    const [session] = [...repo.sessions.values()];
    const ttl = session!.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(SESSION_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_MS + 60_000);
  });
});

describe("POST /v1/auth/logout", () => {
  it("revokes the current session", async () => {
    const token = (await login()).json().token as string;
    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(401);
  });
});

describe("DELETE /v1/auth/devices/:id", () => {
  it("revokes another device's session", async () => {
    const tokenA = (await login("nolan", "Pixel 9")).json().token as string;
    await login("nolan", "Tablet");

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const other = me.json().devices.find((d: { current: boolean }) => !d.current);

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/auth/devices/${other.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(after.json().devices).toHaveLength(1);
  });

  it("404s for sessions that do not exist or belong to someone else", async () => {
    const tokenA = (await login("nolan")).json().token as string;
    const tokenB = (await login("rival")).json().token as string;
    const rivalSession = [...repo.sessions.values()].find((s) => s.userId === "stub-rival")!;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/auth/devices/${rivalSession.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");

    // rival session untouched
    const rivalMe = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(rivalMe.statusCode).toBe(200);
  });
});
