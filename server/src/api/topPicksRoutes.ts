import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeRequireAuth } from "./requireAuth.js";
import type { TopPicksService } from "./topPicksService.js";

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const topPicksQuery = z.object({
  limit: z.coerce.number().int().min(1).max(60).optional(),
  includeExtras: booleanQuery.optional(),
  filter: z.enum(["ALL", "OP", "ED"]).optional(),
  snapshot: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (!value.snapshot) return;
  if (value.includeExtras === undefined) {
    context.addIssue({ code: "custom", path: ["includeExtras"], message: "includeExtras is required with snapshot" });
  }
  if (value.filter === undefined) {
    context.addIssue({ code: "custom", path: ["filter"], message: "filter is required with snapshot" });
  }
});

export function registerTopPicksRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  service: TopPicksService,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);
  app.get(
    "/v1/home/top-picks",
    { schema: { querystring: topPicksQuery }, preHandler: requireAuth },
    async (request) => service.getTopPicks(request.auth!.user.kitsuUserId, {
      limit: request.query.limit ?? 6,
      includeExtras: request.query.includeExtras ?? false,
      filter: request.query.filter ?? "ALL",
      snapshot: request.query.snapshot ?? null,
    }),
  );
}
