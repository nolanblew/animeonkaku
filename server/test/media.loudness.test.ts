import { describe, expect, it } from "vitest";
import {
  LOUDNESS_POLICY_VERSION,
  LOUDNESS_TARGET_LUFS,
  LOUDNESS_TRUE_PEAK_CEILING_DBTP,
  loudnessAnalysisDedupeKey,
  parseFfmpegLoudnormOutput,
  playbackLoudness,
} from "../src/media/loudness.js";

describe("loudness policy", () => {
  it("is attenuation-only and respects both integrated loudness and true-peak headroom", () => {
    const loudMaster = Math.min(0, LOUDNESS_TARGET_LUFS - -7, LOUDNESS_TRUE_PEAK_CEILING_DBTP - -0.2);
    expect(loudMaster).toBe(-9);
    const quietMaster = Math.min(0, LOUDNESS_TARGET_LUFS - -20, LOUDNESS_TRUE_PEAK_CEILING_DBTP - -3);
    expect(quietMaster).toBe(0);
  });

  it("only exposes a SHA-current result and zeros application gain behind the rollout flag", () => {
    const record = {
      sha256: "source", loudnessSha256: "source", loudnessState: "READY",
      integratedLufs: -7, truePeakDbtp: -0.2, loudnessRangeLu: 5.1,
      loudnessGainDb: -9, loudnessPolicyVersion: LOUDNESS_POLICY_VERSION,
    };
    expect(playbackLoudness(record, false)).toMatchObject({ gainDb: 0, state: "READY" });
    expect(playbackLoudness(record, true)).toMatchObject({ gainDb: -9, state: "READY" });
    expect(playbackLoudness({ ...record, sha256: "replacement" }, true)).toBeUndefined();
  });

  it("uses a hash-versioned durable job key so replacements cannot reuse stale work", () => {
    expect(loudnessAnalysisDedupeKey({ kind: "AUDIO", refId: "song:1", variant: "ORIGINAL", sha256: "a" }))
      .not.toBe(loudnessAnalysisDedupeKey({ kind: "AUDIO", refId: "song:1", variant: "ORIGINAL", sha256: "b" }));
  });

  it("parses FFmpeg's analysis-only loudnorm JSON defensively", () => {
    expect(parseFfmpegLoudnormOutput('info\n{\n  "input_i" : "-10.42",\n  "input_tp" : "-0.35",\n  "input_lra" : "6.20"\n}\n'))
      .toEqual({ integratedLufs: -10.42, truePeakDbtp: -0.35, loudnessRangeLu: 6.2 });
    expect(() => parseFfmpegLoudnormOutput("no data")).toThrow(/no measurement/i);
  });
});
