import { describe, expect, it } from "vitest";
import { CachedProxyService } from "../src/api/proxyRoutes.js";

describe("CachedProxyService", () => {
  it("caches legacy search keys while composing fresh user-scoped music results", async () => {
    let now = 1000;
    const calls: string[] = [];
    const proxy = new CachedProxyService({
      ttlMs: 500,
      now: () => now,
      upstream: {
        search: async (query) => {
          calls.push(`search:${query}`);
          return { query, result: calls.length };
        },
        artist: async (slug) => {
          calls.push(`artist:${slug}`);
          return { slug, result: calls.length };
        },
      },
      musicSearch: async (userId, query) => {
        calls.push(`music:${userId}:${query}`);
        return { releases: [{ id: calls.length }], tracks: [] };
      },
    });

    expect(await proxy.search("user-1", "bocchi")).toEqual({
      query: "bocchi",
      result: 1,
      music: { releases: [{ id: 2 }], tracks: [] },
    });
    expect(await proxy.search("user-2", "bocchi")).toEqual({
      query: "bocchi",
      result: 1,
      music: { releases: [{ id: 3 }], tracks: [] },
    });
    expect(await proxy.artist("kessoku-band")).toEqual({ slug: "kessoku-band", result: 4 });
    expect(await proxy.artist("kessoku-band")).toEqual({ slug: "kessoku-band", result: 4 });
    now += 501;
    expect(await proxy.search("user-1", "bocchi")).toEqual({
      query: "bocchi",
      result: 5,
      music: { releases: [{ id: 6 }], tracks: [] },
    });

    expect(calls).toEqual([
      "search:bocchi",
      "music:user-1:bocchi",
      "music:user-2:bocchi",
      "artist:kessoku-band",
      "search:bocchi",
      "music:user-1:bocchi",
    ]);
  });
});
