import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("playlist last-write-wins contract", () => {
  it("uses a dedicated client mutation clock instead of server updated_at", async () => {
    const schema = await readFile(new URL("../src/db/schema.ts", import.meta.url), "utf8");
    const service = await readFile(new URL("../src/api/drizzleClientApiService.ts", import.meta.url), "utf8");

    expect(schema).toContain('mutationUpdatedAt: timestamp("mutation_updated_at"');
    expect(service).toContain("mutationUpdatedAt: playlists.mutationUpdatedAt");
    expect(service).toContain("existing.mutationUpdatedAt");
  });
});
