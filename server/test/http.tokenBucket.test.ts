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
});
