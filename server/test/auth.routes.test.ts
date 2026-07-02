import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService, SESSION_TTL_MS } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import type {
  LegacyLibraryImportPayload,
  LegacyLibraryImportResult,
  LegacyLibraryImportService,
} from "../src/legacyLibraryImport.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-test-"));

let repo: FakeAuthRepo;
let app: FastifyInstance;
let legacyImporter: FakeLegacyLibraryImportService;

class FakeLegacyLibraryImportService implements LegacyLibraryImportService {
  calls: Array<{ userId: string; payload: LegacyLibraryImportPayload }> = [];

  async importLegacyLibrary(
    userId: string,
    payload: LegacyLibraryImportPayload,
  ): Promise<LegacyLibraryImportResult> {
    this.calls.push({ userId, payload });
    return {
      requestedEntries: payload.entries.length,
      importedEntries: payload.entries.length,
      skippedEntries: 0,
      importedLikes: payload.entries.filter((entry) => entry.liked).length,
      importedDislikes: payload.entries.filter((entry) => entry.disliked).length,
      importedPlayCounts: payload.entries.filter((entry) => entry.playCount > 0).length,
    };
  }
}

beforeEach(() => {
  repo = new FakeAuthRepo();
  legacyImporter = new FakeLegacyLibraryImportService();
  app = buildApp({
    authService: new AuthService(repo, new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    legacyLibraryImport: legacyImporter,
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

  it("recommends a FULL sync for brand-new users", async () => {
    const res = await login();
    expect(res.json().syncMode).toBe("FULL");
  });

  it("recommends a DELTA sync for returning users synced within 6 months", async () => {
    await login("nolan", "Pixel 9");
    repo.users.get("stub-nolan")!.lastSyncAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const res = await login("nolan", "Tablet");

    expect(res.json().isNewUser).toBe(false);
    expect(res.json().syncMode).toBe("DELTA");
  });

  it("recommends a FULL sync for returning users whose last sync is older than 6 months", async () => {
    await login("nolan", "Pixel 9");
    repo.users.get("stub-nolan")!.lastSyncAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

    const res = await login("nolan", "Tablet");

    expect(res.json().isNewUser).toBe(false);
    expect(res.json().syncMode).toBe("FULL");
  });

  it("recommends a FULL sync for returning users who never completed a sync", async () => {
    await login("nolan", "Pixel 9");

    const res = await login("nolan", "Tablet");

    expect(res.json().syncMode).toBe("FULL");
  });

  it("imports legacy library preferences during login when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username: "nolan",
        password: "hunter2",
        deviceName: "Pixel 9",
        legacyLibraryImport: {
          entries: [
            {
              themeId: 100,
              liked: true,
              disliked: false,
              playCount: 3,
              lastPlayedAt: 1700000000000,
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(legacyImporter.calls).toEqual([
      {
        userId: "stub-nolan",
        payload: {
          entries: [
            {
              themeId: 100,
              liked: true,
              disliked: false,
              playCount: 3,
              lastPlayedAt: 1700000000000,
            },
          ],
        },
      },
    ]);
    expect(res.json().legacyLibraryImport).toEqual({
      requestedEntries: 1,
      importedEntries: 1,
      skippedEntries: 0,
      importedLikes: 1,
      importedDislikes: 0,
      importedPlayCounts: 1,
    });
  });

  it("rejects contradictory legacy import entries", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username: "nolan",
        password: "hunter2",
        legacyLibraryImport: {
          entries: [{ themeId: 100, liked: true, disliked: true }],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(legacyImporter.calls).toHaveLength(0);
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

  it("rejects a token after the session row is deleted by an operator reset", async () => {
    const token = (await login()).json().token as string;
    repo.sessions.clear();

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
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

  it("creates a session with the far-future tether TTL", async () => {
    const before = Date.now();
    await login();
    const [session] = [...repo.sessions.values()];
    const ttl = session!.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(SESSION_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_MS + 60_000);
  });
});

describe("onAuthenticatedRequest hook", () => {
  it("fires with the user after authenticated requests only", async () => {
    const seen: string[] = [];
    const hookRepo = new FakeAuthRepo();
    const hookApp = buildApp({
      authService: new AuthService(hookRepo, new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot },
      onAuthenticatedRequest: async (user) => {
        seen.push(user.kitsuUserId);
      },
    });

    const loginRes = await hookApp.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "nolan", password: "hunter2", deviceName: "Pixel 9" },
    });
    const token = loginRes.json().token as string;

    await hookApp.inject({ method: "GET", url: "/v1/auth/me" }); // unauthenticated → no fire
    await hookApp.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(seen).toEqual(["stub-nolan"]);
    await hookApp.close();
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
