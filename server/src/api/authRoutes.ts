import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { ApiError, errorEnvelope } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: import("../auth/service.js").AuthContext;
  }
}

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string(),
  deviceName: z.string().min(1).max(100).optional(),
});

const deviceParams = z.object({
  id: z.coerce.number().int().positive(),
});

export function registerAuthRoutes(fastify: FastifyInstance, authService: AuthService): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
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

  app.post("/v1/auth/login", { schema: { body: loginBody } }, async (request) => {
    return authService.login(request.body);
  });

  app.post("/v1/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    await authService.logout(request.auth!);
    return reply.code(204).send();
  });

  app.get("/v1/auth/me", { preHandler: requireAuth }, async (request) => {
    return authService.me(request.auth!);
  });

  app.delete(
    "/v1/auth/devices/:id",
    { schema: { params: deviceParams }, preHandler: requireAuth },
    async (request, reply) => {
      const revoked = await authService.revokeDevice(request.auth!, request.params.id);
      if (!revoked) {
        throw new ApiError(404, "NOT_FOUND", "No such device session.");
      }
      return reply.code(204).send();
    },
  );
}
