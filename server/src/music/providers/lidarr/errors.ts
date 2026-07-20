import { z } from "zod";

export type LidarrProviderErrorCode =
  | "AUTHENTICATION_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_FAILURE"
  | "NETWORK_FAILURE"
  | "MALFORMED_RESPONSE"
  | "INVALID_RESOURCE"
  | "PATH_NOT_MAPPED";

export class LidarrProviderError extends Error {
  constructor(
    public readonly code: LidarrProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LidarrProviderError";
  }
}

export function malformedResponse(endpoint: string, error: z.ZodError): LidarrProviderError {
  const fields = error.issues
    .slice(0, 3)
    .map((issue) => issue.path.join(".") || "response")
    .join(", ");
  return new LidarrProviderError(
    "MALFORMED_RESPONSE",
    `Lidarr returned a malformed response for ${endpoint}: ${fields}`,
    false,
  );
}

export function responseError(status: number): LidarrProviderError {
  if (status === 401 || status === 403) {
    return new LidarrProviderError(
      "AUTHENTICATION_FAILED",
      "Lidarr authentication failed",
      false,
      status,
    );
  }
  if (status === 404) {
    return new LidarrProviderError("NOT_FOUND", "Lidarr resource was not found", false, status);
  }
  if (status === 429) {
    return new LidarrProviderError("RATE_LIMITED", "Lidarr rate limit exceeded", true, status);
  }
  return new LidarrProviderError(
    "UPSTREAM_FAILURE",
    `Lidarr request failed with HTTP ${status}`,
    status >= 500,
    status,
  );
}

export function networkError(error: unknown): LidarrProviderError {
  if (error instanceof LidarrProviderError) return error;
  return new LidarrProviderError(
    "NETWORK_FAILURE",
    `Lidarr request failed: ${error instanceof Error ? error.message : "network error"}`,
    true,
  );
}
