import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthContext, AuthService } from "../auth/service.js";
import { errorEnvelope } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    authSource?: "bearer" | "cookie";
  }
}

export const WEB_SESSION_COOKIE = "ongaku_session";

export function parseCookieHeader(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

export function makeRequireAuth(authService: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const bearerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    // Browser cookies are intentionally scoped to the /api namespace. This
    // leaves the root /v1 bearer contract unchanged for Android clients.
    const cookieToken = request.url.startsWith("/api/")
      ? parseCookieHeader(request.headers.cookie ?? "").get(WEB_SESSION_COOKIE)
      : undefined;
    const token = bearerToken ?? cookieToken;
    const auth = token ? await authService.authenticate(token) : null;
    if (!auth) {
      return reply
        .code(401)
        .send(errorEnvelope("UNAUTHORIZED", "Missing or invalid session token."));
    }
    request.auth = auth;
    request.authSource = bearerToken ? "bearer" : "cookie";
    return undefined;
  };
}
