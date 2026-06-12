import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { AuthService } from "./auth/service.js";
import { DrizzleAuthRepo } from "./auth/drizzleAuthRepo.js";
import { StubKitsuAuthClient } from "./auth/stubKitsuAuthClient.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

const config = loadConfig();

if (config.KITSU_AUTH_MODE === "real") {
  // Explicit failure beats silently running the stub in a mode that promises real auth.
  throw new Error("KITSU_AUTH_MODE=real is not implemented yet (lands in milestone S2).");
}

const { pool, db } = createDb(config.DATABASE_URL);

await runMigrations(db);

await mkdir(join(config.MEDIA_ROOT, "audio", "tmp"), { recursive: true });
await mkdir(join(config.MEDIA_ROOT, "images", "anime"), { recursive: true });
await mkdir(join(config.MEDIA_ROOT, "images", "artists"), { recursive: true });

const app = buildApp({
  authService: new AuthService(new DrizzleAuthRepo(db), new StubKitsuAuthClient()),
  health: {
    pingDb: async () => {
      await pool.query("SELECT 1");
    },
    mediaRoot: config.MEDIA_ROOT,
  },
  logger: true,
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: "0.0.0.0" });
