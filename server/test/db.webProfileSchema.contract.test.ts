import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { users } from "../src/db/schema.js";

describe("web profile schema contract", () => {
  it("keeps display name and avatar path local to the user record", () => {
    const config = getTableConfig(users);
    expect(config.columns.find((column) => column.name === "display_name")).toMatchObject({ notNull: false });
    expect(config.columns.find((column) => column.name === "avatar_path")).toMatchObject({ notNull: false });
  });

  it("ships the additive users migration and journal entry", async () => {
    const sql = await readFile(new URL("../drizzle/0024_petite_carlie_cooper.sql", import.meta.url), "utf8");
    const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    expect(sql).toMatch(/ALTER TABLE\s+"users"\s+ADD COLUMN\s+"display_name"\s+text/i);
    expect(sql).toMatch(/ALTER TABLE\s+"users"\s+ADD COLUMN\s+"avatar_path"\s+text/i);
    expect(journal.entries.find((entry: { tag: string }) => entry.tag === "0024_petite_carlie_cooper")).toMatchObject({ idx: 24 });
  });
});
