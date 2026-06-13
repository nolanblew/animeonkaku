import { KitsuAuthError } from "../auth/types.js";
import type { KitsuTokens } from "./types.js";

/**
 * Tolerant parsing of Kitsu's /oauth/token responses, ported from the proven
 * Android implementation (`KitsuAuthRepositoryImpl.parseToken/parseFallback`):
 * Kitsu has been observed returning JSON, form-encoded bodies, JSON:API error
 * arrays, and HTML maintenance pages.
 */
export function parseKitsuTokenResponse(bodyText: string, status: number): KitsuTokens {
  const trimmed = bodyText.trim();

  if (status < 200 || status >= 300) {
    const map = tryParseJsonObject(trimmed) ?? {};
    const message =
      asString(map["error_description"]) ??
      asString(map["error"]) ??
      `Kitsu auth failed (HTTP ${status}).`;
    throw new KitsuAuthError(message);
  }

  if (!trimmed) {
    throw new KitsuAuthError("Kitsu auth failed: empty response.");
  }
  if (trimmed.startsWith("<")) {
    throw new KitsuAuthError("Kitsu auth failed: unexpected HTML response.");
  }

  const map = trimmed.startsWith("{")
    ? (tryParseJsonObject(trimmed) ?? {})
    : parseFormEncoded(trimmed);

  const jsonApiError = extractJsonApiError(map);
  if (jsonApiError) {
    throw new KitsuAuthError(jsonApiError);
  }

  const accessToken = asString(map["access_token"]) ?? asString(map["accessToken"]);
  if (!accessToken) {
    const message =
      asString(map["error_description"]) ??
      asString(map["error"]) ??
      "Kitsu auth failed: invalid response.";
    throw new KitsuAuthError(message);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const createdAt = asNumber(map["created_at"]) ?? asNumber(map["createdAt"]) ?? nowSec;
  const expiresIn = asNumber(map["expires_in"]) ?? asNumber(map["expiresIn"]) ?? 3600;

  return {
    accessToken,
    refreshToken: asString(map["refresh_token"]) ?? asString(map["refreshToken"]) ?? null,
    expiresAt: new Date((createdAt + expiresIn) * 1000),
  };
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseFormEncoded(body: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const pair of body.split("&")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const key = decodeURIComponent(pair.slice(0, index).replace(/\+/g, " "));
    const value = decodeURIComponent(pair.slice(index + 1).replace(/\+/g, " "));
    result[key] = value;
  }
  return result;
}

function extractJsonApiError(map: Record<string, unknown>): string | null {
  const errors = map["errors"];
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const first = errors[0];
  if (!first || typeof first !== "object") return null;
  const record = first as Record<string, unknown>;
  return asString(record["detail"]) ?? asString(record["title"]);
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
