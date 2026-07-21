import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnvironment = {
  DATABASE_URL: "postgres://fixture",
  MEDIA_ROOT: "C:/fixture/media",
};

describe("music provider configuration", () => {
  it("keeps the existing server startup configuration when catalog and discovery are disabled", () => {
    const config = loadConfig(baseEnvironment);

    expect(config).toMatchObject({
      MUSIC_CATALOG_ENABLED: false,
      MUSIC_DISCOVERY_ENABLED: false,
    });
  });

  it("removes obsolete Lidarr configuration while retaining rollout switches", () => {
    const config = loadConfig({
      ...baseEnvironment,
      MUSIC_PROVIDER: "LIDARR",
      LIDARR_BASE_URL: "https://lidarr.invalid",
      LIDARR_API_KEY: "secret",
    });

    expect(config).not.toHaveProperty("MUSIC_PROVIDER");
    expect(config).not.toHaveProperty("LIDARR_BASE_URL");
    expect(config).not.toHaveProperty("LIDARR_API_KEY");
  });
});
