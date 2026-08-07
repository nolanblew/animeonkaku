export type AnimeMusicFetcherErrorCode =
  | "NETWORK_FAILURE"
  | "BAD_REQUEST"
  | "AUTHENTICATION_FAILED"
  | "NOT_FOUND"
  | "UPSTREAM_TIMEOUT"
  | "IDEMPOTENCY_CONFLICT"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UPSTREAM_FAILURE"
  | "MALFORMED_RESPONSE"
  | "INVALID_REQUEST";

export class AnimeMusicFetcherError extends Error {
  constructor(
    public readonly code: AnimeMusicFetcherErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AnimeMusicFetcherError";
  }
}

export function amfResponseError(status: number, action: string): AnimeMusicFetcherError {
  if (status === 400 || status === 422) {
    return new AnimeMusicFetcherError("BAD_REQUEST", `Anime Music Fetcher rejected ${action}`, false, status);
  }
  if (status === 401 || status === 403) {
    return new AnimeMusicFetcherError("AUTHENTICATION_FAILED", `Anime Music Fetcher denied ${action}`, false, status);
  }
  if (status === 404) {
    return new AnimeMusicFetcherError("NOT_FOUND", `Anime Music Fetcher could not find ${action}`, false, status);
  }
  if (status === 408) {
    return new AnimeMusicFetcherError("UPSTREAM_TIMEOUT", `Anime Music Fetcher timed out during ${action}`, true, status);
  }
  if (status === 409 && action === "job submission") {
    return new AnimeMusicFetcherError(
      "IDEMPOTENCY_CONFLICT",
      "Anime Music Fetcher rejected a reused idempotency key",
      false,
      status,
    );
  }
  if (status === 409) {
    return new AnimeMusicFetcherError("CONFLICT", `Anime Music Fetcher rejected ${action} in its current state`, false, status);
  }
  if (status === 429) {
    return new AnimeMusicFetcherError("RATE_LIMITED", `Anime Music Fetcher rate limited ${action}`, true, status);
  }
  return new AnimeMusicFetcherError(
    "UPSTREAM_FAILURE",
    `Anime Music Fetcher failed ${action}`,
    status >= 500,
    status,
  );
}

export function amfNetworkError(action: string): AnimeMusicFetcherError {
  return new AnimeMusicFetcherError(
    "NETWORK_FAILURE",
    `Anime Music Fetcher could not be reached for ${action}`,
    true,
  );
}

export function amfMalformedResponse(action: string): AnimeMusicFetcherError {
  return new AnimeMusicFetcherError(
    "MALFORMED_RESPONSE",
    `Anime Music Fetcher returned an invalid response for ${action}`,
    false,
  );
}

export function amfInvalidRequest(action: string): AnimeMusicFetcherError {
  return new AnimeMusicFetcherError(
    "INVALID_REQUEST",
    `Anime Music Fetcher ${action} is invalid`,
    false,
  );
}
