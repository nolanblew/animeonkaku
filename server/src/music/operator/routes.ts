import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../../auth/service.js";
import { ApiError } from "../../api/errors.js";
import { makeRequireAuth } from "../../api/requireAuth.js";
import { MusicOperatorConflictError, MusicOperatorNotFoundError } from "./service.js";
import type { MusicOperatorAction, MusicOperatorApiService } from "./types.js";

const params = z.object({ batchId: z.string().min(1).max(100) });
const routeActions: Record<string, MusicOperatorAction> = { retry: "RETRY_PROVIDER", cancel: "CANCEL_PROVIDER",
  reprocess: "REPROCESS_PROVIDER" };

export function registerMusicOperatorRoutes(fastify: FastifyInstance, auth: AuthService, service: MusicOperatorApiService) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(auth);
  app.get("/v1/admin/music/diagnostics", { preHandler: requireAuth }, () => service.diagnostics());
  app.get("/v1/admin/music/requests", { preHandler: requireAuth }, async () => ({ requests: await service.listRequests() }));
  app.get("/v1/admin/music/batches/:batchId/staging-cleanup", { schema: { params }, preHandler: requireAuth }, async (request) => {
    try { return { cleanup: await service.cleanupEligibility(request.params.batchId) }; } catch (error) { throw routeError(error); }
  });
  app.post("/v1/admin/music/batches/:batchId/:action", { schema: { params: params.extend({ action: z.enum(["retry", "cancel", "reprocess"]) }) }, preHandler: requireAuth }, async (request, reply) => {
    try { return reply.code(202).send({ operation: await service.enqueueAction(request.params.batchId, routeActions[request.params.action]!) }); }
    catch (error) { throw routeError(error); }
  });
}

function routeError(error: unknown) {
  if (error instanceof MusicOperatorNotFoundError) return new ApiError(404, "MUSIC_BATCH_NOT_FOUND", "Music request batch not found.");
  if (error instanceof MusicOperatorConflictError) return new ApiError(409, "MUSIC_ACTION_NOT_ALLOWED", "That operation is not allowed for the current batch state.");
  return error instanceof Error ? error : new Error("Music operator action failed");
}
