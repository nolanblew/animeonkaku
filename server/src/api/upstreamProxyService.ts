import type { AnimeThemesClient } from "../animethemes/client.js";
import { toThemeEntries } from "../animethemes/parse.js";
import type { AnimeThemeEntry } from "../animethemes/types.js";
import type { KitsuClient } from "../kitsu/kitsuClient.js";
import type { ProxyUpstream } from "./proxyRoutes.js";

export interface ProxyArtistImage {
  slug: string;
  name: string;
  imageUrl: string | null;
}

export interface ProxyCatalogWriter {
  saveOnlineAnimeCatalog?(themes: AnimeThemeEntry[]): Promise<void>;
  upsertArtistImages?(artists: ProxyArtistImage[]): Promise<void>;
}

export class UpstreamProxyService implements ProxyUpstream {
  constructor(
    private readonly animeThemes: Pick<AnimeThemesClient, "search" | "fetchArtist">,
    private readonly kitsu: Pick<KitsuClient, "searchAnimeByText">,
    private readonly catalog?: ProxyCatalogWriter,
  ) {}

  async search(query: string): Promise<unknown> {
    const [animeThemes, kitsu] = await Promise.all([
      this.animeThemes.search(query),
      this.kitsu.searchAnimeByText(query),
    ]);
    await this.catalog?.saveOnlineAnimeCatalog?.(searchThemeEntries(animeThemes));
    await this.catalog?.upsertArtistImages?.(searchArtistImages(animeThemes));
    return { query, animeThemes, kitsu };
  }

  async artist(slug: string): Promise<unknown> {
    const artist = await this.animeThemes.fetchArtist(slug);
    await this.catalog?.saveOnlineAnimeCatalog?.(artistThemeEntries(artist));
    await this.catalog?.upsertArtistImages?.(artistImages(artist));
    return artist;
  }
}

function searchThemeEntries(payload: unknown): AnimeThemeEntry[] {
  return asRecordArray(asRecord(asRecord(payload)?.search)?.anime).flatMap(themeEntriesForAnime);
}

function searchArtistImages(payload: unknown): ProxyArtistImage[] {
  return asRecordArray(asRecord(asRecord(payload)?.search)?.artists).flatMap(artistImageFromProfile);
}

function artistThemeEntries(payload: unknown): AnimeThemeEntry[] {
  const artist = asRecord(asRecord(payload)?.artist);
  return asRecordArray(artist?.songs).flatMap((song) => {
    const songTitle = stringValue(song.title);
    const songArtists = asRecordArray(song.artists);
    return asRecordArray(song.animethemes).flatMap((theme) => {
      const anime = asRecord(theme.anime);
      if (!anime) return [];
      const themeWithSong = {
        ...theme,
        song: {
          title: songTitle,
          artists: songArtists,
        },
      };
      return themeEntriesForAnime({ ...anime, animethemes: [themeWithSong] });
    });
  });
}

function artistImages(payload: unknown): ProxyArtistImage[] {
  const artist = asRecord(asRecord(payload)?.artist);
  return artist ? artistImageFromProfile(artist) : [];
}

function themeEntriesForAnime(anime: unknown): AnimeThemeEntry[] {
  try {
    return toThemeEntries(anime);
  } catch {
    return [];
  }
}

function artistImageFromProfile(profile: Record<string, unknown>): ProxyArtistImage[] {
  const slug = stringValue(profile.slug);
  const name = stringValue(profile.name);
  if (!slug || !name) return [];
  return [{ slug, name, imageUrl: bestImageUrl(asRecordArray(profile.images)) }];
}

function bestImageUrl(images: Record<string, unknown>[]): string | null {
  const preferred =
    images.find((image) => stringValue(image.facet)?.toLowerCase().includes("large")) ??
    images.find((image) => stringValue(image.facet)?.toLowerCase().includes("small")) ??
    images[0];
  const link = stringValue(preferred?.link);
  if (link) return link;
  const path = stringValue(preferred?.path);
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `https://i.animethemes.moe/${path.replace(/^\/+/, "")}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => asRecord(item) !== null)
    : [];
}
