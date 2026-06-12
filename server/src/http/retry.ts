import { realSleep, type FetchLike, type Sleep } from "./types.js";

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryAfterCapMs?: number;
  sleep?: Sleep;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/**
 * Retry wrapper for upstream calls (doc 06): idempotent (GET/HEAD) requests
 * only, on 408/429/5xx and network errors, with exponential backoff + jitter,
 * honoring `Retry-After` (capped). Non-idempotent or non-retryable outcomes
 * pass through; exhausted retries return the last response (callers check
 * `res.ok`) or rethrow the last network error.
 */
export async function fetchWithRetry(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const retryAfterCapMs = options.retryAfterCapMs ?? 60_000;
  const sleep = options.sleep ?? realSleep;

  const method = (init?.method ?? "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD";

  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetchImpl(url, init);
      lastError = undefined;
    } catch (error) {
      lastError = error;
      if (!isIdempotent || attempt >= maxRetries) throw error;
    }

    if (response) {
      const retryable = isIdempotent && RETRYABLE_STATUSES.has(response.status);
      if (!retryable || attempt >= maxRetries) return response;
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      if (retryAfterMs !== null) {
        await sleep(Math.min(retryAfterMs, retryAfterCapMs));
        continue;
      }
    }

    const exponential = baseDelayMs * 2 ** attempt;
    const jitter = Math.floor(Math.random() * baseDelayMs);
    await sleep(Math.min(maxDelayMs, exponential + jitter));
  }
}
