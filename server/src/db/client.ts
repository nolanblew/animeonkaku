import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type Db = NodePgDatabase<Record<string, never>>;

export function createDb(databaseUrl: string): { pool: pg.Pool; db: Db } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const db = drizzle(pool);
  return { pool, db };
}
