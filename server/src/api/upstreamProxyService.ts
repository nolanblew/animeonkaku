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

const ARTIST_METADATA_CACHE_TTL_MS = 10 * 60 * 1000;
const ARTIST_METADATA_CACHE_MAX_ENTRIES = 256;
type ArtistMetadataCacheEntry = { value: Promise<AnimeThemeEntry[]>; expiresAt: number };

export class UpstreamProxyService implements ProxyUpstream {
  private readonly animeMetadataCache = new Map<string, ArtistMetadataCacheEntry>();

  constructor(
    private readonly animeThemes: Pick<AnimeThemesClient, "search" | "fetchArtist"> &
      Partial<Pick<AnimeThemesClient, "fetchAnimeById" | "fetchAnimeBySlug">>,
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
    const themes = await this.hydrateArtistThemes(artistThemeEntries(artist));
    await this.catalog?.saveOnlineAnimeCatalog?.(themes);
    await this.catalog?.upsertArtistImages?.(artistImages(artist));
    // Keep the AnimeThemes payload intact for Android clients, which deserialize
    // artist.songs directly, while adding a stable browser-facing projection.
    return artistCatalogResponse(artist, themes);
  }

  private async hydrateArtistThemes(themes: AnimeThemeEntry[]): Promise<AnimeThemeEntry[]> {
    if ((!this.animeThemes.fetchAnimeBySlug && !this.animeThemes.fetchAnimeById) || themes.length === 0) return themes;

    const animeTargets = [...new Map(themes
      .filter((theme) => !theme.kitsuId || !theme.coverUrl)
      .map((theme) => [theme.animeId, theme.animeSlug] as const)).entries()];
    const hydrated = Array<AnimeThemeEntry[]>(animeTargets.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < animeTargets.length) {
        const index = nextIndex++;
        const [animeId, animeSlug] = animeTargets[index]!;
        hydrated[index] = await this.fetchArtistAnimeMetadata(animeId, animeSlug);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, animeTargets.length) }, () => worker()));
    const byThemeId = new Map<number, AnimeThemeEntry>();
    for (const entries of hydrated) {
      for (const entry of entries) byThemeId.set(entry.themeId, entry);
    }

    return themes.map((theme) => {
      const metadata = byThemeId.get(theme.themeId);
      if (!metadata) return theme;
      return {
        ...theme,
        animeName: metadata.animeName ?? theme.animeName,
        animeNameEn: metadata.animeNameEn ?? theme.animeNameEn,
        animeSlug: metadata.animeSlug ?? theme.animeSlug,
        animeSynonyms: metadata.animeSynonyms.length > 0 ? metadata.animeSynonyms : theme.animeSynonyms,
        kitsuId: metadata.kitsuId ?? theme.kitsuId,
        coverUrl: metadata.coverUrl ?? theme.coverUrl,
      };
    });
  }

  private fetchArtistAnimeMetadata(animeId: number, animeSlug: string | null): Promise<AnimeThemeEntry[]> {
    const cacheKey = animeSlug ? `slug:${animeSlug}` : `id:${animeId}`;
    const cached = this.animeMetadataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.animeMetadataCache.delete(cacheKey);
    const pending = (animeSlug && this.animeThemes.fetchAnimeBySlug
      ? this.animeThemes.fetchAnimeBySlug(animeSlug)
      : this.animeThemes.fetchAnimeById?.(animeId) ?? Promise.resolve([])).catch(() => {
      // Artist discovery must still work when one metadata refresh is unavailable.
      return [];
    });
    // A failed lookup must be retried on the next artist request.
    this.animeMetadataCache.set(cacheKey, { value: pending, expiresAt: Date.now() + ARTIST_METADATA_CACHE_TTL_MS });
    while (this.animeMetadataCache.size > ARTIST_METADATA_CACHE_MAX_ENTRIES) {
      const oldest = this.animeMetadataCache.keys().next().value;
      if (typeof oldest !== "string") break;
      this.animeMetadataCache.delete(oldest);
    }
    void pending.then((entries) => {
      if (entries.length > 0) return;
      const current = this.animeMetadataCache.get(cacheKey);
      if (current?.value === pending) this.animeMetadataCache.delete(cacheKey);
    });
    return pending;
  }
}

function artistCatalogResponse(payload: unknown, themes = artistThemeEntries(payload)): unknown {
  const response = asRecord(payload);
  if (!response) return payload;

  const profile = asRecord(response.artist);
  const artworkUrl = profile ? bestImageUrl(asRecordArray(profile.images)) : null;
  return {
    ...response,
    artist: profile ? { ...profile, artworkUrl } : response.artist,
    themes: themes.map(artistThemeDto),
    fullSongs: artistFullSongs(payload, themes),
  };
}

function artistThemeDto(entry: AnimeThemeEntry) {
  const anime = [{
    kitsuId: entry.kitsuId,
    animeThemesAnimeId: entry.animeId,
    title: entry.animeName,
    titleEn: entry.animeNameEn,
    posterUrl: entry.coverUrl,
  }];
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

function artistFullSongs(payload: unknown, themes: AnimeThemeEntry[] = artistThemeEntries(payload)) {
  const profile = asRecord(asRecord(payload)?.artist);
  const themesById = new Map(themes.map((theme) => [theme.themeId, theme]));
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
    const anime = uniqueArtistAnime(themeRecords, themesById);
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

function uniqueArtistAnime(themes: Record<string, unknown>[], themesById: ReadonlyMap<number, AnimeThemeEntry>) {
  const seen = new Set<string>();
  return themes.flatMap((theme) => {
    const anime = asRecord(theme.anime);
    const catalogTheme = numericId(theme.id) === null ? undefined : themesById.get(numericId(theme.id)!);
    const kitsuId = catalogTheme?.kitsuId ?? externalKitsuId(anime);
    const animeThemesAnimeId = catalogTheme?.animeId ?? numericId(anime?.id);
    const key = kitsuId ? `kitsu:${kitsuId}` : animeThemesAnimeId === null ? null : `animethemes:${animeThemesAnimeId}`;
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{
      kitsuId,
      animeThemesAnimeId,
      title: catalogTheme?.animeName ?? stringValue(anime?.name),
      titleEn: catalogTheme?.animeNameEn ?? null,
      posterUrl: catalogTheme?.coverUrl ?? (anime ? coverUrlForAnime(anime) : null),
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
