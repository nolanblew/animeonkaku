import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server runtime wiring", () => {
  it("routes AnimeThemes media fetches through the shared upstream HTTP guard", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toContain("const animeThemesFetch");
    expect(source).toMatch(/new MediaStore\(\{[\s\S]*fetch:\s*animeThemesFetch[\s\S]*\}\)/);
    expect(source).toMatch(/new MediaStreamingService\(\{[\s\S]*fetch:\s*animeThemesFetch[\s\S]*\}\)/);
  });

  it("wires the hardcoded AMF client seam while leaving automatic acquisition off", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toContain("createAnimeMusicFetcherUpstreamHttp");
    expect(source).toContain("AnimeMusicFetcherClient");
    expect(source).toContain("const amfClient");
    expect(source).not.toMatch(/Lidarr|LIDARR/);
    expect(source).not.toContain("providerImportRoot");
    expect(source).not.toContain("MusicDiscoveryScheduler");
    expect(source).not.toContain("createMusicDiscoveryHandlers");
    expect(source).not.toContain("createMusicImportHandlers");
    expect(source).not.toContain("listRecoverableAcquisitionIds");
    expect(source).not.toContain("listRecoverableImportIds");
    expect(source).toMatch(/handlers: \{ \.\.\.fetchHandlers, \.\.\.syncHandlers \}/);
  });

  it("wires listener catalog visibility into client, search, and song streaming services", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toMatch(/new DrizzleClientApiService\([\s\S]*config\.MUSIC_CATALOG_ENABLED[\s\S]*\)/);
    expect(source).toMatch(/new MediaStreamingService\(\{[\s\S]*musicCatalogEnabled:\s*config\.MUSIC_CATALOG_ENABLED[\s\S]*\}\)/);
    expect(source).toMatch(/new CachedProxyService\(\{[\s\S]*musicSearch:\s*\(userId, query\) => clientApi\.searchMusic\(userId, query\)[\s\S]*\}\)/);
  });
});
