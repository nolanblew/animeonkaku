import { describe, expect, it } from "vitest";
import { parseKitsuTokenResponse } from "../src/kitsu/authParsing.js";
import { KitsuAuthError } from "../src/auth/types.js";

describe("parseKitsuTokenResponse", () => {
  it("parses the standard JSON success body", () => {
    const body = JSON.stringify({
      access_token: "abc",
      refresh_token: "def",
      token_type: "bearer",
      expires_in: 2_592_000,
      created_at: 1_700_000_000,
      scope: "public",
    });
    const tokens = parseKitsuTokenResponse(body, 200);
    expect(tokens.accessToken).toBe("abc");
    expect(tokens.refreshToken).toBe("def");
    expect(tokens.expiresAt?.getTime()).toBe((1_700_000_000 + 2_592_000) * 1000);
  });

  it("parses a form-encoded fallback body", () => {
    const body = "access_token=abc&refresh_token=def&expires_in=3600&created_at=1700000000";
    const tokens = parseKitsuTokenResponse(body, 200);
    expect(tokens.accessToken).toBe("abc");
    expect(tokens.refreshToken).toBe("def");
  });

  it("throws the error_description from OAuth error JSON", () => {
    const body = JSON.stringify({
      error: "invalid_grant",
      error_description: "The provided authorization grant is invalid",
    });
    expect(() => parseKitsuTokenResponse(body, 400)).toThrow(KitsuAuthError);
    expect(() => parseKitsuTokenResponse(body, 400)).toThrow(/authorization grant is invalid/);
  });

  it("throws on a 200 body that carries a JSON:API errors array", () => {
    const body = JSON.stringify({ errors: [{ title: "Bad request", detail: "nope" }] });
    expect(() => parseKitsuTokenResponse(body, 200)).toThrow(/nope/);
  });

  it("throws a readable error on HTML responses", () => {
    expect(() => parseKitsuTokenResponse("<html><body>503</body></html>", 200)).toThrow(
      /unexpected HTML/i,
    );
  });

  it("throws on empty bodies", () => {
    expect(() => parseKitsuTokenResponse("", 200)).toThrow(/empty/i);
  });

  it("defaults created_at/expires_in when missing", () => {
    const before = Date.now();
    const tokens = parseKitsuTokenResponse("access_token=abc", 200);
    expect(tokens.accessToken).toBe("abc");
    // default 3600s lifetime from ~now
    expect(tokens.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 3_500_000);
    expect(tokens.expiresAt!.getTime()).toBeLessThanOrEqual(before + 3_700_000 + 60_000);
  });
});
