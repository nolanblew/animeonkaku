import type { AppLogger } from "../../logging.js";
import { CircuitBreaker } from "../../http/circuitBreaker.js";
import { TokenBucket } from "../../http/tokenBucket.js";
import type { FetchLike } from "../../http/types.js";
import { UpstreamHttp } from "../../http/upstream.js";

export interface AnimeMusicFetcherUpstreamHttpOptions {
  fetch?: FetchLike;
  logger?: AppLogger;
  maxRetries?: number;
  bucket?: TokenBucket;
  breaker?: CircuitBreaker;
}

export function createAnimeMusicFetcherUpstreamHttp(
  options: AnimeMusicFetcherUpstreamHttpOptions = {},
): UpstreamHttp {
  const bucket = options.bucket ?? new TokenBucket({ capacity: 2, refillPerSecond: 2 });
  const breaker = options.breaker ?? new CircuitBreaker();
  const baseFetch = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const fetchWithoutSensitiveErrors: FetchLike = async (url, init) => {
    try {
      return await baseFetch(url, init);
    } catch {
      throw new Error("Anime Music Fetcher transport failure");
    }
  };
  const logger = options.logger ? redactLogger(options.logger) : undefined;

  return new UpstreamHttp({
    fetch: fetchWithoutSensitiveErrors,
    bucket,
    breaker,
    name: "anime-music-fetcher",
    lane: "background",
    ...(logger ? { logger } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
}

function redactLogger(logger: AppLogger): AppLogger {
  const sanitize = (data: Record<string, unknown>) => ({ ...data, url: "[redacted-amf-url]" });
  return {
    info: (data, message) => logger.info(sanitize(data), message),
    ...(logger.warn ? { warn: (data: Record<string, unknown>, message: string) => logger.warn!(sanitize(data), message) } : {}),
    ...(logger.error ? { error: (data: Record<string, unknown>, message: string) => logger.error!(sanitize(data), message) } : {}),
  };
}
