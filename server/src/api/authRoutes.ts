import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService, LoginResult } from "../auth/service.js";
import type { LegacyLibraryImportService } from "../legacyLibraryImport.js";
import { ApiError } from "./errors.js";
import { makeRequireAuth } from "./requireAuth.js";

const legacyImportEntry = z
  .object({
    themeId: z.number().int().positive(),
    liked: z.boolean().optional().default(false),
    disliked: z.boolean().optional().default(false),
    playCount: z.number().int().nonnegative().optional().default(0),
    lastPlayedAt: z.number().int().nonnegative().nullable().optional(),
  })
  .refine((value) => !(value.liked && value.disliked), {
    message: "A legacy import entry cannot be both liked and disliked.",
  })
  .refine((value) => value.liked || value.disliked || value.playCount > 0, {
    message: "A legacy import entry must include a like, dislike, or play count.",
  });

const legacyLibraryImportBody = z.object({
  entries: z.array(legacyImportEntry).min(1).max(5000),
});

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string(),
  deviceName: z.string().min(1).max(100).optional(),
  legacyLibraryImport: legacyLibraryImportBody.optional(),
});

const deviceParams = z.object({
  id: z.coerce.number().int().positive(),
});

export interface AuthRouteOptions {
  onLogin?: ((result: LoginResult) => Promise<void>) | undefined;
  legacyLibraryImport?: LegacyLibraryImportService | undefined;
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
    try {
      let legacyLibraryImport;
      if (request.body.legacyLibraryImport !== undefined) {
        if (!options.legacyLibraryImport) {
          throw new ApiError(503, "IMPORT_UNAVAILABLE", "Legacy library import is not available.");
        }
        legacyLibraryImport = await options.legacyLibraryImport.importLegacyLibrary(
          result.user.kitsuUserId,
          request.body.legacyLibraryImport,
        );
      }
      await options.onLogin?.(result);
      return legacyLibraryImport === undefined ? result : { ...result, legacyLibraryImport };
    } catch (error) {
      // Authentication already created the device session. If later setup fails
      // before the token reaches the client, revoke it here so retries do not
      // accumulate invisible sessions in the device list.
      try {
        const auth = await authService.authenticate(result.token);
        if (auth) await authService.logout(auth);
      } catch {
        // Preserve the original setup failure; cleanup is best effort.
      }
      throw error;
    }
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
