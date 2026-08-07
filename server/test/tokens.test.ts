import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../src/auth/tokens.js";

describe("generateToken", () => {
  it("produces base64url tokens encoding 32 bytes of entropy", () => {
    const token = generateToken();
    // 32 bytes → 43 base64url chars (no padding)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("produces unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("hashToken", () => {
  it("returns the sha256 hex digest of the token", () => {
    const token = "test-token";
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hashToken(token)).toBe(expected);
    expect(hashToken(token)).toHaveLength(64);
  });

  it("is deterministic and collision-distinct for different inputs", () => {
    expect(hashToken("a")).toBe(hashToken("a"));
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
