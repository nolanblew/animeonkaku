import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";

const adminDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!adminDatabaseUrl)("music catalog migration", () => {
  it("preserves populated TV media and duplicate playlist occurrences when startup runs twice", async () => {
    const databaseName = `ongaku_migration_${process.pid}_${Date.now()}`;
    const admin = new Client({ connectionString: adminDatabaseUrl });
    const databaseUrl = new URL(adminDatabaseUrl!);
    databaseUrl.pathname = `/${databaseName}`;
    const baselineFolder = await createBaselineMigrationFolder();
    let pool: Pool | undefined;

    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      pool = new Pool({ connectionString: databaseUrl.toString() });
      const db = drizzle(pool);

      await migrate(db, { migrationsFolder: baselineFolder });
      await seedCurrentSchema(pool);

      await runMigrations(db);
      await runMigrations(db);

      const entries = await pool.query<{
        id: string;
        item_type: string;
        item_id: string;
        order_index: number;
        mode_override: string | null;
      }>(
        `SELECT id, item_type, item_id, order_index, mode_override
           FROM playlist_entries
          ORDER BY order_index, id`,
      );
      expect(entries.rows).toHaveLength(2);
      expect(new Set(entries.rows.map((row) => row.id)).size).toBe(2);
      expect(entries.rows.map((row) => ({
        itemType: row.item_type,
        itemId: Number(row.item_id),
        orderIndex: row.order_index,
        modeOverride: row.mode_override,
      }))).toEqual([
        { itemType: "THEME", itemId: 101, orderIndex: 0, modeOverride: null },
        { itemType: "THEME", itemId: 101, orderIndex: 1, modeOverride: null },
      ]);

      const playlist = await pool.query<{ default_mode: string }>(
        "SELECT default_mode FROM playlists",
      );
      expect(playlist.rows).toEqual([{ default_mode: "TV_SIZE" }]);

      const media = await pool.query<{
        kind: string;
        ref_id: string;
        variant: string;
        state: string;
        file_path: string;
        content_type: string | null;
        source_file_name: string | null;
      }>(
        `SELECT kind, ref_id, variant, state, file_path, content_type, source_file_name
           FROM media_files`,
      );
      expect(media.rows).toEqual([{
        kind: "AUDIO",
        ref_id: "101",
        variant: "SHORT",
        state: "READY",
        file_path: "audio/101.ogg",
        content_type: null,
        source_file_name: null,
      }]);

      for (const table of ["users", "animethemes_anime", "themes", "jobs", "theme_prefs"]) {
        const result = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
        expect(Number(result.rows[0]?.count)).toBe(1);
      }
    } finally {
      await pool?.end();
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
        [databaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
      await rm(baselineFolder, { recursive: true, force: true });
    }
  }, 60_000);
});

async function createBaselineMigrationFolder(): Promise<string> {
  const sourceFolder = new URL("../drizzle/", import.meta.url);
  const folder = await mkdtemp(join(tmpdir(), "ongaku-baseline-migrations-"));
  await mkdir(join(folder, "meta"));
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", sourceFolder), "utf8"),
  ) as { version: string; dialect: string; entries: Array<{ idx: number; tag: string }> };
  const baselineJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx <= 7),
  };
  await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify(baselineJournal));
  for (const entry of baselineJournal.entries) {
    await cp(
      new URL(`${entry.tag}.sql`, sourceFolder),
      join(folder, `${entry.tag}.sql`),
    );
  }
  return folder;
}

async function seedCurrentSchema(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO users (kitsu_user_id, username) VALUES ('fixture-user', 'Fixture');
    INSERT INTO animethemes_anime (id, name) VALUES (10, 'Fixture Anime');
    INSERT INTO themes (id, animethemes_anime_id, title, audio_origin_url)
      VALUES (101, 10, 'Fixture Song', 'https://example.invalid/fixture.ogg');
    INSERT INTO playlists (id, user_id, name) VALUES (201, 'fixture-user', 'Duplicates');
    INSERT INTO playlist_entries (playlist_id, theme_id, order_index) VALUES
      (201, 101, 0),
      (201, 101, 1);
    INSERT INTO theme_prefs (user_id, theme_id, liked, play_count)
      VALUES ('fixture-user', 101, true, 4);
    INSERT INTO media_files (
      kind, ref_id, variant, origin_url, state, file_path, byte_size, sha256
    ) VALUES (
      'AUDIO', '101', 'SHORT', 'https://example.invalid/fixture.ogg',
      'READY', 'audio/101.ogg', 1234, 'fixture-sha'
    );
    INSERT INTO jobs (type, priority, state, payload, progress)
      VALUES ('FETCH_AUDIO', 20, 'DONE', '{"themeId":101}', '{}');
  `);
}
