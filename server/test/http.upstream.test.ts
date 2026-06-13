import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/http/circuitBreaker.js";
import { CircuitOpenError, UpstreamHttp } from "../src/http/upstream.js";
import { TokenBucket } from "../src/http/tokenBucket.js";
import { FakeTime } from "./helpers/fakeTime.js";
import { fakeFetch } from "./helpers/fakeFetch.js";

describe("UpstreamHttp", () => {
  it("rejects immediately with CircuitOpenError when the breaker is open", async () => {
    const time = new FakeTime();
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: time.now });
    breaker.recordFailure();
    const { fetch, requests } = fakeFetch([{ status: 200 }]);
    const http = new UpstreamHttp({ fetch, breaker, sleep: time.sleep, name: "kitsu" });
    await expect(http.request("https://kitsu.io/x")).rejects.toBeInstanceOf(CircuitOpenError);
    expect(requests).toHaveLength(0);
  });

  it("opens the breaker after consecutive 5xx outcomes", async () => {
    const time = new FakeTime();
    const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 60_000, now: time.now });
    const { fetch } = fakeFetch([{ status: 500 }]);
    const http = new UpstreamHttp({ fetch, breaker, sleep: time.sleep, maxRetries: 0 });
    await http.request("https://x.test/a");
    await http.request("https://x.test/a");
    await expect(http.request("https://x.test/a")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("does not count 429 as a breaker failure", async () => {
    const time = new FakeTime();
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: time.now });
    const { fetch } = fakeFetch([{ status: 429, headers: { "retry-after": "1" } }]);
    const http = new UpstreamHttp({ fetch, breaker, sleep: time.sleep, maxRetries: 0 });
    const res = await http.request("https://x.test/a");
    expect(res.status).toBe(429);
    expect(breaker.canRequest()).toBe(true);
  });

  it("acquires a rate-limit token for every physical attempt", async () => {
    const time = new FakeTime();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, now: time.now, sleep: time.sleep });
    const { fetch, requests } = fakeFetch([{ status: 503 }, { status: 200 }]);
    const http = new UpstreamHttp({ fetch, bucket, sleep: time.sleep });
    const res = await http.request("https://x.test/a");
    expect(res.status).toBe(200);
    expect(requests).toHaveLength(2);
    // second attempt needed a refilled token → at least ~1s of waiting beyond backoff
    const totalSlept = time.sleeps.reduce((a, b) => a + b, 0);
    expect(totalSlept).toBeGreaterThanOrEqual(999);
  });

  it("records success and closes a half-open breaker", async () => {
    const time = new FakeTime();
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: time.now });
    breaker.recordFailure();
    time.advance(1001);
    const { fetch } = fakeFetch([{ status: 200 }]);
    const http = new UpstreamHttp({ fetch, breaker, sleep: time.sleep });
    const res = await http.request("https://x.test/a");
    expect(res.status).toBe(200);
    expect(breaker.canRequest()).toBe(true);
  });
});
