import { describe, expect, it } from "vitest";
import { rankTopPickCandidates, type TopPickCandidate } from "../src/api/topPicksService.js";

const candidate = (itemId: number, overrides: Partial<TopPickCandidate> = {}): TopPickCandidate => ({
  itemType: "THEME",
  itemId,
  animeKey: `anime-${itemId}`,
  liked: false,
  playCount: 0,
  lastPlayedAt: null,
  ...overrides,
});

describe("Top picks ranking", () => {
  it("round-robins favorites, most played, and discovery without duplicates", () => {
    const result = rankTopPickCandidates([
      candidate(1, { liked: true, playCount: 9 }),
      candidate(2, { playCount: 7 }),
      candidate(3),
      candidate(4, { playCount: 2 }),
    ], "user:2026-09-15", 4);

    expect(result).toHaveLength(4);
    expect(result.slice(0, 3).map((item) => item.reason)).toEqual(["FAVORITE", "MOST_PLAYED", "DISCOVERY"]);
    expect(new Set(result.map((item) => `${item.itemType}:${item.itemId}`)).size).toBe(4);
    expect(result[0]).toMatchObject({ itemType: "THEME", itemId: 1, reason: "FAVORITE" });
    expect(result[1]).toMatchObject({ itemType: "THEME", itemId: 2, reason: "MOST_PLAYED" });
  });

  it("is stable for one seed and prefers anime variety while choices remain", () => {
    const values = [
      candidate(10, { animeKey: "same", liked: true }),
      candidate(11, { animeKey: "same", playCount: 8 }),
      candidate(12, { animeKey: "different" }),
      candidate(13, { animeKey: "different", playCount: 7 }),
    ];
    const first = rankTopPickCandidates(values, "stable", 3);
    const second = rankTopPickCandidates(values, "stable", 3);

    expect(second).toEqual(first);
    expect(first.slice(0, 2).map((item) => item.itemId)).toEqual([10, 13]);
  });
});
