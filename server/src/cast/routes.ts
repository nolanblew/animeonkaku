import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/service.js";
import { hashToken } from "../auth/tokens.js";
import { makeRequireAuth } from "../api/requireAuth.js";
import type { MediaStreamingService } from "../api/mediaRoutes.js";

const TTL_MS = 12 * 60 * 60 * 1000;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Media-only capabilities: no account/API access; expire and follow parent-session revocation. */
export function registerCastRoutes(
  app: FastifyInstance,
  auth: AuthService,
  media: MediaStreamingService,
  now: () => number = Date.now,
): void {
  const sessions = new Map<string, { parentHash: string; expiresAt: number }>();
  const prune = () => {
    for (const [key, session] of sessions) if (session.expiresAt <= now()) sessions.delete(key);
  };
  app.post("/v1/cast/session", { preHandler: makeRequireAuth(auth) }, async (request, reply) => {
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer) return reply.code(401).send({ error: "Bearer authentication required" });
    prune();
    if (sessions.size >= 1000) return reply.code(429).send({ error: "Too many Cast sessions" });
    const token = randomBytes(32).toString("hex");
    const expiresAt = now() + TTL_MS;
    sessions.set(digest(token), { parentHash: hashToken(bearer), expiresAt });
    return reply.header("cache-control", "no-store").send({ token, expiresAt });
  });

  app.route<{ Params: { kind: string; id: string }; Querystring: { castToken?: string } }>({
    method: ["GET", "HEAD", "OPTIONS"],
    url: "/v1/cast/audio/:kind/:id.mp3",
    // Capability URLs must not enter request logs (including the automatic request-start log).
    logLevel: "silent",
    handler: async (request, reply) => {
      reply.header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
        .header("access-control-allow-headers", "Range")
        .header("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges")
        .header("referrer-policy", "no-referrer");
      if (request.method === "OPTIONS") return reply.code(204).send();
      const { kind, id } = request.params;
      if (!["themes", "songs"].includes(kind) || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
        return reply.code(400).send({ error: "Invalid media identifier" });
      }
      const token = request.query.castToken;
      const key = typeof token === "string" && /^[a-f0-9]{64}$/.test(token) ? digest(token) : "";
      const session = sessions.get(key);
      if (!session || session.expiresAt <= now() || !await auth.authenticateTokenHash(session.parentHash)) {
        sessions.delete(key);
        return reply.header("cache-control", "no-store").code(401).send({ error: "Cast session expired. Reconnect from your phone." });
      }
      // Reuse the bounded, cached MP3 conversion already used by Sonos for broad device support.
      const method = request.method as "GET" | "HEAD";
      const range = typeof request.headers.range === "string" ? request.headers.range : undefined;
      // Apply after the media service's public cache headers: credentials are checked on every read.
      reply.header("cache-control", "private, no-store");
      return kind === "themes"
        ? media.sendSonosThemeAudio(Number(id), method, range, reply)
        : media.sendSonosSongAudio(Number(id), method, range, reply);
    },
    onSend: async (_request, reply, payload) => {
      reply.header("cache-control", "private, no-store");
      return payload;
    },
  });
}
