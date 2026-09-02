import { createHash } from "node:crypto";
import sharp from "sharp";
import type { AnimeMusicDto, LibraryAnimeDto, LibraryThemeDto, PlaylistDto } from "../api/clientRoutes.js";
import type { FetchLike } from "../http/types.js";

const ARTWORK_SIZE = 290;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_ARTWORK = 256;

export interface PlaylistArtworkCatalog {
  anime: LibraryAnimeDto[];
  themes: LibraryThemeDto[];
  music: AnimeMusicDto[];
}

interface ArtworkSource {
  animeId: string;
  url: string;
}

interface CachedArtwork {
  sources: string[];
  origin: string;
  pending?: Promise<Buffer | null> | undefined;
}

export class PlaylistArtworkCache {
  private readonly assets = new Map<string, CachedArtwork>();

  constructor(private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init)) {}

  async prepare(catalog: PlaylistArtworkCatalog, playlists: PlaylistDto[], origin: string): Promise<Map<number, string>> {
    const prepared: Array<[number, string]> = [];
    for (const playlist of playlists) {
      const sources = playlistArtworkSources(catalog, playlist, origin);
      if (sources.length === 0) continue;
      const id = createHash("sha256")
        .update(JSON.stringify({ version: 1, updatedAt: playlist.updatedAt, sources }))
        .digest("hex");
      if (!this.assets.has(id)) {
        if (this.assets.size >= MAX_CACHED_ARTWORK) this.assets.delete(this.assets.keys().next().value as string);
        this.assets.set(id, { sources, origin });
      }
      prepared.push([playlist.id, `${origin}/sonos/playlist-art/${id}.png`]);
    }
    return new Map(prepared);
  }

  get(id: string): Promise<Buffer | null> | undefined {
    const value = this.assets.get(id);
    if (value) {
      this.assets.delete(id);
      this.assets.set(id, value);
      value.pending ??= this.render(value.sources, value.origin);
    }
    return value?.pending;
  }

  private async render(sources: string[], origin: string): Promise<Buffer | null> {
    try {
      const images = (await Promise.all(sources.map((url) => this.fetchImage(url, origin))))
        .filter((image): image is Buffer => image !== null);
      return images.length === 0 ? null : await renderPlaylistArtwork(images);
    } catch {
      return null;
    }
  }

  private async fetchImage(url: string, origin: string): Promise<Buffer | null> {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== origin || parsed.username || parsed.password) return null;
      const response = await this.fetchImpl(parsed.toString(), { signal: AbortSignal.timeout(5_000) });
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!response.ok || !contentType || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(contentType)) return null;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) return null;
      return await readLimited(response, MAX_SOURCE_BYTES);
    } catch {
      return null;
    }
  }
}

export function playlistArtworkSources(catalog: PlaylistArtworkCatalog, playlist: PlaylistDto, origin: string): string[] {
  const sources: ArtworkSource[] = [];
  for (const item of playlist.items) {
    const source = item.itemType === "THEME"
      ? themeArtwork(catalog, item.itemId, origin)
      : songArtwork(catalog, item.itemId, origin);
    if (source && !sources.some((existing) => existing.animeId === source.animeId || existing.url === source.url)) {
      sources.push(source);
    }
    if (sources.length === 4) break;
  }
  return sources.map((source) => source.url);
}

export async function renderPlaylistArtwork(images: Buffer[]): Promise<Buffer> {
  const selected = images.slice(0, 4);
  if (selected.length === 0) throw new Error("At least one playlist artwork image is required.");
  const tiles = tileLayout(selected.length);
  const composite = await Promise.all(selected.map((image, index) => {
    const tile = tiles[index]!;
    return sharp(image, { limitInputPixels: 25_000_000, failOn: "warning" })
      .resize(tile.width, tile.height, { fit: "cover", position: "centre" }).png().toBuffer()
      .then((input) => ({ input, left: tile.left, top: tile.top }));
  }));
  return sharp({ create: { width: ARTWORK_SIZE, height: ARTWORK_SIZE, channels: 3, background: "#17171c" } })
    .composite(composite)
    .png()
    .toBuffer();
}

function themeArtwork(catalog: PlaylistArtworkCatalog, themeId: number, origin: string): ArtworkSource | null {
  const theme = catalog.themes.find((candidate) => candidate.id === themeId);
  const anime = theme?.kitsuAnimeIds.map((id) => catalog.anime.find((candidate) => candidate.kitsuId === id && !candidate.deleted))
    .find((candidate): candidate is LibraryAnimeDto => Boolean(candidate));
  const url = anime && firstSameOriginUrl(origin, anime.posterUrl, anime.coverUrl);
  return anime && url ? { animeId: anime.kitsuId, url } : null;
}

function songArtwork(catalog: PlaylistArtworkCatalog, songId: number, origin: string): ArtworkSource | null {
  for (const music of catalog.music) {
    for (const release of music.releases) {
      if (!release.tracks.some((track) => track.id === songId)) continue;
      const libraryAnime = catalog.anime.find((anime) => anime.kitsuId === music.anime.kitsuId && !anime.deleted);
      const url = firstSameOriginUrl(origin, libraryAnime?.posterUrl, libraryAnime?.coverUrl, music.anime.posterUrl, release.artworkUrl);
      return url ? { animeId: music.anime.kitsuId, url } : null;
    }
  }
  return null;
}

function sameOriginUrl(origin: string, value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, `${origin}/`);
    return url.origin === origin && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function firstSameOriginUrl(origin: string, ...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const url = sameOriginUrl(origin, value);
    if (url) return url;
  }
  return null;
}

function tileLayout(count: number): Array<{ left: number; top: number; width: number; height: number }> {
  const half = ARTWORK_SIZE / 2;
  if (count === 1) return [{ left: 0, top: 0, width: ARTWORK_SIZE, height: ARTWORK_SIZE }];
  if (count === 2) return [
    { left: 0, top: 0, width: half, height: ARTWORK_SIZE },
    { left: half, top: 0, width: half, height: ARTWORK_SIZE },
  ];
  if (count === 3) return [
    { left: 0, top: 0, width: half, height: ARTWORK_SIZE },
    { left: half, top: 0, width: half, height: half },
    { left: half, top: half, width: half, height: half },
  ];
  return [
    { left: 0, top: 0, width: half, height: half },
    { left: half, top: 0, width: half, height: half },
    { left: 0, top: half, width: half, height: half },
    { left: half, top: half, width: half, height: half },
  ];
}

async function readLimited(response: Response, limit: number): Promise<Buffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)), total);
}
