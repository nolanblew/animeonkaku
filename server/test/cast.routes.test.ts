import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerCastRoutes } from "../src/cast/routes.js";
import type { AuthService } from "../src/auth/service.js";
import type { MediaStreamingService } from "../src/api/mediaRoutes.js";

describe("Cast media credentials", () => {
  async function fixture() {
    let valid = true;
    let now = 1_000;
    const auth = {
      authenticate: vi.fn(async (token: string) => token === "phone-secret" && valid ? { session: { id: 1 }, user: { kitsuUserId: "1" } } : null),
      authenticateTokenHash: vi.fn(async () => valid ? {} : null),
    };
    const media = {
      sendSonosThemeAudio: vi.fn(async (_id, _method, _range, reply) => reply.type("audio/mpeg").send("music")),
      sendSonosSongAudio: vi.fn(async (_id, method, _range, reply) => reply.header("cache-control", "public").type("audio/mpeg").send(method === "HEAD" ? undefined : "song")),
    };
    const app = Fastify();
    registerCastRoutes(app, auth as unknown as AuthService, media as unknown as MediaStreamingService, () => now);
    await app.ready();
    return { app, auth, media, revoke: () => { valid = false; }, expire: () => { now += 13 * 60 * 60 * 1000; } };
  }
  it("requires login to mint credentials and never sends the phone token", async () => {
    const { app } = await fixture();
    try {
      expect((await app.inject({ method: "POST", url: "/v1/cast/session" })).statusCode).toBe(401);
      const response = await app.inject({ method: "POST", url: "/v1/cast/session", headers: { authorization: "Bearer phone-secret" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().token).toMatch(/^[a-f0-9]{64}$/);
      expect(response.body).not.toContain("phone-secret");
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally { await app.close(); }
  });
  it("streams only with a valid media token and supports CORS, ranges, and revocation", async () => {
    const { app, media, revoke } = await fixture();
    try {
      const issued = await app.inject({ method: "POST", url: "/v1/cast/session", headers: { authorization: "Bearer phone-secret" } });
      const path = `/v1/cast/audio/themes/12.mp3?castToken=${issued.json().token}`;
      const res = await app.inject({ url: path, headers: { range: "bytes=0-3", origin: "https://receiver.example" } });
      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(media.sendSonosThemeAudio.mock.calls[0].slice(0, 3)).toEqual([12, "GET", "bytes=0-3"]);
      expect((await app.inject({ url: "/v1/cast/audio/themes/12.mp3?castToken=phone-secret" })).statusCode).toBe(401);
      revoke();
      expect((await app.inject({ url: path })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it("expires credentials and rejects invalid media ids", async () => {
    const { app, expire } = await fixture();
    try {
      const issued = await app.inject({ method: "POST", url: "/v1/cast/session", headers: { authorization: "Bearer phone-secret" } });
      const token = issued.json().token;
      expect((await app.inject({ url: `/v1/cast/audio/themes/nope.mp3?castToken=${token}` })).statusCode).toBe(400);
      expire();
      expect((await app.inject({ url: `/v1/cast/audio/themes/12.mp3?castToken=${token}` })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it("supports song HEAD and preflight without exposing audio to unauthenticated GET", async () => {
    const { app, media } = await fixture();
    try {
      const preflight = await app.inject({ method: "OPTIONS", url: "/v1/cast/audio/songs/9.mp3" });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-headers"]).toBe("Range");
      expect((await app.inject({ url: "/v1/cast/audio/songs/9.mp3" })).statusCode).toBe(401);
      const issued = await app.inject({ method: "POST", url: "/v1/cast/session", headers: { authorization: "Bearer phone-secret" } });
      const res = await app.inject({ method: "HEAD", url: `/v1/cast/audio/songs/9.mp3?castToken=${issued.json().token}` });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("");
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(media.sendSonosSongAudio.mock.calls[0].slice(0, 3)).toEqual([9, "HEAD", undefined]);
    } finally { await app.close(); }
  });
  it("bounds active capabilities and reclaims expired capacity", async () => {
    const { app, expire } = await fixture();
    try {
      const request = { method: "POST" as const, url: "/v1/cast/session", headers: { authorization: "Bearer phone-secret" } };
      for (let i = 0; i < 1000; i++) expect((await app.inject(request)).statusCode).toBe(200);
      expect((await app.inject(request)).statusCode).toBe(429);
      expire();
      expect((await app.inject(request)).statusCode).toBe(200);
    } finally { await app.close(); }
  });
});
