import type { Sleep } from "../../src/http/types.js";

/**
 * Deterministic virtual clock: `sleep` advances time instantly and records
 * each requested delay, so politeness/backoff timing is asserted without
 * real waiting.
 */
export class FakeTime {
  private currentMs: number;
  readonly sleeps: number[] = [];

  constructor(initialMs = 0) {
    this.currentMs = initialMs;
  }

  now = (): number => this.currentMs;

  sleep: Sleep = async (ms) => {
    this.sleeps.push(ms);
    this.currentMs += ms;
  };

  advance(ms: number): void {
    this.currentMs += ms;
  }
}
