import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server runtime wiring", () => {
  it("routes AnimeThemes media fetches through the shared upstream HTTP guard", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toContain("const animeThemesFetch");
    expect(source).toMatch(/new MediaStore\(\{[\s\S]*fetch:\s*animeThemesFetch[\s\S]*\}\)/);
    expect(source).toMatch(/new MediaStreamingService\(\{[\s\S]*fetch:\s*animeThemesFetch[\s\S]*\}\)/);
  });

  it("wires durable AMF requests and validated delivery import while leaving automatic discovery off", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toContain("createAnimeMusicFetcherUpstreamHttp");
    expect(source).toContain("AnimeMusicFetcherClient");
    expect(source).toContain("const amfClient");
    expect(source).not.toMatch(/Lidarr|LIDARR/);
    expect(source).toContain("providerImportRoot: config.AMF_LIBRARY_ROOT");
    expect(source).toContain("createAmfDeliveryImportHandlers");
    expect(source).toContain("createFullSizeReimportHandlers");
    expect(source).toContain("new PgFullSizeReimportCleanup(pool, config.MEDIA_ROOT)");
    expect(source).not.toContain("MusicDiscoveryScheduler");
    expect(source).not.toContain("createMusicDiscoveryHandlers");
    expect(source).not.toContain("createMusicImportHandlers");
    expect(source).not.toContain("listRecoverableAcquisitionIds");
    expect(source).not.toContain("listRecoverableImportIds");
    expect(source).toMatch(/const jobHandlers = \{ \.\.\.fetchHandlers, \.\.\.syncHandlers, \.\.\.musicRequestHandlers,[\s\S]*\.\.\.fullSizeReimportHandlers,[\s\S]*\.\.\.musicSearchPolicyHandlers, \.\.\.loudnessHandlers \}/);
    expect(source.match(/handlers: jobHandlers/g)).toHaveLength(2);
    expect(source).toContain("musicOperator: musicOperatorService");
    expect(source).toContain("musicSearchSettings: musicSearchPolicy");
    expect(source).toContain("musicSearchPolicyScheduler.start()");
  });

  it("wires listener catalog visibility into client, search, and song streaming services", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toMatch(/new DrizzleClientApiService\([\s\S]*config\.MUSIC_CATALOG_ENABLED[\s\S]*\)/);
    expect(source).toMatch(/new MediaStreamingService\(\{[\s\S]*musicCatalogEnabled:\s*config\.MUSIC_CATALOG_ENABLED[\s\S]*\}\)/);
    expect(source).toMatch(/new CachedProxyService\(\{[\s\S]*musicSearch:\s*\(userId, query\) => clientApi\.searchMusic\(userId, query\)[\s\S]*\}\)/);
  });

  it("constructs one browser live hub and Drizzle home projection for the API app", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source).toContain('import { DrizzleBrowserHomeService } from "./web/homeService.js"');
    expect(source).toContain('import { LiveLibraryHub } from "./web/liveRoutes.js"');
    expect(source).toMatch(/const liveHub = new LiveLibraryHub\(\)/);
    expect(source).toMatch(/const browserHomeService = new DrizzleBrowserHomeService\(db\)/);
    expect(source).toContain("webLive: { hub: liveHub, home: browserHomeService }");
  });
});
