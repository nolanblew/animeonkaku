import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { animeMusicRequests } from "../src/db/schema.js";

describe("music request scope migration contract", () => {
  it("models scope and one active request per anime and scope", () => {
    const config = getTableConfig(animeMusicRequests);
    expect(config.columns.map((column) => column.name)).toContain("scope");
    expect(config.indexes.map((index) => index.config.name)).toContain("anime_music_requests_one_active_scope_unique");
  });

  it("ships migration 0021 with conservative historical backfills and matching metadata", async () => {
    const sql = await readFile(new URL("../drizzle/0021_music_request_scopes.sql", import.meta.url), "utf8");
    const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    const snapshot = JSON.parse(await readFile(new URL("../drizzle/meta/0021_snapshot.json", import.meta.url), "utf8"));

    expect(sql).toMatch(/ADD COLUMN.+scope.+LEGACY_ALL/is);
    expect(sql).toMatch(/source\s*=\s*'ADMIN_REIMPORT'.+FULL_SONGS/is);
    expect(sql).toMatch(/DROP INDEX.+one_active_anime_unique/is);
    expect(sql).toMatch(/CREATE UNIQUE INDEX.+one_active_scope_unique.+animethemes_anime_id.+scope.+completed_at.+IS NULL/is);
    expect(journal.entries.at(-1)).toMatchObject({ idx: 21, tag: "0021_music_request_scopes" });
    expect(snapshot.tables["public.anime_music_requests"].columns.scope).toMatchObject({ notNull: true });
  });
});
