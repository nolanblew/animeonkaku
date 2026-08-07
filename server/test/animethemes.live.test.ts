import { describe, expect, it } from "vitest";
import { AnimeThemesClient } from "../src/animethemes/client.js";
import { UpstreamHttp } from "../src/http/upstream.js";

const runLive = process.env.ANIMETHEMES_LIVE_TEST === "1";

describe.skipIf(!runLive)("AnimeThemesClient live endpoint smoke", () => {
  it("can map a documented MAL resource id to AnimeThemes catalog rows", async () => {
    const client = new AnimeThemesClient({
      http: new UpstreamHttp({ name: "animethemes-live", maxRetries: 0 }),
    });

    const result = await client.fetchByMalIds(["41457"]);

    expect(result.mappings.get("41457")).toEqual(expect.any(Number));
    expect(result.themes.length).toBeGreaterThan(0);
  }, 15_000);

  it("can reach the AnimeThemes search endpoint from the server client", async () => {
    const client = new AnimeThemesClient({
      http: new UpstreamHttp({ name: "animethemes-live", maxRetries: 0 }),
    });

    const response = await client.search("naruto");

    expect(response).toEqual(
      expect.objectContaining({
        search: expect.any(Object),
      }),
    );
  }, 15_000);
});
