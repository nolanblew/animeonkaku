import type { AppLogger } from "../logging.js";
import { CircuitBreaker } from "../http/circuitBreaker.js";
import { TokenBucket } from "../http/tokenBucket.js";
import type { FetchLike } from "../http/types.js";
import { UpstreamHttp } from "../http/upstream.js";

export interface LidarrUpstreamHttpOptions {
  apiKey: string;
  fetch?: FetchLike;
  logger?: AppLogger;
  maxRetries?: number;
  bucket?: TokenBucket;
  breaker?: CircuitBreaker;
}

/**
 * Gives Lidarr its own upstream budget/breaker while retaining the same retry
 * and log-redaction pipeline as the other upstreams. The API key is injected
 * only as X-Api-Key, never into a URL.
 */
export function createLidarrUpstreamHttp(options: LidarrUpstreamHttpOptions): UpstreamHttp {
  const bucket = options.bucket ?? new TokenBucket({ capacity: 2, refillPerSecond: 2 });
  const breaker = options.breaker ?? new CircuitBreaker();
  const baseFetch = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const fetchWithApiKey: FetchLike = async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("X-Api-Key", options.apiKey);
    return baseFetch(url, { ...init, headers });
  };

  return new UpstreamHttp({
    fetch: fetchWithApiKey,
    bucket,
    breaker,
    name: "lidarr",
    lane: "background",
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
}
