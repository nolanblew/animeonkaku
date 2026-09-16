import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

/**
 * Runs pending drizzle migrations before the HTTP listener starts (doc 03).
 * Resolves `drizzle/` relative to this module so it works from both
 * `src/` (tsx dev) and `dist/` (production image).
 */
export async function runMigrations(db: Db): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder();
  await migrate(db, { migrationsFolder });
}

/** Supports both server/src/db (tsx) and server/dist/server/src/db (compiled shared-root build). */
export function resolveMigrationsFolder(moduleUrl: string = import.meta.url): string {
  const candidates = ["../../drizzle", "../../../../drizzle"]
    .map((relative) => fileURLToPath(new URL(relative, moduleUrl)));
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Drizzle migrations folder was not found (checked ${candidates.join(", ")}).`);
  return found;
}
