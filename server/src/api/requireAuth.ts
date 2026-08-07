import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthContext, AuthService } from "../auth/service.js";
import { errorEnvelope } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function makeRequireAuth(authService: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const auth = token ? await authService.authenticate(token) : null;
    if (!auth) {
      return reply
        .code(401)
        .send(errorEnvelope("UNAUTHORIZED", "Missing or invalid session token."));
    }
    request.auth = auth;
    return undefined;
  };
}
