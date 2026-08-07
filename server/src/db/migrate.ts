import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

/**
 * Runs pending drizzle migrations before the HTTP listener starts (doc 03).
 * Resolves `drizzle/` relative to this module so it works from both
 * `src/` (tsx dev) and `dist/` (production image).
 */
export async function runMigrations(db: Db): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  await migrate(db, { migrationsFolder });
}
