import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/http/tokenBucket.js";
import { FakeTime } from "./helpers/fakeTime.js";

describe("TokenBucket", () => {
  it("allows immediate acquisition up to capacity", async () => {
    const time = new FakeTime();
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1, now: time.now, sleep: time.sleep });
    await bucket.acquire();
    await bucket.acquire();
    expect(time.sleeps).toHaveLength(0);
  });

  it("waits for refill when the bucket is empty", async () => {
    const time = new FakeTime();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, now: time.now, sleep: time.sleep });
    await bucket.acquire();
    await bucket.acquire(); // must wait ~1s for one token
    expect(time.sleeps.length).toBeGreaterThan(0);
    expect(time.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(999);
  });

  it("refills while idle, capped at capacity", async () => {
    const time = new FakeTime();
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1, now: time.now, sleep: time.sleep });
    await bucket.acquire();
    await bucket.acquire();
    time.advance(10_000); // long idle — refills to capacity (2), not 10
    await bucket.acquire();
    await bucket.acquire();
    expect(time.sleeps).toHaveLength(0);
    await bucket.acquire(); // third needs a refill wait
    expect(time.sleeps.length).toBeGreaterThan(0);
  });

  it("paces a 60/min budget to ~1 per second sustained", async () => {
    const time = new FakeTime();
    const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: time.now, sleep: time.sleep });
    const start = time.now();
    for (let i = 0; i < 65; i++) await bucket.acquire();
    // 5 burst + 60 refilled over ≥60s of virtual time
    expect(time.now() - start).toBeGreaterThanOrEqual(59_000);
  });

  it("gives refilled tokens to interactive callers before earlier background callers", async () => {
    const time = new FakeTime();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, now: time.now, sleep: time.sleep });
    await bucket.acquire(); // drain the burst token

    const order: string[] = [];
    const background = bucket.acquire("background").then(() => order.push("background"));
    const interactive = bucket.acquire("interactive").then(() => order.push("interactive"));
    await Promise.all([background, interactive]);

    expect(order).toEqual(["interactive", "background"]);
  });

  it("background acquisition yields an available token to a waiting interactive caller", async () => {
    // Manually-released sleeps so both callers can be parked at the same time.
    const pending: Array<() => void> = [];
    const sleep = (_ms: number) => new Promise<void>((resolve) => pending.push(resolve));
    let nowMs = 0;
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, now: () => nowMs, sleep });
    await bucket.acquire(); // drain the burst token

    const order: string[] = [];
    const interactive = bucket.acquire("interactive").then(() => order.push("interactive"));
    const background = bucket.acquire("background").then(() => order.push("background"));

    nowMs += 1000; // one token refilled while both wait
    pending[1]!(); // wake background first — it must yield, not take the token
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);

    pending[0]!(); // interactive wakes and takes the token
    await interactive;
    expect(order).toEqual(["interactive"]);

    nowMs += 1000;
    pending[2]!(); // background wakes again with no interactive waiters left
    await background;
    expect(order).toEqual(["interactive", "background"]);
  });
});
