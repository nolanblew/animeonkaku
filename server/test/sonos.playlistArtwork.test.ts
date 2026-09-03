import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { LibraryAnimeDto, LibraryThemeDto, PlaylistDto } from "../src/api/clientRoutes.js";
import { playlistArtworkSources, renderPlaylistArtwork } from "../src/sonos/playlistArtwork.js";

const COLORS = [
  [212, 66, 91],
  [49, 171, 102],
  [58, 112, 210],
  [235, 188, 57],
] as const;

async function solid([r, g, b]: readonly [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

async function pixelsFor(count: number) {
  const images = await Promise.all(COLORS.slice(0, count).map(solid));
  const rendered = await sharp(await renderPlaylistArtwork(images)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const offset = (y * rendered.info.width + x) * rendered.info.channels;
    return [...rendered.data.subarray(offset, offset + 3)];
  };
  return { info: rendered.info, pixel };
}

describe("Sonos playlist cover collages", () => {
  it("deduplicates anime, prefers a local cover fallback, and uses at most four images", () => {
    const anime = Array.from({ length: 5 }, (_, index) => ({
      kitsuId: String(index + 1), posterUrl: index === 0 ? "https://external.example/poster.jpg" : `/covers/${index + 1}.jpg`,
      coverUrl: `/covers/${index + 1}.jpg`, deleted: false,
    })) as LibraryAnimeDto[];
    const themes = anime.map((item, index) => ({ id: index + 1, kitsuAnimeIds: [item.kitsuId] })) as LibraryThemeDto[];
    const playlist = { updatedAt: 1, items: [1, 1, 2, 3, 4, 5].map((itemId, index) => ({
      entryId: index + 1, itemType: "THEME" as const, itemId, modeOverride: null,
    })) } as PlaylistDto;
    expect(playlistArtworkSources({ anime, themes, music: [] }, playlist, "https://ongaku.takeya.ninja")).toEqual([
      "https://ongaku.takeya.ninja/covers/1.jpg",
      "https://ongaku.takeya.ninja/covers/2.jpg",
      "https://ongaku.takeya.ninja/covers/3.jpg",
      "https://ongaku.takeya.ninja/covers/4.jpg",
    ]);
  });
  it("fills the square with a single anime cover", async () => {
    const { info, pixel } = await pixelsFor(1);
    expect([info.width, info.height]).toEqual([290, 290]);
    expect(pixel(20, 20)).toEqual(COLORS[0]);
    expect(pixel(270, 270)).toEqual(COLORS[0]);
  });

  it("places two covers in equal vertical halves", async () => {
    const { pixel } = await pixelsFor(2);
    expect(pixel(70, 145)).toEqual(COLORS[0]);
    expect(pixel(220, 145)).toEqual(COLORS[1]);
  });

  it("uses a tall lead cover and two stacked covers for three images", async () => {
    const { pixel } = await pixelsFor(3);
    expect(pixel(70, 220)).toEqual(COLORS[0]);
    expect(pixel(220, 70)).toEqual(COLORS[1]);
    expect(pixel(220, 220)).toEqual(COLORS[2]);
  });

  it("places four covers in a two-by-two grid", async () => {
    const { pixel } = await pixelsFor(4);
    expect(pixel(70, 70)).toEqual(COLORS[0]);
    expect(pixel(220, 70)).toEqual(COLORS[1]);
    expect(pixel(70, 220)).toEqual(COLORS[2]);
    expect(pixel(220, 220)).toEqual(COLORS[3]);
  });
});
