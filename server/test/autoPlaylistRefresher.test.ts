import { describe, expect, it } from "vitest";
import {
  currentlyWatchingThemeIds,
  orderedThemeIdsMatch,
} from "../src/sync/autoPlaylistRefresher.js";

describe("DrizzleAutoPlaylistRefresher helpers", () => {
  it("detects unchanged materialized playlist entries without sorting them", () => {
    expect(orderedThemeIdsMatch([100, 101, 102], [100, 101, 102])).toBe(true);
    expect(orderedThemeIdsMatch([100, 102, 101], [100, 101, 102])).toBe(false);
    expect(orderedThemeIdsMatch([100, 101], [100, 101, 102])).toBe(false);
  });

  it("orders Currently Watching by newest anime, then grouped natural OP/ED order", () => {
    expect(currentlyWatchingThemeIds([
      { themeId: 18, animeThemesId: 30, libraryUpdatedAt: null, themeType: "ED1" },
      { themeId: 13, animeThemesId: 20, libraryUpdatedAt: 200, themeType: "ED2" },
      { themeId: 12, animeThemesId: 20, libraryUpdatedAt: 200, themeType: "OP2" },
      { themeId: 11, animeThemesId: 20, libraryUpdatedAt: 200, themeType: "OP1" },
      { themeId: 14, animeThemesId: 10, libraryUpdatedAt: 100, themeType: "OP1" },
      { themeId: 15, animeThemesId: 10, libraryUpdatedAt: 100, themeType: "ED1" },
      { themeId: 16, animeThemesId: 10, libraryUpdatedAt: 100, themeType: "IN1" },
      { themeId: 17, animeThemesId: 30, libraryUpdatedAt: null, themeType: "OP1" },
      { themeId: 19, animeThemesId: 40, libraryUpdatedAt: 200, themeType: null },
      { themeId: 20, animeThemesId: 40, libraryUpdatedAt: 200, themeType: "OP1" },
    ])).toEqual([
      11, 12, 13, // anime 20 (newest), OP1, OP2, ED2
      20, 19,     // tied anime falls back to AnimeThemes id; numbered theme before null
      14, 15, 16, // anime 10, OP1, ED1, then remaining types
      17, 18,     // null update time is last, still OP before ED
    ]);
  });
});
