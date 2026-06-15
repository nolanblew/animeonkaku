import { describe, expect, it } from "vitest";
import { resolveOpTs, shouldApplyWrite } from "../src/sync/lww.js";

describe("shouldApplyWrite (last-write-wins)", () => {
  it("applies when nothing is stored yet", () => {
    expect(shouldApplyWrite(1000, null)).toBe(true);
    expect(shouldApplyWrite(1000, undefined)).toBe(true);
  });

  it("applies a strictly newer write", () => {
    expect(shouldApplyWrite(2000, 1000)).toBe(true);
  });

  it("rejects a stalled older write that arrives late", () => {
    // Newer write already landed at 2000; an older op made at 1000 shows up afterwards.
    expect(shouldApplyWrite(1000, 2000)).toBe(false);
  });

  it("is idempotent for an identical retried op (tie favours incoming)", () => {
    expect(shouldApplyWrite(1500, 1500)).toBe(true);
  });
});

describe("resolveOpTs", () => {
  it("uses the client op timestamp when provided", () => {
    expect(resolveOpTs(1234, 9999)).toBe(1234);
  });

  it("falls back to server now when missing or invalid", () => {
    expect(resolveOpTs(null, 9999)).toBe(9999);
    expect(resolveOpTs(undefined, 9999)).toBe(9999);
    expect(resolveOpTs(0, 9999)).toBe(9999);
    expect(resolveOpTs(Number.NaN, 9999)).toBe(9999);
    expect(resolveOpTs(-5, 9999)).toBe(9999);
  });
});
