import { describe, expect, it } from "vitest";
import { InteractiveMediaActivity } from "../src/media/interactiveActivity.js";

describe("InteractiveMediaActivity", () => {
  it("reports quiet only after the configured window since the last on-demand miss", () => {
    let nowMs = 0;
    const activity = new InteractiveMediaActivity(() => nowMs, 30_000);

    expect(activity.isQuiet()).toBe(true); // no traffic yet

    activity.markMiss();
    expect(activity.isQuiet()).toBe(false);

    nowMs += 29_999;
    expect(activity.isQuiet()).toBe(false);

    nowMs += 1;
    expect(activity.isQuiet()).toBe(true);

    activity.markMiss(); // new burst of on-demand traffic re-arms the hold
    expect(activity.isQuiet()).toBe(false);
  });
});
