import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveQueueMode,
  type QueueModePolicyInput,
  type QueueModePolicyResult,
} from "../../shared/queueModePolicy.js";

interface Fixture {
  name: string;
  input: QueueModePolicyInput;
  expected: QueueModePolicyResult;
}

const fixtures = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../shared/queue-mode-policy.fixtures.json", import.meta.url)),
  "utf8",
)) as Fixture[];

describe("shared queue mode policy fixtures", () => {
  it.each(fixtures)("$name", ({ input, expected }) => {
    expect(resolveQueueMode(input)).toEqual(expected);
  });
});
