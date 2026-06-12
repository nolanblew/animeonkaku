import { realSleep, type Sleep } from "./types.js";

export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
  sleep?: Sleep;
}

/**
 * Per-host politeness budget (doc 06): allows a small burst up to `capacity`,
 * then sustains `refillPerSecond`. `acquire()` resolves when a token is taken.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private tokens: number;
  private lastRefillAt: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.tokens = options.capacity;
    this.lastRefillAt = this.now();
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.ceil((deficit / this.refillPerSecond) * 1000);
      await this.sleep(waitMs);
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
