import { describe, expect, it } from "vitest";
import { orderedThemeIdsMatch } from "../src/sync/autoPlaylistRefresher.js";

describe("DrizzleAutoPlaylistRefresher helpers", () => {
  it("detects unchanged materialized playlist entries without sorting them", () => {
    expect(orderedThemeIdsMatch([100, 101, 102], [100, 101, 102])).toBe(true);
    expect(orderedThemeIdsMatch([100, 102, 101], [100, 101, 102])).toBe(false);
    expect(orderedThemeIdsMatch([100, 101], [100, 101, 102])).toBe(false);
  });
});
