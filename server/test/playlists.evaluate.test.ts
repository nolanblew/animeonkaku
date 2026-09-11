import { describe, expect, it } from "vitest";
import {
  buildComparator,
  categoricalRank,
  evaluate,
  matches,
  type EvalAnime,
  type EvalContext,
  type EvalTheme,
} from "../src/playlists/evaluate.js";

const NOW = Date.UTC(2026, 5, 15); // 2026-06-15

function theme(id: number, over: Partial<EvalTheme> = {}): EvalTheme {
  return {
    id,
    title: `Song ${id}`,
    themeType: "OP1",
    artistName: null,
    animeThemesId: id,
    ...over,
  };
}

function anime(over: Partial<EvalAnime> = {}): EvalAnime {
  return {
    title: "Anime",
    startDate: "2015-04-05",
    subtype: "TV",
    averageRating: 8,
    userRating: 9,
    watchingStatus: "current",
    libraryUpdatedAt: Date.UTC(2026, 0, 1),
    kitsuId: "k1",
    ...over,
  };
}

function ctx(themes: EvalTheme[], animeByThemesId: Map<number, EvalAnime>, over: Partial<EvalContext> = {}): EvalContext {
  return {
    themes,
    animeByThemesId,
    genresByKitsuId: new Map(),
    likedThemeIds: new Set(),
    dislikedThemeIds: new Set(),
    downloadedThemeIds: new Set(),
    playCountByTheme: new Map(),
    lastPlayedByTheme: new Map(),
    nowMillis: NOW,
    ...over,
  };
}

describe("matches — boolean operators", () => {
  it("current OR liked OR watched within six months excludes planned edits and broad dislikes", () => {
    const themes = [1, 2, 3, 4, 5, 6].map(id => theme(id, { animeThemesId: id }));
    const library = new Map([
      [1, anime({ watchingStatus: "planned", libraryUpdatedAt: NOW, watchedAt: null })],
      [2, anime({ watchingStatus: "current", watchedAt: null })],
      [3, anime({ watchingStatus: "completed", watchedAt: NOW - 86400000 })],
      [4, anime({ watchingStatus: "planned", watchedAt: null })],
      [5, anime({ watchingStatus: "completed", watchedAt: NOW - 86400000 })],
      [6, anime({ watchingStatus: "completed", libraryUpdatedAt: NOW, watchedAt: Date.UTC(2020, 0, 1) })],
    ]);
    const context = ctx(themes, library, { likedThemeIds: new Set([4]), dislikedThemeIds: new Set([5]) });
    const filter = { type: "and", children: [
      { type: "or", children: [
        { type: "watching_status_in", statuses: ["current"] },
        { type: "liked" },
        { type: "watched_on", operator: "GT", anchor: { type: "relative", unit: "MONTHS", amount: 6 } },
      ] },
      { type: "not", child: { type: "disliked" } },
    ] };
    expect(evaluate(filter, null, context).sort()).toEqual([2, 3, 4]);
    expect(matches({ type: "library_updated_within", durationMillis: 180 * 86400000 }, themes[0]!, context)).toBe(false);
  });
  const t = theme(1);
  const c = ctx([t], new Map([[1, anime()]]));

  it("empty AND matches everything, empty OR matches nothing", () => {
    expect(matches({ type: "and", children: [] }, t, c)).toBe(true);
    expect(matches({ type: "or", children: [] }, t, c)).toBe(false);
  });

  it("NOT inverts", () => {
    expect(matches({ type: "not", child: { type: "liked" } }, t, c)).toBe(true);
  });

  it("AND requires all, OR requires any", () => {
    const liked = { type: "liked" };
    const op = { type: "theme_type_in", types: ["OP"] };
    expect(matches({ type: "and", children: [liked, op] }, t, c)).toBe(false);
    expect(matches({ type: "or", children: [liked, op] }, t, c)).toBe(true);
  });
});

describe("matches — leaves", () => {
  it("genre_in any vs all", () => {
    const c = ctx([theme(1)], new Map([[1, anime()]]), {
      genresByKitsuId: new Map([["k1", new Set(["action", "music"])]]),
    });
    expect(matches({ type: "genre_in", slugs: ["music"] }, theme(1), c)).toBe(true);
    expect(matches({ type: "genre_in", slugs: ["music", "drama"], matchAll: true }, theme(1), c)).toBe(false);
    expect(matches({ type: "genre_in", slugs: ["music", "action"], matchAll: true }, theme(1), c)).toBe(true);
  });

  it("aired_on GT is inclusive of the anchor year, LT exclusive", () => {
    const c = ctx([theme(1)], new Map([[1, anime({ startDate: "2015-04-05" })]]));
    const gt2015 = { type: "aired_on", operator: "GT", anchor: { type: "absolute_year", year: 2015 } };
    const lt2015 = { type: "aired_on", operator: "LT", anchor: { type: "absolute_year", year: 2015 } };
    expect(matches(gt2015, theme(1), c)).toBe(true);
    expect(matches(lt2015, theme(1), c)).toBe(false);
  });

  it("aired_on relative anchor resolves against now", () => {
    const c = ctx([theme(1)], new Map([[1, anime({ startDate: "2024-01-01" })]]));
    // 5 years before 2026 -> 2021; 2024 >= 2021 so GT matches.
    const node = { type: "aired_on", operator: "GT", anchor: { type: "relative", unit: "YEARS", amount: 5 } };
    expect(matches(node, theme(1), c)).toBe(true);
  });

  it("season_in maps months to seasons", () => {
    const c = ctx([theme(1)], new Map([[1, anime({ startDate: "2015-04-05" })]]));
    expect(matches({ type: "season_in", seasons: ["SPRING"] }, theme(1), c)).toBe(true);
    expect(matches({ type: "season_in", seasons: ["WINTER"] }, theme(1), c)).toBe(false);
  });

  it("watched_on GT is strict", () => {
    const c = ctx([theme(1)], new Map([[1, anime({ watchedAt: Date.UTC(2026, 0, 1) })]]));
    const node = { type: "watched_on", operator: "GT", anchor: { type: "absolute_year", year: 2025 } };
    expect(matches(node, theme(1), c)).toBe(true);
  });

  it("liked and disliked use sets while downloaded is a broad server-side match", () => {
    const c = ctx([theme(1)], new Map([[1, anime()]]), { likedThemeIds: new Set([1]) });
    expect(matches({ type: "liked" }, theme(1), c)).toBe(true);
    expect(matches({ type: "disliked" }, theme(1), c)).toBe(false);
    expect(matches({ type: "downloaded" }, theme(1), c)).toBe(true);
  });

  it("negated downloaded filters stay broad server-side for device overlay", () => {
    const c = ctx([theme(1)], new Map([[1, anime()]]));
    expect(matches({ type: "not", child: { type: "downloaded" } }, theme(1), c)).toBe(true);
  });

  it("play_count_gte and song/anime title matching", () => {
    const c = ctx([theme(1, { title: "Gurenge" })], new Map([[1, anime({ title: "Demon Slayer" })]]), {
      playCountByTheme: new Map([[1, 7]]),
    });
    expect(matches({ type: "play_count_gte", min: 5 }, theme(1, { title: "Gurenge" }), c)).toBe(true);
    expect(matches({ type: "song_title_matches", pattern: "guren" }, theme(1, { title: "Gurenge" }), c)).toBe(true);
    expect(matches({ type: "title_matches", pattern: "slayer" }, theme(1, { title: "Gurenge" }), c)).toBe(true);
    expect(matches({ type: "song_title_matches", pattern: "^Gur", isRegex: true }, theme(1, { title: "Gurenge" }), c)).toBe(true);
  });

  it("unknown node types never match", () => {
    expect(matches({ type: "totally_unknown" }, theme(1), ctx([theme(1)], new Map([[1, anime()]])))).toBe(false);
  });
});

describe("categoricalRank", () => {
  it("ranks by prefix and pushes unknowns last", () => {
    const order = ["OP", "IN", "ED"];
    expect(categoricalRank("OP", order)).toBe(0);
    expect(categoricalRank("ED", order)).toBe(2);
    expect(categoricalRank("XX", order)).toBe(3);
    expect(categoricalRank(null, order)).toBe(3);
  });
});

describe("evaluate — sort + fallback", () => {
  it("sorts by play count desc then default order, nulls last", () => {
    const themes = [theme(1), theme(2), theme(3)];
    const animeMap = new Map([
      [1, anime({ title: "Bbb" })],
      [2, anime({ title: "Aaa" })],
      [3, anime({ title: "Ccc" })],
    ]);
    const c = ctx(themes, animeMap, { playCountByTheme: new Map([[1, 10], [2, 10], [3, 1]]) });
    const sort = { keys: [{ attribute: "PLAY_COUNT", direction: "DESC" }] };
    // 1 and 2 tie on count (10); fallback orders by anime title (Aaa < Bbb). 3 last (count 1).
    expect(evaluate({ type: "and", children: [] }, sort, c)).toEqual([2, 1, 3]);
  });

  it("RANDOM sort is deterministic for a fixed now", () => {
    const themes = [theme(1), theme(2), theme(3), theme(4)];
    const animeMap = new Map(themes.map((t) => [t.id, anime()] as const));
    const c = ctx(themes, animeMap);
    const sort = { keys: [{ attribute: "RANDOM" }] };
    const first = evaluate({ type: "and", children: [] }, sort, c);
    const second = evaluate({ type: "and", children: [] }, sort, c);
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual([1, 2, 3, 4]);
  });

  it("buildComparator places null sort values last regardless of direction", () => {
    const withRating = theme(1);
    const without = theme(2);
    const c = ctx([withRating, without], new Map([
      [1, anime({ averageRating: 5 })],
      [2, anime({ averageRating: null })],
    ]));
    const cmp = buildComparator({ keys: [{ attribute: "AVERAGE_RATING", direction: "DESC" }] }, c);
    expect(cmp(withRating, without)).toBeLessThan(0);
    expect(cmp(without, withRating)).toBeGreaterThan(0);
  });

  it("DOWNLOADED sort is neutral server-side", () => {
    const themes = [theme(1), theme(2), theme(3)];
    const animeMap = new Map([
      [1, anime({ title: "Bbb" })],
      [2, anime({ title: "Aaa" })],
      [3, anime({ title: "Ccc" })],
    ]);
    const c = ctx(themes, animeMap, { downloadedThemeIds: new Set([3]) });
    const sort = { keys: [{ attribute: "DOWNLOADED", direction: "ASC" }] };

    expect(evaluate({ type: "and", children: [] }, sort, c)).toEqual([2, 1, 3]);
  });

  it("supports grouped and interleaved natural OP/ED order with deterministic ties", () => {
    const themes = [
      theme(11, { themeType: "ED2" }),
      theme(12, { themeType: "OP2" }),
      theme(13, { themeType: "IN1" }),
      theme(14, { themeType: "ED1" }),
      theme(15, { themeType: "OP1" }),
      theme(16, { themeType: "OP1" }),
    ];
    const animeMap = new Map(themes.map((item) => [item.id, anime({ title: "Same" })] as const));
    const c = ctx(themes, animeMap);

    expect(evaluate({ type: "and", children: [] }, {
      keys: [{ attribute: "THEME_ORDER_GROUPED" }],
    }, c)).toEqual([15, 16, 12, 14, 11, 13]);
    expect(evaluate({ type: "and", children: [] }, {
      keys: [{ attribute: "THEME_ORDER_INTERLEAVED" }],
    }, c)).toEqual([15, 16, 14, 12, 11, 13]);
  });
});
