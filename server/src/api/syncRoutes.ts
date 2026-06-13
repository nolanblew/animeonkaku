import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeRequireAuth } from "./requireAuth.js";

export interface SyncStatusResponse {
  state: string;
  phase: string | null;
  progress: Record<string, unknown>;
  lastCompletedAt: number | null;
  unmatched: string[];
}

export interface SyncApiService {
  enqueueSync(userId: string, full: boolean): Promise<{ jobId: number }>;
  getStatus(userId: string): Promise<SyncStatusResponse>;
}

const syncBody = z.object({
  full: z.boolean().optional(),
});

export function registerSyncRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  service: SyncApiService,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.post(
    "/v1/sync",
    { schema: { body: syncBody }, preHandler: requireAuth },
    async (request) => service.enqueueSync(request.auth!.user.kitsuUserId, request.body.full ?? false),
  );

  app.get("/v1/sync/status", { preHandler: requireAuth }, async (request) =>
    service.getStatus(request.auth!.user.kitsuUserId),
  );
}
