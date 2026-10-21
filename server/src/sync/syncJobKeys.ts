import { createHash } from "node:crypto";

export function kitsuSyncDedupeKey(userId: string): string {
  return `KITSU_SYNC:${userId}`;
}

/** Sort and hash variable-sized identifiers before they reach a PostgreSQL btree. */
export function mapThemesDedupeKey(userId: string | undefined, kitsuIds: string[]): string {
  return `MAP_THEMES:${createHash("sha256").update(JSON.stringify([userId ?? null, [...new Set(kitsuIds)].sort()])).digest("hex")}`;
}
