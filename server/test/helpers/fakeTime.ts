import type { Sleep } from "../../src/http/types.js";

/**
 * Deterministic virtual clock: `sleep` advances time instantly and records
 * each requested delay, so politeness/backoff timing is asserted without
 * real waiting.
 */
export class FakeTime {
  private currentMs = 0;
  readonly sleeps: number[] = [];

  now = (): number => this.currentMs;

  sleep: Sleep = async (ms) => {
    this.sleeps.push(ms);
    this.currentMs += ms;
  };

  advance(ms: number): void {
    this.currentMs += ms;
  }
}
