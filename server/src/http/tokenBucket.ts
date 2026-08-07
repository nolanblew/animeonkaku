import { realSleep, type Sleep } from "./types.js";

export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
  sleep?: Sleep;
}

/**
 * Which caller class is asking for upstream capacity. Interactive work (a
 * client actively waiting on a response) always gets tokens before background
 * work (job-queue hydration), so cache warming can never starve on-demand
 * requests of the shared per-host budget.
 */
export type UpstreamLane = "interactive" | "background";

/**
 * Per-host politeness budget (doc 06): allows a small burst up to `capacity`,
 * then sustains `refillPerSecond`. `acquire()` resolves when a token is taken.
 * Background acquisitions additionally yield while any interactive caller is
 * waiting for a token.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private tokens: number;
  private lastRefillAt: number;
  private interactiveWaiters = 0;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.tokens = options.capacity;
    this.lastRefillAt = this.now();
  }

  async acquire(lane: UpstreamLane = "interactive"): Promise<void> {
    if (lane === "interactive") this.interactiveWaiters += 1;
    try {
      for (;;) {
        this.refill();
        // An interactive waiter that is not us means we (background) must hold
        // back even when a token is available — the waiter takes it first.
        const mustYield = lane === "background" && this.interactiveWaiters > 0;
        if (!mustYield && this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        const deficit = Math.max(1 - this.tokens, 0);
        const waitMs = Math.max(Math.ceil((deficit / this.refillPerSecond) * 1000), 25);
        await this.sleep(waitMs);
      }
    } finally {
      if (lane === "interactive") this.interactiveWaiters -= 1;
    }
  }

  private refill(): void {
    const nowMs = this.now();
    const elapsedMs = nowMs - this.lastRefillAt;
    if (elapsedMs <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1000) * this.refillPerSecond);
    this.lastRefillAt = nowMs;
  }
}

/** 1-concurrent gate for binary hosts (a./i.animethemes.moe) — used by S3 media fetches. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(capacity: number) {
    this.available = capacity;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }
}
