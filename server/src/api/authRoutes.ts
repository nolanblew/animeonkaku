import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService, LoginResult } from "../auth/service.js";
import { ApiError } from "./errors.js";
import { makeRequireAuth } from "./requireAuth.js";

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string(),
  deviceName: z.string().min(1).max(100).optional(),
});

const deviceParams = z.object({
  id: z.coerce.number().int().positive(),
});

export interface AuthRouteOptions {
  onLogin?: ((result: LoginResult) => Promise<void>) | undefined;
}

export function registerAuthRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  options: AuthRouteOptions = {},
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.post("/v1/auth/login", { schema: { body: loginBody } }, async (request) => {
    const result = await authService.login(request.body);
    await options.onLogin?.(result);
    return result;
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
