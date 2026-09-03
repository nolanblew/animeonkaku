import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost/test",
  MEDIA_ROOT: "./media",
};

describe("web server configuration", () => {
  it("accepts an explicit public origin and web distribution path", () => {
    const config = loadConfig({
      ...baseEnv,
      WEB_PUBLIC_ORIGIN: "https://music.example",
      WEB_DIST_PATH: "/app/web",
    });
    expect(config.WEB_PUBLIC_ORIGIN).toBe("https://music.example");
    expect(config.WEB_DIST_PATH).toBe("/app/web");
  });

  it("rejects a public origin that is not an absolute HTTP(S) URL", () => {
    expect(() => loadConfig({ ...baseEnv, WEB_PUBLIC_ORIGIN: "music.example" })).toThrow(
      /WEB_PUBLIC_ORIGIN/,
    );
  });

  it("accepts a distinct canonical public origin for Sonos links and media", () => {
    const config = loadConfig({
      ...baseEnv,
      WEB_PUBLIC_ORIGIN: "https://ongaku-api.example",
      SONOS_PUBLIC_ORIGIN: "https://ongaku.example",
      SONOS_SMAPI_ENABLED: "true",
    });
    expect(config.SONOS_PUBLIC_ORIGIN).toBe("https://ongaku.example");
  });

  it("rejects an invalid Sonos public origin", () => {
    expect(() => loadConfig({ ...baseEnv, SONOS_PUBLIC_ORIGIN: "ongaku.example" })).toThrow(
      /SONOS_PUBLIC_ORIGIN/,
    );
  });
});
