import { describe, expect, it } from "vitest";
import type { BrowserHomeResponse } from "../src/web/liveRoutes.js";
import { DrizzleBrowserHomeService } from "../src/web/homeService.js";

type QueryResult = Record<string, unknown>;

class FakeQuery {
  limitValue: number | undefined;
  whereValue: unknown;
  private readonly result: QueryResult[];

  constructor(result: QueryResult[]) {
    this.result = result;
  }

  from(): this { return this; }
  innerJoin(): this { return this; }
  leftJoin(): this { return this; }
  groupBy(): this { return this; }
  where(condition: unknown): this {
    this.whereValue = condition;
    return this;
  }
  orderBy(): this { return this; }
  limit(value: number): Promise<QueryResult[]> {
    this.limitValue = value;
    return Promise.resolve(this.result.slice(0, value));
  }
}

class FakeDb {
  readonly queries: FakeQuery[] = [];
  constructor(private readonly results: QueryResult[][]) {}

  select(): FakeQuery {
    const query = new FakeQuery(this.results[this.queries.length] ?? []);
    this.queries.push(query);
    return query;
  }
}

describe("DrizzleBrowserHomeService", () => {
  it("returns bounded, deterministic sections and server-owned poster URLs", async () => {
    const db = new FakeDb([
      [
        { kitsuId: "current/1", title: "Current One", posterUrl: "https://cdn.invalid/one.jpg", updatedAt: new Date("2026-08-20T00:00:00Z") },
        { kitsuId: "current-2", title: "Current Two", posterUrl: null, posterUrlLarge: "https://cdn.invalid/two.jpg", updatedAt: new Date("2026-08-19T00:00:00Z") },
        { kitsuId: "current-3", title: "Current Three", posterUrl: "https://cdn.invalid/three.jpg", updatedAt: new Date("2026-08-18T00:00:00Z") },
      ],
      [
        { kitsuId: "recent-1", title: "Recent One", posterUrl: "https://cdn.invalid/recent.jpg", updatedAt: new Date("2026-08-17T00:00:00Z") },
        { kitsuId: "recent-2", title: null, posterUrl: null, posterUrlLarge: null, updatedAt: new Date("2026-08-16T00:00:00Z") },
        { kitsuId: "recent-3", title: "Recent Three", posterUrl: null, posterUrlLarge: null, updatedAt: new Date("2026-08-15T00:00:00Z") },
      ],
      [
        { id: 12, name: "Watch later", itemCount: 2, isAuto: false, updatedAt: new Date("2026-08-14T00:00:00Z") },
        { id: 11, name: "Liked Songs", itemCount: 4, isAuto: true, updatedAt: new Date("2026-08-13T00:00:00Z") },
        { id: 10, name: "Old", itemCount: 1, isAuto: false, updatedAt: new Date("2026-08-12T00:00:00Z") },
      ],
    ]);
    const service = new DrizzleBrowserHomeService(db as never, () => new Date("2026-08-26T12:34:56.789Z"));

    const result = await service.getHome("user-1", { limit: 2, cursor: null });

    expect(result).toMatchObject<Partial<BrowserHomeResponse>>({
      serverTime: Date.parse("2026-08-26T12:34:56.789Z"),
      continueWatching: [
        { kitsuId: "current/1", title: "Current One", posterUrl: "/v1/media/images/anime/current%2F1/poster" },
        { kitsuId: "current-2", title: "Current Two", posterUrl: "/v1/media/images/anime/current-2/poster" },
      ],
      recentlyAdded: [
        { kitsuId: "recent-1", title: "Recent One", posterUrl: "/v1/media/images/anime/recent-1/poster" },
        { kitsuId: "recent-2", title: null, posterUrl: null },
      ],
      playlists: [
        { id: 12, name: "Watch later", itemCount: 2, isAuto: false },
        { id: 11, name: "Liked Songs", itemCount: 4, isAuto: true },
      ],
    });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.nextCursor).not.toContain("current/1");
    expect(db.queries.map((query) => query.limitValue)).toEqual([3, 3, 3]);
  });

  it("keeps an empty home response bounded without issuing external work", async () => {
    const db = new FakeDb([[], [], []]);
    const service = new DrizzleBrowserHomeService(db as never, () => new Date(0));

    await expect(service.getHome("user-1", { limit: 100, cursor: null })).resolves.toEqual({
      serverTime: 0,
      continueWatching: [],
      recentlyAdded: [],
      playlists: [],
      nextCursor: null,
    });
    expect(db.queries).toHaveLength(3);
    expect(db.queries.every((query) => query.limitValue === 101)).toBe(true);
  });
});
