import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeRequireAuth } from "./requireAuth.js";
import { ApiError } from "./errors.js";

export type SyncStageName = "library" | "catalog" | "playlists" | "musicPolicy";

export interface SyncStageStatus {
  state: string;
  counts: Record<string, number>;
  updatedAt: number | null;
  lastCompletedAt: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
  failedJobIds: number[];
  /** Number of completed jobs reporting missing catalog metadata. */
  attentionCount: number;
  /** Queue retention and the per-stage query cap limit this view. */
  truncated: boolean;
}

export interface SyncMappingStatus {
  state: string;
  lastError: string | null;
}

export interface SyncStatusResponse {
  state: string;
  phase: string | null;
  progress: Record<string, unknown>;
  lastCompletedAt: number | null;
  unmatched: string[];
  /** Latest theme-mapping job state for this user, or null if none ran yet. */
  mapping: SyncMappingStatus | null;
  /**
   * True when the latest mapping failure looks like an upstream block
   * (AnimeThemes Cloudflare 403/451 or an open circuit). Lets the client show
   * "themes unavailable — upstream blocked" instead of a silent 0-themes library.
   */
  upstreamBlocked: boolean;
  /** Library import only; downstream failures do not make imported data stale. */
  libraryState?: string;
  libraryLastCompletedAt?: number | null;
  stages?: Record<SyncStageName, SyncStageStatus>;
}

export interface SyncApiService {
  enqueueSync(userId: string, full: boolean): Promise<{ jobId: number }>;
  getStatus(userId: string): Promise<SyncStatusResponse>;
  retryStage?(userId: string, stage: SyncStageName): Promise<{ retried: number }>;
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
    async (request) => service.enqueueSync(request.auth!.user.kitsuUserId, request.body.full ?? true),
  );

  app.get("/v1/sync/status", { preHandler: requireAuth }, async (request) =>
    service.getStatus(request.auth!.user.kitsuUserId),
  );

  app.post(
    "/v1/sync/stages/:stage/retry",
    { schema: { params: z.object({ stage: z.enum(["library", "catalog", "playlists", "musicPolicy"]) }) }, preHandler: requireAuth },
    async (request) => {
      if (!service.retryStage) throw new ApiError(501, "NOT_IMPLEMENTED", "Stage retry is unavailable.");
      return service.retryStage(request.auth!.user.kitsuUserId, request.params.stage);
    },
  );
}
