import type { UpstreamHttp } from "../http/upstream.js";
import {
  animeId,
  externalIdForSite,
  parseAnimeThemesPage,
  parseSingleAnime,
  toThemeEntries,
} from "./parse.js";
import type { AnimeThemeEntry, AnimeThemesLookupResult } from "./types.js";

const API_BASE_URL = "https://api.animethemes.moe";
const BATCH_LIMIT = 50;
const MAP_INCLUDE =
  "resources,animethemes,animethemes.animethemeentries.videos," +
  "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists";
const SEARCH_INCLUDE =
  "resources,animesynonyms,animethemes,animethemes.animethemeentries.videos," +
  "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists";
const SINGLE_INCLUDE =
  "resources,images,animesynonyms,animethemes,animethemes.animethemeentries.videos," +
  "animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists";
const ARTIST_INCLUDE =
  "images,songs.animethemes.anime,songs.animethemes.animethemeentries.videos," +
  "songs.animethemes.animethemeentries.videos.audio,songs.artists";
const REQUEST_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "AnimeOngaku/0.1 (+https://github.com/nolanblew/animeonkaku; personal self-hosted server)",
};

export class AnimeThemesApiError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(`AnimeThemes request failed with HTTP ${status}${message ? `: ${message}` : ""}`);
    this.name = "AnimeThemesApiError";
  }
}

export interface AnimeThemesClientDeps {
  http: UpstreamHttp;
}

export class AnimeThemesClient {
  constructor(private readonly deps: AnimeThemesClientDeps) {}

  async fetchByKitsuIds(kitsuIds: string[]): Promise<AnimeThemesLookupResult> {
    return this.fetchByExternalIds("Kitsu", kitsuIds);
  }

  async fetchByMalIds(malIds: string[]): Promise<AnimeThemesLookupResult> {
    return this.fetchByExternalIds("MyAnimeList", malIds);
  }

  async fetchByExternalIds(site: string, externalIds: string[]): Promise<AnimeThemesLookupResult> {
    const result = emptyLookupResult();
    for (const batch of chunks(unique(externalIds), BATCH_LIMIT)) {
      if (batch.length === 0) continue;

      const anime = await this.fetchAllPages("anime", {
        "filter[has]": "resources",
        "filter[site]": site,
        "filter[external_id]": batch.join(","),
        include: MAP_INCLUDE,
        "page[size]": "100",
      });
      appendAnime(result, anime, site);
    }
    return result;
  }

  async searchByTitle(title: string): Promise<AnimeThemesLookupResult> {
    if (title.trim().length === 0) return emptyLookupResult();
    const result = emptyLookupResult();
    const page = parseAnimeThemesPage(
      await this.getJson(
        `${API_BASE_URL}/anime?${new URLSearchParams({
          q: title,
          include: SEARCH_INCLUDE,
          "page[size]": "5",
        })}`,
      ),
    );
    const anime = page.anime;
    appendAnime(result, anime, "Kitsu");
    return result;
  }

  async fetchAnimeById(animeThemesId: number): Promise<AnimeThemeEntry[]> {
    const json = await this.getJson(
      `${API_BASE_URL}/anime/${animeThemesId}?${new URLSearchParams({ include: SINGLE_INCLUDE })}`,
    );
    const anime = parseSingleAnime(json);
    return anime ? toThemeEntries(anime) : [];
  }

  async search(query: string): Promise<unknown> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return { search: [] };
    return this.getJson(
      `${API_BASE_URL}/search?${new URLSearchParams({
        q: trimmed,
        "fields[search]": "anime,artists",
        "include[anime]": SEARCH_INCLUDE,
        "include[artist]": "images",
      })}`,
    );
  }

  async fetchArtist(slug: string): Promise<unknown> {
    return this.getJson(
      `${API_BASE_URL}/artist/${encodeURIComponent(slug)}?${new URLSearchParams({
        include: ARTIST_INCLUDE,
      })}`,
    );
  }

  private async fetchAllPages(path: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
    const anime: Record<string, unknown>[] = [];
    let nextUrl: string | null = `${API_BASE_URL}/${path}?${new URLSearchParams(params)}`;

    while (nextUrl) {
      const page = parseAnimeThemesPage(await this.getJson(nextUrl));
      anime.push(...page.anime);
      nextUrl = normalizeNextUrl(page.next);
    }

    return anime;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.deps.http.request(url, {
      headers: REQUEST_HEADERS,
    });
    if (!response.ok) {
      throw new AnimeThemesApiError(response.status, await safeErrorText(response));
    }
    return response.json();
  }
}

function appendAnime(
  result: AnimeThemesLookupResult,
  anime: Record<string, unknown>[],
  mappingSite: string,
): void {
  for (const item of anime) {
    const id = animeId(item);
    const externalId = externalIdForSite(item, mappingSite);
    if (id !== null && externalId !== null) {
      result.mappings.set(externalId, id);
    }
    result.themes.push(...toThemeEntries(item));
  }
}

function emptyLookupResult(): AnimeThemesLookupResult {
  return { themes: [], mappings: new Map() };
}

function normalizeNextUrl(next: string | null): string | null {
  if (!next) return null;
  if (/^https?:\/\//i.test(next)) return next;
  return `${API_BASE_URL}/${next.replace(/^\/+/, "")}`;
}

function chunks<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))];
}

async function safeErrorText(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  return text.trim().length > 0 ? text.trim() : undefined;
}
