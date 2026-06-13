import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "../api/errors.js";
import { makeRequireAuth } from "../api/requireAuth.js";
import type { JobRecord, JobState } from "./types.js";

export interface JobAdminService {
  listJobs(status?: JobState): Promise<JobRecord[]>;
  retryJob(id: number): Promise<JobRecord | null>;
}

const jobStateSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toUpperCase() : value),
  z.enum(["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"]),
);

const querySchema = z.object({
  status: jobStateSchema.optional(),
});

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export function registerJobAdminRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  jobs: JobAdminService,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.get(
    "/v1/jobs",
    { schema: { querystring: querySchema }, preHandler: requireAuth },
    async (request) => {
      return { jobs: (await jobs.listJobs(request.query.status)).map(toResponse) };
    },
  );

  app.post(
    "/v1/jobs/:id/retry",
    { schema: { params: paramsSchema }, preHandler: requireAuth },
    async (request) => {
      const job = await jobs.retryJob(request.params.id);
      if (!job) throw new ApiError(404, "NOT_FOUND", "No such job.");
      return { job: toResponse(job) };
    },
  );
}

function toResponse(job: JobRecord) {
  return {
    id: job.id,
    type: job.type,
    priority: job.priority,
    state: job.state,
    payload: job.payload,
    progress: job.progress,
    dedupeKey: job.dedupeKey,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextRunAt.getTime(),
    lastError: job.lastError,
    createdAt: job.createdAt.getTime(),
    updatedAt: job.updatedAt.getTime(),
  };
}
