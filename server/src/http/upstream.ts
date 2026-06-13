import type { CircuitBreaker } from "./circuitBreaker.js";
import { fetchWithRetry, type RetryOptions } from "./retry.js";
import type { TokenBucket } from "./tokenBucket.js";
import { realSleep, type FetchLike, type Sleep } from "./types.js";

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Upstream "${name}" is temporarily unavailable (circuit open).`);
    this.name = "CircuitOpenError";
  }
}

export interface UpstreamHttpOptions {
  fetch?: FetchLike;
  bucket?: TokenBucket;
  breaker?: CircuitBreaker;
  sleep?: Sleep;
  name?: string;
  maxRetries?: number;
  /**
   * Non-5xx response statuses that should additionally count as breaker
   * failures. Used for hosts that hard-block with a non-retryable status —
   * e.g. AnimeThemes behind Cloudflare returns 403, which would otherwise be
   * recorded as a success and let the queue hammer a blocked origin forever.
   */
  breakerStatuses?: number[];
}

/**
 * Composes the politeness stack for one upstream host (doc 06):
 * circuit breaker (checked once per logical request) → token bucket
 * (one token per physical attempt) → retry with Retry-After support.
 * 5xx and network errors feed the breaker; 4xx (incl. 429) do not, unless a
 * status is listed in `breakerStatuses` (e.g. a Cloudflare 403 block).
 */
export class UpstreamHttp {
  private readonly fetchImpl: FetchLike;
  private readonly bucket: TokenBucket | undefined;
  private readonly breaker: CircuitBreaker | undefined;
  private readonly sleep: Sleep;
  private readonly name: string;
  private readonly retryOptions: RetryOptions;
  private readonly breakerStatuses: Set<number>;

  constructor(options: UpstreamHttpOptions = {}) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.bucket = options.bucket;
    this.breaker = options.breaker;
    this.sleep = options.sleep ?? realSleep;
    this.name = options.name ?? "upstream";
    this.breakerStatuses = new Set(options.breakerStatuses ?? []);
    this.retryOptions = {
      sleep: this.sleep,
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    };
  }

  async request(url: string, init?: RequestInit): Promise<Response> {
    if (this.breaker && !this.breaker.canRequest()) {
      throw new CircuitOpenError(this.name);
    }

    const limitedFetch: FetchLike = async (u, i) => {
      await this.bucket?.acquire();
      return this.fetchImpl(u, i);
    };

    try {
      const response = await fetchWithRetry(limitedFetch, url, init, this.retryOptions);
      if (response.status >= 500 || this.breakerStatuses.has(response.status)) {
        this.breaker?.recordFailure();
      } else {
        this.breaker?.recordSuccess();
      }
      return response;
    } catch (error) {
      this.breaker?.recordFailure();
      throw error;
    }
  }
}
