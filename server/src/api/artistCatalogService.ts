import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  artistCatalogs,
  artists,
  animethemesAnime,
  kitsuAnime,
  mediaFiles,
  musicReleases,
  songs,
  themeArtists,
  themeFullSongs,
  themeVideoSources,
  themes,
  type ArtistCatalogStatus,
} from "../db/schema.js";
import type { JobHandler, JobRecord } from "../jobs/types.js";
import { JobPriority, type JobQueue } from "../jobs/index.js";
import { CANONICAL_AUDIO } from "../media/types.js";
import type { ProxyUpstream } from "./proxyRoutes.js";

export const ARTIST_CATALOG_JOB_TYPE = "REFRESH_ARTIST_CATALOG" as const;
export const ARTIST_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const REFRESH_REQUEST_COOLDOWN_MS = 2 * 60 * 1000;

export interface ArtistCatalogServiceOptions {
  now?: () => Date;
  ttlMs?: number;
  refreshCooldownMs?: number;
}

export interface ArtistCatalogResponse {
  artist: Record<string, unknown>;
  themes: unknown[];
  fullSongs: unknown[];
  catalogState: {
    status: ArtistCatalogStatus;
    hasData: boolean;
    lastUpdatedAt: string | null;
  };
  [key: string]: unknown;
}

interface ArtistCatalogRow {
  slug: string;
  artist: unknown;
  themes: unknown;
  fullSongs: unknown;
  status: ArtistCatalogStatus;
  hasData: boolean;
  lastUpdatedAt: Date | null;
  refreshRequestedAt: Date | null;
  lastError: string | null;
}

interface ArtistCatalogSnapshot {
  artist: Record<string, unknown>;
  themes: unknown[];
  fullSongs: unknown[];
}

/**
 * Durable browser artist projection. The upstream route remains separate for
 * Android compatibility; this service never performs provider work in GET.
 */
export class ArtistCatalogService {
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly refreshCooldownMs: number;

  constructor(
    private readonly db: Db,
    private readonly queue: JobQueue,
    private readonly upstream: Pick<ProxyUpstream, "artist">,
    options: ArtistCatalogServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? ARTIST_CATALOG_TTL_MS;
    this.refreshCooldownMs = options.refreshCooldownMs ?? REFRESH_REQUEST_COOLDOWN_MS;
  }

  async catalog(slug: string): Promise<ArtistCatalogResponse> {
    const requestedSlug = normalizeSlug(slug);
    let row = await this.findRow(requestedSlug);
    if (!row) {
      const existing = await this.reconstructExisting(requestedSlug);
      if (existing) {
        await this.writeSnapshot(requestedSlug, existing, {
          // This local projection is immediately useful, but it can be
          // missing provider metadata. Mark it refreshing so the durable
          // worker completes it without blocking this response.
          status: "refreshing",
          hasData: true,
          lastUpdatedAt: existing.lastUpdatedAt,
          refreshRequestedAt: null,
          lastError: null,
        });
        row = await this.findRow(requestedSlug);
        if (!row) throw new Error("Artist catalog snapshot was not persisted.");
      } else {
        await this.ensurePlaceholder(requestedSlug, "loading");
        row = await this.findRow(requestedSlug);
        if (!row) throw new Error("Artist catalog placeholder was not persisted.");
      }
    }

    try {
      // Startup precache is intentionally maintenance priority. A user
      // request must be able to promote that queued work without creating a
      // duplicate.
      await this.promoteQueuedRefresh(requestedSlug, row);
      row = await this.findRow(requestedSlug) ?? row;
      if (await this.shouldQueueInitialRefresh(row)) {
        try {
          await this.requestRefresh(requestedSlug, row, false, JobPriority.HIGH);
        } catch {
          // A cached catalog must remain renderable when the queue/database is
          // temporarily unavailable. requestRefresh has already persisted the
          // error state where possible.
        }
        row = await this.findRow(requestedSlug) ?? row;
      } else if (await this.shouldQueueStaleRefresh(row)) {
        try {
          await this.requestRefresh(requestedSlug, row, false, JobPriority.HIGH);
        } catch {
          // Keep stale themes available while a retry can be requested later.
        }
        row = await this.findRow(requestedSlug) ?? row;
      }
    } catch {
      // Queue inspection is best-effort for GET. Durable data has already
      // been loaded, so a queue outage must not turn a cached page into 500.
      row = await this.findRow(requestedSlug) ?? row;
    }
    return rowResponse(row);
  }

  async refresh(slug: string): Promise<ArtistCatalogResponse> {
    const requestedSlug = normalizeSlug(slug);
    const row = await this.findRow(requestedSlug);
    if (row) {
      await this.requestRefresh(requestedSlug, row ?? undefined, true);
    } else {
      const existing = await this.reconstructExisting(requestedSlug);
      if (existing) {
        await this.writeSnapshot(requestedSlug, existing, {
          status: "refreshing",
          hasData: true,
          lastUpdatedAt: existing.lastUpdatedAt,
          refreshRequestedAt: this.now(),
          lastError: null,
        });
        await this.requestRefresh(requestedSlug, await this.findRow(requestedSlug) ?? undefined, true);
      } else {
        await this.ensurePlaceholder(requestedSlug, "loading");
        const placeholder = await this.findRow(requestedSlug);
        await this.requestRefresh(requestedSlug, placeholder ?? undefined, true);
      }
    }
    const refreshed = await this.findRow(requestedSlug);
    if (!refreshed) throw new Error("Artist catalog refresh state was not persisted.");
    return rowResponse(refreshed);
  }

  async runRefresh(payload: Record<string, unknown>, _job?: JobRecord): Promise<void> {
    const slug = requiredSlug(payload.slug);
    const before = await this.findRow(slug);
    try {
      const snapshot = await this.loadUpstreamWithSlugAlias(slug);
      await this.writeSnapshot(slug, snapshot, {
        status: "ready",
        hasData: true,
        lastUpdatedAt: this.now(),
        refreshRequestedAt: null,
        lastError: null,
      });
    } catch (error) {
      const retryable = Boolean(_job && _job.attempts + 1 < _job.maxAttempts);
      await this.writeState(slug, {
        status: retryable ? (before?.hasData ? "refreshing" : "loading") : "error",
        hasData: before?.hasData ?? false,
        lastUpdatedAt: before?.lastUpdatedAt ?? null,
        refreshRequestedAt: retryable ? before?.refreshRequestedAt ?? this.now() : null,
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Queue a bounded set of library-linked artists during process startup. */
  async precacheKnownArtists(limit = 24): Promise<number> {
    const slugs = await this.libraryArtistSlugs(limit);
    let queued = 0;
    for (const slug of slugs) {
      const row = await this.findRow(slug);
      if (!row) {
        // Reconstruct the durable DB projection first. Calling requestRefresh
        // directly would replace known data with an empty loading skeleton.
        const existing = await this.reconstructExisting(slug);
        if (existing) {
          await this.writeSnapshot(slug, existing, {
            status: "refreshing",
            hasData: true,
            lastUpdatedAt: existing.lastUpdatedAt,
            refreshRequestedAt: null,
            lastError: null,
          });
        } else {
          await this.ensurePlaceholder(slug, "loading");
        }
        await this.requestRefresh(slug, await this.findRow(slug) ?? undefined, false, JobPriority.MAINTENANCE);
        queued += 1;
      } else if (await this.shouldQueueInitialRefresh(row) || await this.shouldQueueStaleRefresh(row)) {
        await this.requestRefresh(slug, row, false, JobPriority.MAINTENANCE);
        queued += 1;
      }
    }
    return queued;
  }

  handlers(): { REFRESH_ARTIST_CATALOG: JobHandler } {
    return {
      REFRESH_ARTIST_CATALOG: async (payload, job) => this.runRefresh(payload, job),
    };
  }

  private async requestRefresh(slug: string, row?: ArtistCatalogRow, force = false, priority: number = JobPriority.HIGH): Promise<void> {
    if (!force && row?.refreshRequestedAt && this.now().getTime() - row.refreshRequestedAt.getTime() < this.refreshCooldownMs) return;
    if (!row) {
      await this.ensurePlaceholder(slug, "loading");
      row = await this.findRow(slug) ?? undefined;
    }
    const dedupeKey = `${ARTIST_CATALOG_JOB_TYPE}:${slug}`;
    const existingJob = await this.queue.findByDedupeKey(dedupeKey);
    if (existingJob?.state === "RUNNING" || (existingJob?.state === "QUEUED" && existingJob.priority <= priority)) {
      // A racing request must not reset an in-flight durable job. Repair a
      // stale state marker only when the job itself is already carrying work.
      if (row && row.status !== (row.hasData ? "refreshing" : "loading")) {
        await this.writeState(slug, {
          status: row.hasData ? "refreshing" : "loading",
          hasData: row.hasData,
          lastUpdatedAt: row.lastUpdatedAt,
          refreshRequestedAt: row.refreshRequestedAt ?? this.now(),
          lastError: null,
        });
      }
      return;
    }
    const now = this.now();
    const hasData = row?.hasData ?? false;
    await this.writeState(slug, {
      status: hasData ? "refreshing" : "loading",
      hasData,
      lastUpdatedAt: row?.lastUpdatedAt ?? null,
      refreshRequestedAt: now,
      lastError: null,
    });
    try {
      await this.enqueueRefresh(slug, priority);
    } catch (error) {
      await this.writeState(slug, {
        status: "error",
        hasData,
        lastUpdatedAt: row?.lastUpdatedAt ?? null,
        refreshRequestedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async enqueueRefresh(slug: string, priority: number = JobPriority.HIGH): Promise<void> {
    await this.queue.enqueue({
      type: ARTIST_CATALOG_JOB_TYPE,
      priority,
      payload: { slug },
      dedupeKey: `${ARTIST_CATALOG_JOB_TYPE}:${slug}`,
      maxAttempts: 3,
    });
  }

  private async shouldQueueInitialRefresh(row: ArtistCatalogRow): Promise<boolean> {
    if (row.hasData || row.status !== "loading") return false;
    return this.refreshCanBeRepaired(row);
  }

  private async shouldQueueStaleRefresh(row: ArtistCatalogRow): Promise<boolean> {
    if (!row.hasData) return false;
    if (row.status === "refreshing") return this.refreshCanBeRepaired(row);
    if (row.status !== "ready") return false;
    return !row.lastUpdatedAt || this.now().getTime() - row.lastUpdatedAt.getTime() >= this.ttlMs;
  }

  private async refreshCanBeRepaired(row: ArtistCatalogRow): Promise<boolean> {
    const job = await this.queue.findByDedupeKey(`${ARTIST_CATALOG_JOB_TYPE}:${row.slug}`);
    if (job && (job.state === "QUEUED" || job.state === "RUNNING")) return false;
    return !row.refreshRequestedAt || this.now().getTime() - row.refreshRequestedAt.getTime() >= this.refreshCooldownMs;
  }

  private async promoteQueuedRefresh(slug: string, row: ArtistCatalogRow): Promise<void> {
    const job = await this.queue.findByDedupeKey(`${ARTIST_CATALOG_JOB_TYPE}:${slug}`);
    if (!job || job.state !== "QUEUED" || job.priority <= JobPriority.HIGH) return;
    await this.requestRefresh(slug, row, true, JobPriority.HIGH);
  }

  private async findRow(slug: string): Promise<ArtistCatalogRow | null> {
    const rows = await this.db
      .select({
        slug: artistCatalogs.slug,
        artist: artistCatalogs.artist,
        themes: artistCatalogs.themes,
        fullSongs: artistCatalogs.fullSongs,
        status: artistCatalogs.status,
        hasData: artistCatalogs.hasData,
        lastUpdatedAt: artistCatalogs.lastUpdatedAt,
        refreshRequestedAt: artistCatalogs.refreshRequestedAt,
        lastError: artistCatalogs.lastError,
      })
      .from(artistCatalogs)
      .where(eq(artistCatalogs.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  private async ensurePlaceholder(slug: string, status: ArtistCatalogStatus): Promise<void> {
    const placeholder: ArtistCatalogSnapshot = {
      artist: { id: 0, name: displayNameFromSlug(slug), slug, artworkUrl: null },
      themes: [],
      fullSongs: [],
    };
    // Keep the catalog FK valid for unknown browser slugs while preserving an
    // existing canonical artist name/image when the row is already present.
    await this.db.insert(artists).values({
      slug,
      name: displayNameFromSlug(slug),
      imageUrl: null,
    }).onConflictDoNothing();
    await this.db.insert(artistCatalogs).values({
      slug,
      artist: placeholder.artist,
      themes: placeholder.themes,
      fullSongs: placeholder.fullSongs,
      status,
      hasData: false,
      lastUpdatedAt: null,
      refreshRequestedAt: null,
      lastError: null,
    }).onConflictDoNothing();
  }

  private async writeSnapshot(slug: string, snapshot: ArtistCatalogSnapshot, state: {
    status: ArtistCatalogStatus;
    hasData: boolean;
    lastUpdatedAt: Date | null;
    refreshRequestedAt: Date | null;
    lastError: string | null;
  }): Promise<void> {
    await this.ensureArtistRow(slug, snapshot.artist);
    await this.db.insert(artistCatalogs).values({
      slug,
      artist: snapshot.artist,
      themes: snapshot.themes,
      fullSongs: snapshot.fullSongs,
      ...state,
    }).onConflictDoUpdate({
      target: artistCatalogs.slug,
      set: {
        artist: snapshot.artist,
        themes: snapshot.themes,
        fullSongs: snapshot.fullSongs,
        ...state,
        updatedAt: this.now(),
      },
    });
  }

  private async writeState(slug: string, state: {
    status: ArtistCatalogStatus;
    hasData: boolean;
    lastUpdatedAt: Date | null;
    refreshRequestedAt: Date | null;
    lastError: string | null;
  }): Promise<void> {
    await this.db.update(artistCatalogs).set({ ...state, updatedAt: this.now() }).where(eq(artistCatalogs.slug, slug));
  }

  private async ensureArtistRow(slug: string, artist?: Record<string, unknown>): Promise<void> {
    const name = artist && typeof artist.name === "string" && artist.name.trim().length > 0
      ? artist.name
      : displayNameFromSlug(slug);
    const imageUrl = artist && typeof artist.artworkUrl === "string" ? artist.artworkUrl : null;
    await this.db.insert(artists).values({ slug, name, imageUrl }).onConflictDoNothing();
  }

  private async loadUpstreamWithSlugAlias(slug: string): Promise<ArtistCatalogSnapshot> {
    try {
      return snapshotFromUnknown(await this.upstream.artist(slug));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const alias = slug.replace(/-/g, "_");
      if (!alias || alias === slug) throw error;
      return snapshotFromUnknown(await this.upstream.artist(alias));
    }
  }

  private async reconstructExisting(slug: string): Promise<(ArtistCatalogSnapshot & { lastUpdatedAt: Date | null }) | null> {
    const artistRows = await this.db
      .select({ slug: artists.slug, name: artists.name, imageUrl: artists.imageUrl })
      .from(artists)
      .where(eq(artists.slug, slug))
      .limit(1);
    let artist = artistRows[0] ?? null;
    if (!artist && slug.includes("-")) {
      const aliasRows = await this.db
        .select({ slug: artists.slug, name: artists.name, imageUrl: artists.imageUrl })
        .from(artists)
        .where(eq(artists.slug, slug.replace(/-/g, "_")))
        .limit(1);
      artist = aliasRows[0] ?? null;
    }
    if (!artist) return null;

    const themeLinks = await this.db
      .select({ themeId: themeArtists.themeId })
      .from(themeArtists)
      .where(eq(themeArtists.artistName, artist.name));
    const themeIds = uniqueNumbers(themeLinks.map((row) => row.themeId));
    if (themeIds.length === 0) {
      return {
        artist: { id: 0, name: artist.name, slug: artist.slug, artworkUrl: artist.imageUrl },
        themes: [],
        fullSongs: [],
        lastUpdatedAt: null,
      };
    }

    const themeRows = await this.db
      .select({
        id: themes.id,
        animeThemesAnimeId: themes.animethemesAnimeId,
        title: themes.title,
        themeType: themes.themeType,
        durationSeconds: themes.durationSeconds,
        updatedAt: themes.updatedAt,
        animeName: animethemesAnime.name,
        animeNameEn: animethemesAnime.nameEn,
        animeCoverUrl: animethemesAnime.coverUrl,
      })
      .from(themes)
      .leftJoin(animethemesAnime, eq(animethemesAnime.id, themes.animethemesAnimeId))
      .where(and(inArray(themes.id, themeIds), isNull(themes.deletedAt)))
      .orderBy(asc(themes.id));
    const animeIds = uniqueNumbers(themeRows.map((row) => row.animeThemesAnimeId));
    const [mappings, credits, audio, videos, songRows] = await Promise.all([
      animeIds.length === 0 ? Promise.resolve([]) : this.db.select({ kitsuId: kitsuAnime.kitsuId, animeThemesAnimeId: kitsuAnime.animethemesAnimeId, title: kitsuAnime.title, titleEn: kitsuAnime.titleEn, posterUrl: kitsuAnime.posterUrl }).from(kitsuAnime).where(and(inArray(kitsuAnime.animethemesAnimeId, animeIds), isNull(kitsuAnime.deletedAt))),
      this.db.select({ themeId: themeArtists.themeId, name: themeArtists.artistName, asCharacter: themeArtists.asCharacter, alias: themeArtists.alias }).from(themeArtists).where(inArray(themeArtists.themeId, themeIds)).orderBy(asc(themeArtists.themeId), asc(themeArtists.artistName)),
      this.db.select({ refId: mediaFiles.refId, state: mediaFiles.state, byteSize: mediaFiles.byteSize, contentType: mediaFiles.contentType, videoFallback: mediaFiles.videoFallback }).from(mediaFiles).where(and(eq(mediaFiles.kind, CANONICAL_AUDIO.kind), eq(mediaFiles.variant, CANONICAL_AUDIO.variant), inArray(mediaFiles.refId, themeIds.map(String)))),
      this.db.select({ themeId: themeVideoSources.themeId, link: themeVideoSources.link, mimeType: themeVideoSources.mimeType, spoiler: themeVideoSources.spoiler, nsfw: themeVideoSources.nsfw, entryVersion: themeVideoSources.entryVersion }).from(themeVideoSources).where(inArray(themeVideoSources.themeId, themeIds)).orderBy(asc(themeVideoSources.themeId), asc(themeVideoSources.preferenceRank)),
      this.db.select({ themeId: themeFullSongs.themeId, songId: songs.id, title: songs.title, titleEnglish: songs.titleEnglish, titleRomaji: songs.titleRomaji, titleJapanese: songs.titleJapanese, artistCredit: songs.artistCredit, artistNames: songs.artistNames, durationSeconds: songs.durationSeconds, releaseId: musicReleases.id, releaseTitle: musicReleases.title }).from(themeFullSongs).innerJoin(songs, eq(songs.id, themeFullSongs.songId)).leftJoin(musicReleases, eq(musicReleases.id, themeFullSongs.sourceReleaseId)).where(inArray(themeFullSongs.themeId, themeIds)),
    ]);
    const mappingByAnime = groupBy(animeIds, mappings, (row) => row.animeThemesAnimeId);
    const creditsByTheme = groupBy(themeIds, credits, (row) => row.themeId);
    const audioByTheme = new Map(audio.map((row) => [Number(row.refId), row] as const));
    const videoByTheme = new Map<number, (typeof videos)[number]>();
    for (const row of videos) if (!videoByTheme.has(row.themeId)) videoByTheme.set(row.themeId, row);
    const themesDto = themeRows.map((row) => {
      const anime = mappingByAnime.get(row.animeThemesAnimeId) ?? [];
      const media = audioByTheme.get(row.id);
      const video = videoByTheme.get(row.id);
      const audioUrl = `/v1/media/audio/${row.id}`;
      return {
        id: row.id,
        animeThemesAnimeId: row.animeThemesAnimeId,
        kitsuAnimeIds: anime.map((entry) => entry.kitsuId),
        title: row.title,
        themeType: row.themeType,
        artists: (creditsByTheme.get(row.id) ?? []).map((entry) => ({ name: entry.name, asCharacter: entry.asCharacter, alias: entry.alias })),
        audioUrl,
        videoUrl: video?.link ?? null,
        // A missing cache row still has a playable server-owned on-demand
        // URL. Only advertise local cache state when a row exists.
        ...(media ? { audioState: media.state === "READY" ? "READY" : media.state === "FAILED" ? "FAILED" : media.state === "QUEUED" || media.state === "DOWNLOADING" ? "PENDING" : "MISSING" } : {}),
        durationSeconds: row.durationSeconds,
        fileSize: media?.byteSize ?? null,
        mediaModes: { tvSize: { url: audioUrl, durationSeconds: row.durationSeconds, fileSize: media?.byteSize ?? null, mimeType: media?.contentType ?? (media?.videoFallback ? "video/webm" : "audio/ogg") }, fullSize: null, video: video ? { url: video.link, mimeType: video.mimeType, spoiler: video.spoiler, nsfw: video.nsfw, entryVersion: video.entryVersion } : null },
        updatedAt: row.updatedAt?.getTime() ?? 0,
        deleted: false,
        anime: anime.length > 0 ? anime.map((entry) => ({ kitsuId: entry.kitsuId, animeThemesAnimeId: entry.animeThemesAnimeId, title: entry.title ?? row.animeName, titleEn: entry.titleEn ?? row.animeNameEn, posterUrl: entry.posterUrl ?? row.animeCoverUrl })) : [{ kitsuId: null, animeThemesAnimeId: row.animeThemesAnimeId, title: row.animeName, titleEn: row.animeNameEn, posterUrl: row.animeCoverUrl }],
      };
    });
    const themeById = new Map(themesDto.map((theme) => [theme.id, theme]));
    const uniqueSongs = new Map<number, (typeof songRows)[number]>();
    for (const song of songRows) if (!uniqueSongs.has(song.songId)) uniqueSongs.set(song.songId, song);
    const fullSongs = [...uniqueSongs.values()].map((song) => ({
      id: song.songId,
      title: song.title,
      titleEnglish: song.titleEnglish,
      titleRomaji: song.titleRomaji,
      titleJapanese: song.titleJapanese,
      artistCredit: song.artistCredit,
      artistNames: song.artistNames,
      durationSeconds: song.durationSeconds,
      audioUrl: `/v1/media/songs/${song.songId}/audio`,
      fileSize: null,
      discNumber: 1,
      trackNumber: null,
      displayOrder: 0,
      audioAvailable: false,
      releaseId: song.releaseId,
      releaseTitle: song.releaseTitle,
      anime: (themeById.get(song.themeId)?.anime as unknown[]) ?? [],
    }));
    const lastUpdatedAt = themeRows.reduce<Date | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null);
    return { artist: { id: 0, name: artist.name, slug: artist.slug, artworkUrl: artist.imageUrl }, themes: themesDto, fullSongs, lastUpdatedAt };
  }

  private async libraryArtistSlugs(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ slug: artists.slug, updatedAt: themes.updatedAt })
      .from(artists)
      .innerJoin(themeArtists, eq(themeArtists.artistName, artists.name))
      .innerJoin(themes, eq(themes.id, themeArtists.themeId))
      .innerJoin(kitsuAnime, eq(kitsuAnime.animethemesAnimeId, themes.animethemesAnimeId))
      .orderBy(desc(themes.updatedAt), asc(artists.slug))
      .limit(Math.max(1, Math.min(limit, 100)) * 8);
    const canonical = new Map<string, string>();
    for (const row of rows) {
      const key = row.slug.replace(/-/g, "_");
      if (!canonical.has(key) || row.slug.includes("_")) canonical.set(key, row.slug);
    }
    return [...canonical.values()].slice(0, limit);
  }
}

function rowResponse(row: ArtistCatalogRow): ArtistCatalogResponse {
  const artist = isRecord(row.artist) ? row.artist : { id: 0, name: displayNameFromSlug(row.slug), slug: row.slug, artworkUrl: null };
  return {
    artist,
    themes: Array.isArray(row.themes) ? row.themes : [],
    fullSongs: Array.isArray(row.fullSongs) ? row.fullSongs : [],
    catalogState: {
      status: row.status,
      hasData: row.hasData,
      lastUpdatedAt: row.lastUpdatedAt?.toISOString() ?? null,
    },
  };
}

function snapshotFromUnknown(value: unknown): ArtistCatalogSnapshot {
  if (!isRecord(value) || !isRecord(value.artist) || !Array.isArray(value.themes) || !Array.isArray(value.fullSongs)) {
    throw new Error("Artist provider response was malformed.");
  }
  const artist = value.artist;
  return {
    artist,
    themes: value.themes,
    fullSongs: value.fullSongs,
  };
}

function requiredSlug(value: unknown): string {
  if (typeof value !== "string" || normalizeSlug(value).length === 0) throw new Error("Invalid artist catalog slug.");
  return normalizeSlug(value);
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function displayNameFromSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))];
}

function groupBy<T>(keys: number[], rows: T[], key: (row: T) => number | null): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const row of rows) {
    const value = key(row);
    if (value === null || !keys.includes(value)) continue;
    result.set(value, [...(result.get(value) ?? []), row]);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.status === 404;
}
