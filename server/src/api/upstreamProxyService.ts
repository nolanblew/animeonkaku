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
    // Keep the AnimeThemes payload intact for Android clients, which deserialize
    // artist.songs directly, while adding a stable browser-facing projection.
    return artistCatalogResponse(artist);
  }
}

function artistCatalogResponse(payload: unknown): unknown {
  const response = asRecord(payload);
  if (!response) return payload;

  const profile = asRecord(response.artist);
  const artworkUrl = profile ? bestImageUrl(asRecordArray(profile.images)) : null;
  return {
    ...response,
    artist: profile ? { ...profile, artworkUrl } : response.artist,
    themes: artistThemeEntries(payload).map(artistThemeDto),
    fullSongs: artistFullSongs(payload),
  };
}

function artistThemeDto(entry: AnimeThemeEntry) {
  const anime = entry.kitsuId
    ? [{
      kitsuId: entry.kitsuId,
      title: entry.animeName,
      titleEn: entry.animeNameEn,
      posterUrl: entry.coverUrl,
    }]
    : [];
  const audioUrl = `/v1/media/audio/${entry.themeId}`;
  return {
    id: entry.themeId,
    animeThemesAnimeId: entry.animeId,
    kitsuAnimeIds: entry.kitsuId ? [entry.kitsuId] : [],
    title: entry.title,
    themeType: entry.themeType,
    artists: entry.artists,
    audioUrl,
    videoUrl: entry.videoUrl,
    durationSeconds: null,
    fileSize: null,
    mediaModes: {
      tvSize: { url: audioUrl, durationSeconds: null, fileSize: null },
      fullSize: null,
      video: entry.videoUrl
        ? { url: entry.videoUrl, mimeType: null, spoiler: false, nsfw: false, entryVersion: null }
        : null,
    },
    updatedAt: 0,
    deleted: false,
    anime,
  };
}

function artistFullSongs(payload: unknown) {
  const profile = asRecord(asRecord(payload)?.artist);
  return asRecordArray(profile?.songs).flatMap((song) => {
    const title = stringValue(song.title);
    const themeRecords = asRecordArray(song.animethemes);
    const songId = numericId(song.id) ?? themeRecords
      .map((theme) => numericId(asRecord(theme.song)?.id))
      .find((id): id is number => id !== null);
    if (!title || songId === null || songId === undefined) return [];

    const artists = asRecordArray(song.artists)
      .map((artist) => stringValue(artist.name))
      .filter((name): name is string => name !== null);
    const anime = uniqueArtistAnime(themeRecords);
    return [{
      id: songId,
      title,
      titleEnglish: null,
      titleRomaji: null,
      titleJapanese: null,
      artistCredit: artists.join(", "),
      artistNames: artists.map((name) => ({ english: name })),
      durationSeconds: null,
      audioUrl: `/v1/media/songs/${songId}/audio`,
      fileSize: null,
      discNumber: 1,
      trackNumber: null,
      displayOrder: 0,
      // AnimeThemes provides song metadata here, but not imported catalog
      // readiness. Keep it visible for discovery while preventing playback
      // callers from treating the server URL as a guaranteed local asset.
      audioAvailable: false,
      anime,
    }];
  });
}

function uniqueArtistAnime(themes: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return themes.flatMap((theme) => {
    const anime = asRecord(theme.anime);
    const kitsuId = externalKitsuId(anime);
    if (!anime || !kitsuId || seen.has(kitsuId)) return [];
    seen.add(kitsuId);
    return [{
      kitsuId,
      title: stringValue(anime.name),
      titleEn: null,
      posterUrl: coverUrlForAnime(anime),
    }];
  });
}

function externalKitsuId(anime: Record<string, unknown> | null): string | null {
  if (!anime) return null;
  const resource = asRecordArray(anime.resources).find((candidate) =>
    stringValue(candidate.site)?.toLowerCase() === "kitsu",
  );
  const value = resource?.external_id ?? resource?.externalId;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

function coverUrlForAnime(anime: Record<string, unknown>): string | null {
  const images = asRecordArray(anime.images);
  const preferred = images.find((image) => stringValue(image.facet)?.toLowerCase().includes("large cover")) ?? images[0];
  const link = stringValue(preferred?.link);
  if (link) return link;
  const path = stringValue(preferred?.path);
  return path ? `https://i.animethemes.moe/${path.replace(/^\/+/, "")}` : null;
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

function numericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => asRecord(item) !== null)
    : [];
}
