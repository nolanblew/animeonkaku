import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "../src/http/retry.js";
import { FakeTime } from "./helpers/fakeTime.js";
import { fakeFetch } from "./helpers/fakeFetch.js";

describe("fetchWithRetry", () => {
  it("retries GET on 503 and returns the eventual success", async () => {
    const time = new FakeTime();
    const { fetch, requests } = fakeFetch([{ status: 503 }, { status: 200, body: "ok" }]);
    const res = await fetchWithRetry(fetch, "https://x.test/a", undefined, { sleep: time.sleep });
    expect(res.status).toBe(200);
    expect(requests).toHaveLength(2);
  });

  it("does not retry POST requests", async () => {
    const time = new FakeTime();
    const { fetch, requests } = fakeFetch([{ status: 503 }, { status: 200 }]);
    const res = await fetchWithRetry(fetch, "https://x.test/a", { method: "POST" }, { sleep: time.sleep });
    expect(res.status).toBe(503);
    expect(requests).toHaveLength(1);
  });

  it("does not retry non-retryable statuses like 404", async () => {
    const time = new FakeTime();
    const { fetch, requests } = fakeFetch([{ status: 404 }, { status: 200 }]);
    const res = await fetchWithRetry(fetch, "https://x.test/a", undefined, { sleep: time.sleep });
    expect(res.status).toBe(404);
    expect(requests).toHaveLength(1);
  });

  it("honors Retry-After seconds on 429", async () => {
    const time = new FakeTime();
    const { fetch } = fakeFetch([
      { status: 429, headers: { "retry-after": "7" } },
      { status: 200 },
    ]);
    const res = await fetchWithRetry(fetch, "https://x.test/a", undefined, { sleep: time.sleep });
    expect(res.status).toBe(200);
    expect(time.sleeps[0]).toBe(7000);
  });

  it("caps Retry-After at the configured maximum", async () => {
    const time = new FakeTime();
    const { fetch } = fakeFetch([
      { status: 429, headers: { "retry-after": "3600" } },
      { status: 200 },
    ]);
    await fetchWithRetry(fetch, "https://x.test/a", undefined, {
      sleep: time.sleep,
      retryAfterCapMs: 60_000,
    });
    expect(time.sleeps[0]).toBe(60_000);
  });

  it("retries network errors on GET and eventually rethrows", async () => {
    const time = new FakeTime();
    const boom = new Error("socket reset");
    const { fetch, requests } = fakeFetch([boom, boom, boom, boom]);
    await expect(
      fetchWithRetry(fetch, "https://x.test/a", undefined, { sleep: time.sleep, maxRetries: 2 }),
    ).rejects.toThrow("socket reset");
    expect(requests).toHaveLength(3); // initial + 2 retries
  });

  it("returns the last failure response when retries are exhausted", async () => {
    const time = new FakeTime();
    const { fetch, requests } = fakeFetch([{ status: 502 }]);
    const res = await fetchWithRetry(fetch, "https://x.test/a", undefined, {
      sleep: time.sleep,
      maxRetries: 2,
    });
    expect(res.status).toBe(502);
    expect(requests).toHaveLength(3);
  });

  it("uses growing backoff between attempts", async () => {
    const time = new FakeTime();
    const { fetch } = fakeFetch([{ status: 503 }, { status: 503 }, { status: 200 }]);
    await fetchWithRetry(fetch, "https://x.test/a", undefined, {
      sleep: time.sleep,
      baseDelayMs: 300,
    });
    expect(time.sleeps).toHaveLength(2);
    expect(time.sleeps[0]!).toBeGreaterThanOrEqual(300);
    expect(time.sleeps[1]!).toBeGreaterThan(time.sleeps[0]!);
  });
});
