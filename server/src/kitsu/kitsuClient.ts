import type { UpstreamHttp } from "../http/upstream.js";
import type { KitsuAnimeEntry, KitsuGenre } from "./types.js";

const EDGE_BASE_URL = "https://kitsu.io/api/edge";
const DEFAULT_PAGE_LIMIT = 500;
const BATCH_LIMIT = 20;

interface KitsuClientDeps {
  http: UpstreamHttp;
  pageLimit?: number;
}

interface LibraryOptions {
  status?: string;
  accessToken?: string;
  onPage?: (entries: KitsuAnimeEntry[]) => void | Promise<void>;
}

interface JsonApiResource {
  id?: unknown;
  type?: unknown;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: unknown } | undefined>;
}

interface JsonApiDocument {
  data?: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  meta?: { count?: unknown };
}

interface AnimeCatalogFields {
  title: string | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  abbreviatedTitles: string[];
  posterUrl: string | null;
  posterUrlLarge: string | null;
  coverUrl: string | null;
  coverUrlLarge: string | null;
  subtype: string | null;
  startDate: string | null;
  endDate: string | null;
  episodeCount: number | null;
  ageRating: string | null;
  averageRating: number | null;
  slug: string | null;
}

export class KitsuApiError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(`Kitsu API request failed with HTTP ${status}${message ? `: ${message}` : ""}`);
    this.name = "KitsuApiError";
  }
}

export class KitsuClient {
  private readonly http: UpstreamHttp;
  private readonly pageLimit: number;

  constructor(deps: KitsuClientDeps) {
    this.http = deps.http;
    this.pageLimit = deps.pageLimit ?? DEFAULT_PAGE_LIMIT;
  }

  async getLibraryEntries(
    userId: string,
    options: LibraryOptions = {},
  ): Promise<KitsuAnimeEntry[]> {
    return this.fetchLibraryEntries(userId, options);
  }

  async getLibraryEntriesUpdatedSince(
    userId: string,
    sinceIso: string,
    accessToken?: string,
  ): Promise<KitsuAnimeEntry[]> {
    const options: LibraryOptions & { stopAtOrBefore: string } = { stopAtOrBefore: sinceIso };
    if (accessToken !== undefined) {
      options.accessToken = accessToken;
    }
    return this.fetchLibraryEntries(userId, options);
  }

  async getAnimeDetails(ids: string[]): Promise<Map<string, KitsuAnimeEntry>> {
    const details = new Map<string, KitsuAnimeEntry>();
    for (const batch of chunks(unique(ids), BATCH_LIMIT)) {
      if (batch.length === 0) continue;
      const document = await this.getJson("anime", {
        "filter[id]": batch.join(","),
        "page[limit]": String(BATCH_LIMIT),
      });
      for (const resource of asArray(document.data)) {
        if (resource.type !== "anime") continue;
        const id = idOf(resource);
        if (!id) continue;
        details.set(id, {
          id,
          ...parseAnimeCatalog(resource),
          watchingStatus: null,
          userRating: null,
          libraryUpdatedAt: null,
        });
      }
    }
    return details;
  }

  async getAnimeMappings(ids: string[]): Promise<Map<string, Record<string, string>>> {
    const result = new Map<string, Record<string, string>>();
    for (const batch of chunks(unique(ids), BATCH_LIMIT)) {
      if (batch.length === 0) continue;
      const document = await this.getJson("anime", {
        "filter[id]": batch.join(","),
        include: "mappings",
        "page[limit]": String(BATCH_LIMIT),
      });
      const included = indexIncluded(document.included, "mappings");

      for (const anime of asArray(document.data)) {
        if (anime.type !== "anime") continue;
        const animeId = idOf(anime);
        if (!animeId) continue;

        const mappings: Record<string, string> = {};
        for (const relationship of relationshipData(anime, "mappings")) {
          const mapping = included.get(relationship.id);
          const externalSite = stringAttr(mapping, "externalSite");
          const externalId = scalarAttr(mapping, "externalId");
          if (externalSite && externalId !== null) {
            mappings[externalSite] = String(externalId);
          }
        }
        result.set(animeId, mappings);
      }
    }
    return result;
  }

  async getAnimeCategories(ids: string[]): Promise<Map<string, KitsuGenre[]>> {
    const result = new Map<string, KitsuGenre[]>();
    for (const batch of chunks(unique(ids), BATCH_LIMIT)) {
      if (batch.length === 0) continue;
      const document = await this.getJson("anime", {
        "filter[id]": batch.join(","),
        include: "categories",
        "page[limit]": String(BATCH_LIMIT),
      });
      const included = indexIncluded(document.included, "categories");

      for (const anime of asArray(document.data)) {
        if (anime.type !== "anime") continue;
        const animeId = idOf(anime);
        if (!animeId) continue;

        const genres = relationshipData(anime, "categories")
          .map((relationship) => included.get(relationship.id))
          .filter((category): category is JsonApiResource => category !== undefined)
          .map((category) => ({
            slug: stringAttr(category, "slug") ?? idOf(category) ?? "",
            displayName: stringAttr(category, "title") ?? stringAttr(category, "slug") ?? "",
            source: "category",
          }))
          .filter((genre) => genre.slug.length > 0 && genre.displayName.length > 0);
        result.set(animeId, genres);
      }
    }
    return result;
  }

  private async fetchLibraryEntries(
    userId: string,
    options: LibraryOptions & { stopAtOrBefore?: string },
  ): Promise<KitsuAnimeEntry[]> {
    const entries: KitsuAnimeEntry[] = [];
    let offset = 0;
    let totalCount: number | null = null;
    let shouldStop = false;

    while (!shouldStop) {
      const params: Record<string, string> = {
        include: "anime",
        sort: "-updatedAt",
        "page[limit]": String(this.pageLimit),
        "page[offset]": String(offset),
      };
      if (options.status !== undefined) {
        params["filter[status]"] = options.status;
      } else if (!options.stopAtOrBefore) {
        params["filter[status]"] = "current,completed";
      }

      const requestOptions =
        options.accessToken !== undefined ? { accessToken: options.accessToken } : {};
      const document = await this.getJson(
        `users/${encodeURIComponent(userId)}/library-entries`,
        params,
        requestOptions,
      );
      totalCount = toNumber(document.meta?.count) ?? totalCount;

      const includedAnime = indexIncluded(document.included, "anime");
      const pageEntries = asArray(document.data)
        .filter((resource) => resource.type === "libraryEntries")
        .map((resource) => parseLibraryEntry(resource, includedAnime.get(animeRelationshipId(resource) ?? "")));

      const missingDetails = pageEntries
        .filter((entry) => entry.title === null || entry.posterUrl === null)
        .map((entry) => entry.id);
      const detailMap = await this.getAnimeDetails(missingDetails);
      const completePageEntries = pageEntries.map((entry) =>
        mergeCatalogFields(entry, detailMap.get(entry.id)),
      );

      const acceptedPageEntries: KitsuAnimeEntry[] = [];
      for (const entry of completePageEntries) {
        if (
          options.stopAtOrBefore &&
          entry.libraryUpdatedAt !== null &&
          entry.libraryUpdatedAt <= options.stopAtOrBefore
        ) {
          shouldStop = true;
          break;
        }
        acceptedPageEntries.push(entry);
      }

      entries.push(...acceptedPageEntries);
      await options.onPage?.(acceptedPageEntries);

      offset += this.pageLimit;
      if (completePageEntries.length === 0 || (totalCount !== null && offset >= totalCount)) {
        break;
      }
    }

    return entries;
  }

  private async getJson(
    path: string,
    params: Record<string, string>,
    options: { accessToken?: string } = {},
  ): Promise<JsonApiDocument> {
    const query = new URLSearchParams(params);
    const response = await this.http.request(`${EDGE_BASE_URL}/${path}?${query}`, {
      headers: jsonApiHeaders(options.accessToken),
    });
    if (!response.ok) {
      throw new KitsuApiError(response.status, await safeErrorText(response));
    }
    return (await response.json()) as JsonApiDocument;
  }
}

function jsonApiHeaders(accessToken: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

function parseLibraryEntry(resource: JsonApiResource, anime: JsonApiResource | undefined): KitsuAnimeEntry {
  const id = animeRelationshipId(resource) ?? idOf(resource) ?? "";
  const ratingTwenty = scalarAttr(resource, "ratingTwenty");
  return {
    id,
    ...parseAnimeCatalog(anime),
    watchingStatus: stringAttr(resource, "status"),
    userRating: toNumber(ratingTwenty) !== null ? toNumber(ratingTwenty)! / 2 : null,
    libraryUpdatedAt: stringAttr(resource, "updatedAt"),
  };
}

function parseAnimeCatalog(anime: JsonApiResource | undefined): AnimeCatalogFields {
  const titles = objectAttr(anime, "titles");
  const poster = objectAttr(anime, "posterImage");
  const cover = objectAttr(anime, "coverImage");
  const titleEn = stringValue(titles?.en);
  const titleRomaji = stringValue(titles?.en_jp);
  const titleJa = stringValue(titles?.ja_jp);
  const canonicalTitle = stringAttr(anime, "canonicalTitle");
  const averageRating = toNumber(scalarAttr(anime, "averageRating"));

  return {
    title: titleEn ?? canonicalTitle ?? titleRomaji,
    titleEn,
    titleRomaji,
    titleJa,
    abbreviatedTitles: stringArrayAttr(anime, "abbreviatedTitles"),
    posterUrl: preferredImage(poster),
    posterUrlLarge: stringValue(poster?.large) ?? stringValue(poster?.original),
    coverUrl: preferredImage(cover),
    coverUrlLarge: stringValue(cover?.large) ?? stringValue(cover?.original),
    subtype: stringAttr(anime, "subtype"),
    startDate: stringAttr(anime, "startDate"),
    endDate: stringAttr(anime, "endDate"),
    episodeCount: toNumber(scalarAttr(anime, "episodeCount")),
    ageRating: stringAttr(anime, "ageRating"),
    averageRating: averageRating !== null ? averageRating / 10 : null,
    slug: stringAttr(anime, "slug"),
  };
}

function mergeCatalogFields(entry: KitsuAnimeEntry, details: KitsuAnimeEntry | undefined): KitsuAnimeEntry {
  if (!details) return entry;
  return {
    ...entry,
    title: entry.title ?? details.title,
    titleEn: entry.titleEn ?? details.titleEn,
    titleRomaji: entry.titleRomaji ?? details.titleRomaji,
    titleJa: entry.titleJa ?? details.titleJa,
    abbreviatedTitles:
      entry.abbreviatedTitles.length > 0 ? entry.abbreviatedTitles : details.abbreviatedTitles,
    posterUrl: entry.posterUrl ?? details.posterUrl,
    posterUrlLarge: entry.posterUrlLarge ?? details.posterUrlLarge,
    coverUrl: entry.coverUrl ?? details.coverUrl,
    coverUrlLarge: entry.coverUrlLarge ?? details.coverUrlLarge,
    subtype: entry.subtype ?? details.subtype,
    startDate: entry.startDate ?? details.startDate,
    endDate: entry.endDate ?? details.endDate,
    episodeCount: entry.episodeCount ?? details.episodeCount,
    ageRating: entry.ageRating ?? details.ageRating,
    averageRating: entry.averageRating ?? details.averageRating,
    slug: entry.slug ?? details.slug,
  };
}

function relationshipData(resource: JsonApiResource, name: string): Array<{ type: string; id: string }> {
  const data = resource.relationships?.[name]?.data;
  return asArray(data)
    .map((item) => {
      if (!isRecord(item)) return null;
      const type = stringValue(item.type);
      const id = scalarValue(item.id);
      return type && id !== null ? { type, id: String(id) } : null;
    })
    .filter((item): item is { type: string; id: string } => item !== null);
}

function animeRelationshipId(resource: JsonApiResource): string | null {
  return relationshipData(resource, "anime")[0]?.id ?? null;
}

function indexIncluded(
  included: JsonApiResource[] | undefined,
  type: string,
): Map<string, JsonApiResource> {
  const result = new Map<string, JsonApiResource>();
  for (const resource of included ?? []) {
    const id = idOf(resource);
    if (resource.type === type && id) {
      result.set(id, resource);
    }
  }
  return result;
}

function asArray(value: unknown): JsonApiResource[] {
  if (Array.isArray(value)) return value.filter(isJsonApiResource);
  if (isJsonApiResource(value)) return [value];
  return [];
}

function isJsonApiResource(value: unknown): value is JsonApiResource {
  return isRecord(value);
}

function idOf(resource: JsonApiResource | undefined): string | null {
  return resource?.id === undefined || resource.id === null ? null : String(resource.id);
}

function stringAttr(resource: JsonApiResource | undefined, key: string): string | null {
  return stringValue(resource?.attributes?.[key]);
}

function stringArrayAttr(resource: JsonApiResource | undefined, key: string): string[] {
  const value = resource?.attributes?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectAttr(resource: JsonApiResource | undefined, key: string): Record<string, unknown> | null {
  const value = resource?.attributes?.[key];
  return isRecord(value) ? value : null;
}

function scalarAttr(resource: JsonApiResource | undefined, key: string): string | number | null {
  return scalarValue(resource?.attributes?.[key]);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function scalarValue(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function preferredImage(image: Record<string, unknown> | null): string | null {
  return (
    stringValue(image?.original) ??
    stringValue(image?.large) ??
    stringValue(image?.medium) ??
    stringValue(image?.small) ??
    stringValue(image?.tiny)
  );
}

function chunks<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function safeErrorText(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  return text.trim().length > 0 ? text.trim() : undefined;
}
