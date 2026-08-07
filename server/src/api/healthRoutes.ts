import { statfs } from "node:fs/promises";
import type { FastifyInstance } from "fastify";

export interface HealthDeps {
  pingDb: () => Promise<void>;
  mediaRoot: string;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get("/healthz", async (_request, reply) => {
    let db: "ok" | "error" = "ok";
    try {
      await deps.pingDb();
    } catch {
      db = "error";
    }

    let diskFreeBytes: number | null = null;
    try {
      const stats = await statfs(deps.mediaRoot);
      diskFreeBytes = stats.bavail * stats.bsize;
    } catch {
      // media root missing/unreadable — report null rather than failing health entirely
    }

    return reply.code(db === "ok" ? 200 : 503).send({
      status: db === "ok" ? "ok" : "degraded",
      db,
      diskFreeBytes,
    });
  });
}
