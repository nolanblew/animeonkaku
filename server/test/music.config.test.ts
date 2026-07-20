import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createLidarrUpstreamHttp } from "../src/music/lidarrHttp.js";
import { TokenBucket } from "../src/http/tokenBucket.js";
import { fakeFetch } from "./helpers/fakeFetch.js";

const baseEnvironment = {
  DATABASE_URL: "postgres://fixture",
  MEDIA_ROOT: "C:/fixture/media",
};

const lidarrEnvironment = {
  ...baseEnvironment,
  MUSIC_PROVIDER: "LIDARR",
  LIDARR_BASE_URL: "https://lidarr.fixture.invalid",
  LIDARR_API_KEY: "not-in-the-url",
  LIDARR_ROOT_FOLDER_PATH: "/lidarr/music",
  LIDARR_SHARED_ROOT: "/shared/music",
  LIDARR_QUALITY_PROFILE_ID: "7",
  LIDARR_METADATA_PROFILE_ID: "8",
};

describe("music provider configuration", () => {
  it("keeps the existing server startup configuration when catalog and discovery are disabled", () => {
    const config = loadConfig(baseEnvironment);

    expect(config).toMatchObject({
      MUSIC_PROVIDER: "disabled",
      MUSIC_CATALOG_ENABLED: false,
      MUSIC_DISCOVERY_ENABLED: false,
    });
  });

  it("accepts a complete Lidarr configuration and optional paired path prefixes", () => {
    const config = loadConfig({
      ...lidarrEnvironment,
      LIDARR_PATH_PREFIX_FROM: "/downloads",
      LIDARR_PATH_PREFIX_TO: "/shared/downloads",
      LIDARR_OWNERSHIP_TAG_ID: "42",
    });

    expect(config).toMatchObject({
      MUSIC_PROVIDER: "LIDARR",
      LIDARR_QUALITY_PROFILE_ID: 7,
      LIDARR_METADATA_PROFILE_ID: 8,
      LIDARR_OWNERSHIP_TAG_ID: 42,
      LIDARR_PATH_PREFIX_FROM: "/downloads",
      LIDARR_PATH_PREFIX_TO: "/shared/downloads",
    });
  });

  it("fails fast with the missing Lidarr fields and incomplete path-prefix pair", () => {
    expect(() => loadConfig({ ...baseEnvironment, MUSIC_PROVIDER: "LIDARR" }))
      .toThrow(/LIDARR_BASE_URL.*LIDARR_API_KEY.*LIDARR_ROOT_FOLDER_PATH/);
    expect(() => loadConfig({ ...lidarrEnvironment, LIDARR_PATH_PREFIX_FROM: "/downloads" }))
      .toThrow(/LIDARR_PATH_PREFIX_FROM and LIDARR_PATH_PREFIX_TO must be set together/);
    expect(() => loadConfig({ ...baseEnvironment, MUSIC_DISCOVERY_ENABLED: "true" }))
      .toThrow(/MUSIC_DISCOVERY_ENABLED requires MUSIC_PROVIDER=LIDARR/);
  });

  it("uses the Lidarr API key only as an X-Api-Key background request header and redacts it from logs", async () => {
    const { fetch, requests } = fakeFetch([{ status: 200 }]);
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1 });
    const acquire = vi.spyOn(bucket, "acquire");
    const logs: unknown[] = [];
    const http = createLidarrUpstreamHttp({
      apiKey: "not-in-the-url",
      fetch,
      maxRetries: 0,
      bucket,
      logger: { info: (data, message) => logs.push({ data, message }) },
    });

    await http.request("https://lidarr.fixture.invalid/api/v1/album?term=fixture");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).not.toContain("not-in-the-url");
    expect(new Headers(requests[0]?.init?.headers).get("X-Api-Key")).toBe("not-in-the-url");
    expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBeNull();
    expect(acquire).toHaveBeenCalledWith("background");
    expect(JSON.stringify(logs)).not.toContain("not-in-the-url");
  });
});
