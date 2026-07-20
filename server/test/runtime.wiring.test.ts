import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server runtime wiring", () => {
  it("routes AnimeThemes media fetches through the shared upstream HTTP guard", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toContain("const animeThemesFetch");
    expect(source).toMatch(/new MediaStore\(\{[\s\S]*fetch:\s*animeThemesFetch[\s\S]*\}\)/);
    expect(source).toMatch(/new MediaStreamingService\(\{[\s\S]*fetch:\s*animeThemesFetch[\s\S]*\}\)/);
  });

  it("wires validated music import work with the Lidarr shared mount and separate recovery lanes", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toContain("createMusicImportHandlers");
    expect(source).toContain("MusicAcquisitionImportService");
    expect(source).toContain("PgMusicAcquisitionImportRepository");
    expect(source).toMatch(/config\.MUSIC_PROVIDER === "LIDARR"[\s\S]*providerImportRoot:\s*config\.LIDARR_PATH_PREFIX_TO \?\? config\.LIDARR_SHARED_ROOT!/);
    expect(source).toMatch(/new MusicAcquisitionImportService\(\{[\s\S]*repo:\s*new PgMusicAcquisitionImportRepository\(pool\)[\s\S]*provider:\s*musicProvider[\s\S]*mediaStore[\s\S]*\}\)/);
    expect(source).toMatch(/const musicImportHandlers = createMusicImportHandlers\(\{[\s\S]*enabled:\s*discoveryEnabled[\s\S]*service:\s*musicImportService[\s\S]*\}\)/);
    expect(source).toMatch(/for \(const acquisitionId of await discoveryCatalog\.listRecoverableAcquisitionIds\(\)\)[\s\S]*RECONCILE_MUSIC_ACQUISITION/);
    expect(source).toMatch(/for \(const acquisitionId of await discoveryCatalog\.listRecoverableImportIds\(\)\)[\s\S]*IMPORT_MUSIC_AUDIO/);
    expect(source).toMatch(/handlers: \{ \.\.\.fetchHandlers, \.\.\.syncHandlers, \.\.\.discoveryHandlers, \.\.\.musicImportHandlers \}/);
  });

  it("wires listener catalog visibility into client, search, and song streaming services", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toMatch(/new DrizzleClientApiService\([\s\S]*config\.MUSIC_CATALOG_ENABLED[\s\S]*\)/);
    expect(source).toMatch(/new MediaStreamingService\(\{[\s\S]*musicCatalogEnabled:\s*config\.MUSIC_CATALOG_ENABLED[\s\S]*\}\)/);
    expect(source).toMatch(/new CachedProxyService\(\{[\s\S]*musicSearch:\s*\(userId, query\) => clientApi\.searchMusic\(userId, query\)[\s\S]*\}\)/);
  });
});
