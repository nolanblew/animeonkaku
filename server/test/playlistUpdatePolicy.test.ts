import { describe, expect, it } from "vitest";
import { autoPlaylistUpdateIsAllowed } from "../src/api/drizzleClientApiService.js";

describe("auto playlist update policy", () => {
  it("allows changing only the preferred version", () => {
    expect(autoPlaylistUpdateIsAllowed({ defaultMode: "FULL_SIZE", opTs: 10 })).toBe(true);
    expect(autoPlaylistUpdateIsAllowed({ defaultMode: "TV_SIZE" })).toBe(true);
    expect(autoPlaylistUpdateIsAllowed({ overrideUserPreference: true })).toBe(true);
  });

  it("keeps auto playlist contents and identity read only", () => {
    expect(autoPlaylistUpdateIsAllowed({ name: "Renamed", defaultMode: "FULL_SIZE" })).toBe(false);
    expect(autoPlaylistUpdateIsAllowed({ defaultMode: "FULL_SIZE", entries: [1] })).toBe(false);
    expect(autoPlaylistUpdateIsAllowed({ defaultMode: "FULL_SIZE", items: [] })).toBe(false);
    expect(autoPlaylistUpdateIsAllowed({})).toBe(false);
  });
});
