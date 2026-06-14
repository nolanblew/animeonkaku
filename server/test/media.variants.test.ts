import { describe, expect, it } from "vitest";
import { deriveThemeMediaSources } from "../src/media/catalogLookup.js";
import { themeMediaFilePath } from "../src/media/mediaLayout.js";

describe("deriveThemeMediaSources", () => {
  it("always exposes the canonical short audio", () => {
    const sources = deriveThemeMediaSources({
      themeId: 7,
      audioOriginUrl: "https://a.animethemes.moe/Show-OP1.ogg",
      videoOriginUrl: null,
    });
    expect(sources).toEqual([
      {
        themeId: 7,
        kind: "AUDIO",
        variant: "SHORT",
        originUrl: "https://a.animethemes.moe/Show-OP1.ogg",
        videoFallback: false,
      },
    ]);
  });

  it("adds a FULL video variant when a distinct video origin exists", () => {
    const sources = deriveThemeMediaSources({
      themeId: 7,
      audioOriginUrl: "https://a.animethemes.moe/Show-OP1.ogg",
      videoOriginUrl: "https://v.animethemes.moe/Show-OP1.webm",
    });
    expect(sources).toHaveLength(2);
    expect(sources[1]).toEqual({
      themeId: 7,
      kind: "VIDEO",
      variant: "FULL",
      originUrl: "https://v.animethemes.moe/Show-OP1.webm",
      videoFallback: false,
    });
  });

  it("treats audio==video as a video fallback and exposes no separate video variant", () => {
    const sources = deriveThemeMediaSources({
      themeId: 7,
      audioOriginUrl: "https://v.animethemes.moe/Show-OP1.webm",
      videoOriginUrl: "https://v.animethemes.moe/Show-OP1.webm",
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "AUDIO", variant: "SHORT", videoFallback: true });
  });
});

describe("themeMediaFilePath", () => {
  it("keeps the canonical short audio path frozen", () => {
    expect(themeMediaFilePath("AUDIO", "SHORT", "3040")).toBe("audio/3040.ogg");
  });

  it("gives future variants distinct, non-colliding paths", () => {
    const paths = new Set([
      themeMediaFilePath("AUDIO", "SHORT", "3040"),
      themeMediaFilePath("AUDIO", "FULL", "3040"),
      themeMediaFilePath("VIDEO", "FULL", "3040"),
      themeMediaFilePath("VIDEO", "SHORT", "3040"),
    ]);
    expect(paths.size).toBe(4);
    expect(themeMediaFilePath("AUDIO", "FULL", "3040")).toBe("audio/3040.full.ogg");
    expect(themeMediaFilePath("VIDEO", "FULL", "3040")).toBe("video/3040.webm");
  });
});
