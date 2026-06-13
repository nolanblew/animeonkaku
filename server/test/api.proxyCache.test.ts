import { describe, expect, it } from "vitest";
import { CachedProxyService } from "../src/api/proxyRoutes.js";

describe("CachedProxyService", () => {
  it("caches search and artist proxy responses for the TTL", async () => {
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
    });

    expect(await proxy.search("bocchi")).toEqual({ query: "bocchi", result: 1 });
    expect(await proxy.search("bocchi")).toEqual({ query: "bocchi", result: 1 });
    expect(await proxy.artist("kessoku-band")).toEqual({ slug: "kessoku-band", result: 2 });
    expect(await proxy.artist("kessoku-band")).toEqual({ slug: "kessoku-band", result: 2 });
    now += 501;
    expect(await proxy.search("bocchi")).toEqual({ query: "bocchi", result: 3 });

    expect(calls).toEqual(["search:bocchi", "artist:kessoku-band", "search:bocchi"]);
  });
});
