import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { themePrefs } from "../src/db/schema.js";

describe("per-theme preferred audio mode contract", () => {
  it("models a nullable preferred_mode on theme_prefs", () => {
    const config = getTableConfig(themePrefs);
    const column = config.columns.find((candidate) => candidate.name === "preferred_mode");

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
  });

  it("ships migration 0022 and matching Drizzle metadata", async () => {
    const sql = await readFile(new URL("../drizzle/0022_theme_preferred_mode.sql", import.meta.url), "utf8");
    const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    const snapshot = JSON.parse(await readFile(new URL("../drizzle/meta/0022_snapshot.json", import.meta.url), "utf8"));

    expect(sql).toMatch(/ALTER TABLE\s+"theme_prefs"\s+ADD COLUMN\s+"preferred_mode"\s+text/i);
    expect(sql).toMatch(/CHECK.+preferred_mode.+TV_SIZE.+FULL_SIZE/is);
    expect(journal.entries.at(-1)).toMatchObject({ idx: 22, tag: "0022_theme_preferred_mode" });
    expect(snapshot.tables["public.theme_prefs"].columns.preferred_mode).toMatchObject({ notNull: false });
  });

  it("exposes preferredMode in DTO and patch while validating the two audio values", async () => {
    const routes = await readFile(new URL("../src/api/clientRoutes.ts", import.meta.url), "utf8");
    expect(routes).toMatch(/interface ThemePrefDto[\s\S]+preferredMode:\s*PlaylistPlaybackMode\s*\|\s*null/);
    expect(routes).toMatch(/interface ThemePrefPatch[\s\S]+preferredMode\?:\s*PlaylistPlaybackMode\s*\|\s*null/);
    expect(routes).toMatch(/preferredMode:\s*z\.enum\(\["TV_SIZE",\s*"FULL_SIZE"\]\)\.nullable\(\)\.optional\(\)/);
  });
});
