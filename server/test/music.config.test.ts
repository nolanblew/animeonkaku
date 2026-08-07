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

  it("accepts a separate server-readable AMF library staging root", () => {
    expect(loadConfig({ ...baseEnvironment, AMF_LIBRARY_ROOT: "F:/anime-fetcher/library" }).AMF_LIBRARY_ROOT)
      .toBe("F:/anime-fetcher/library");
    expect(loadConfig(baseEnvironment).AMF_LIBRARY_ROOT).toBeUndefined();
  });

  it.each([
    ["uppercase, lowercase, and number", "Abc123"],
    ["uppercase, lowercase, and special", "Abc!@#"],
    ["uppercase, number, and special", "ABC1!@"],
    ["lowercase, number, and special", "abc1!@"],
    ["uppercase, space, and special", "AB !@?"],
  ])("accepts a six-character production admin password with exactly three categories: %s", (_description, password) => {
    expect(loadConfig({ ...baseEnvironment, NODE_ENV: "production", ADMIN_PASSWORD: password }).ADMIN_PASSWORD)
      .toBe(password);
  });

  it.each([
    ["is shorter than six characters despite containing every category", "Ab1!"],
    ["uses only one category", "123456"],
    ["uses only two categories", "Abcdef"],
  ])("rejects a production admin password that %s", (_description, password) => {
    expect(() => loadConfig({ ...baseEnvironment, NODE_ENV: "production", ADMIN_PASSWORD: password }))
      .toThrow(/ADMIN_PASSWORD/i);
  });

  it("retains the default admin password in the test environment", () => {
    expect(loadConfig({ ...baseEnvironment, NODE_ENV: "test" }).ADMIN_PASSWORD).toBe("Password123");
  });
});
