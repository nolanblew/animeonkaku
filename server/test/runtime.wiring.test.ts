import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server runtime wiring", () => {
  it("routes AnimeThemes media fetches through the shared upstream HTTP guard", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toContain("const animeThemesFetch");
    expect(source).toMatch(/new MediaStore\(\{[\s\S]*fetch:\s*animeThemesFetch[\s\S]*\}\)/);
    expect(source).toMatch(/new MediaStreamingService\(\{[\s\S]*fetch:\s*animeThemesFetch[\s\S]*\}\)/);
  });
});
