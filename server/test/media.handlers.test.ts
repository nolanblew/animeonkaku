import { describe, expect, it } from "vitest";
import { DiskSpaceLowError, createFetchMediaHandlers } from "../src/media/fetchHandlers.js";
import type { MediaStore } from "../src/media/mediaStore.js";

class FakeStore {
  calls: unknown[] = [];

  async fetchToMediaFile(input: unknown) {
    this.calls.push(input);
    return input;
  }
}

describe("fetch media handlers", () => {
  it("fetches theme audio and records videoFallback when audio points at the video URL", async () => {
    const store = new FakeStore();
    const handlers = createFetchMediaHandlers({
      mediaStore: store as unknown as MediaStore,
      catalog: {
        findThemeAudio: async () => ({
          themeId: 42,
          audioOriginUrl: "https://v.animethemes.moe/Fallback.webm",
          videoOriginUrl: "https://v.animethemes.moe/Fallback.webm",
        }),
        findImage: async () => null,
      },
      getDiskFreeBytes: async () => 3_000_000_000,
    });

    await handlers.FETCH_AUDIO({ themeId: 42 });

    expect(store.calls[0]).toMatchObject({
      kind: "AUDIO",
      refId: "42",
      originUrl: "https://v.animethemes.moe/Fallback.webm",
      filePath: "audio/42.ogg",
      videoFallback: true,
    });
  });

  it("pauses fetch jobs without writing when disk free is below 2GB", async () => {
    const store = new FakeStore();
    const handlers = createFetchMediaHandlers({
      mediaStore: store as unknown as MediaStore,
      catalog: {
        findThemeAudio: async () => ({
          themeId: 42,
          audioOriginUrl: "https://a.animethemes.moe/Ready.ogg",
          videoOriginUrl: null,
        }),
        findImage: async () => null,
      },
      getDiskFreeBytes: async () => 1_000_000_000,
    });

    await expect(handlers.FETCH_AUDIO({ themeId: 42 })).rejects.toBeInstanceOf(DiskSpaceLowError);
    expect(store.calls).toHaveLength(0);
  });
});

