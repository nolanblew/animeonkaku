import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/http/circuitBreaker.js";
import { FakeTime } from "./helpers/fakeTime.js";

const COOLDOWN = 10 * 60_000;

function breaker(time: FakeTime) {
  return new CircuitBreaker({ threshold: 5, cooldownMs: COOLDOWN, now: time.now });
}

describe("CircuitBreaker", () => {
  it("stays closed below the failure threshold and resets on success", () => {
    const time = new FakeTime();
    const cb = breaker(time);
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.canRequest()).toBe(true);
    cb.recordSuccess();
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.canRequest()).toBe(true); // counter reset by the success
  });

  it("opens after N consecutive failures and rejects during cooldown", () => {
    const time = new FakeTime();
    const cb = breaker(time);
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    time.advance(COOLDOWN - 1000);
    expect(cb.canRequest()).toBe(false);
  });

  it("allows exactly one half-open probe after cooldown", () => {
    const time = new FakeTime();
    const cb = breaker(time);
    for (let i = 0; i < 5; i++) cb.recordFailure();
    time.advance(COOLDOWN + 1);
    expect(cb.canRequest()).toBe(true); // the probe
    expect(cb.canRequest()).toBe(false); // concurrent second request blocked
  });

  it("closes on probe success", () => {
    const time = new FakeTime();
    const cb = breaker(time);
    for (let i = 0; i < 5; i++) cb.recordFailure();
    time.advance(COOLDOWN + 1);
    expect(cb.canRequest()).toBe(true);
    cb.recordSuccess();
    expect(cb.canRequest()).toBe(true);
    expect(cb.canRequest()).toBe(true);
  });

  it("re-opens with a fresh cooldown on probe failure", () => {
    const time = new FakeTime();
    const cb = breaker(time);
    for (let i = 0; i < 5; i++) cb.recordFailure();
    time.advance(COOLDOWN + 1);
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    time.advance(COOLDOWN - 1000);
    expect(cb.canRequest()).toBe(false);
    time.advance(2000);
    expect(cb.canRequest()).toBe(true);
  });
});
