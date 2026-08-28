import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { kitsuAnime, libraryEntries, playlistEntries, playlists } from "../db/schema.js";
import type {
  BrowserHomeAnimeSummary,
  BrowserHomePlaylistSummary,
  BrowserHomeResponse,
  BrowserHomeService,
} from "./liveRoutes.js";

const DEFAULT_HOME_LIMIT = 24;
const MAX_HOME_LIMIT = 100;
const HOME_CURSOR_VERSION = 1;

type AnimeCursorAnchor = { updatedAt: number; kitsuId: string };
type PlaylistCursorAnchor = { updatedAt: number; id: number };

interface HomeCursor {
  version: typeof HOME_CURSOR_VERSION;
  continueWatching: AnimeCursorAnchor | null;
  recentlyAdded: AnimeCursorAnchor | null;
  playlists: PlaylistCursorAnchor | null;
}

interface AnimeHomeRow {
  kitsuId: string;
  title: string | null;
  posterUrl: string | null;
  posterUrlLarge: string | null;
  updatedAt: Date | string | number | null;
}

interface PlaylistHomeRow {
  id: number;
  name: string;
  itemCount: number | string | null;
  isAuto: boolean;
  updatedAt: Date | string | number | null;
}

interface Page<T> {
  rows: T[];
  hasMore: boolean;
}

/**
 * Drizzle-backed projection for the browser home screen.
 *
 * The durable schema has no episode progress or a library `created_at` field.
 * Consequently, "continue watching" is the user's active Kitsu `current`
 * library slice ordered by its latest server-side update, and "recently added"
 * is the active library slice ordered by the same durable row-update clock.
 * The schema has no library `created_at`, so this is the closest correct
 * interpretation and exposes only facts the schema stores rather than
 * inventing playback position or creation time.
 *
 * Each section is fetched with one bounded keyset query. Playlist counts are a
 * correlated count in that query, not per-playlist reads, so a large library
 * cannot turn this projection into an N+1 query pattern.
 */
export class DrizzleBrowserHomeService implements BrowserHomeService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getHome(
    userId: string,
    options: { limit: number; cursor: string | null },
  ): Promise<BrowserHomeResponse> {
    const limit = boundedLimit(options.limit);
    const cursor = decodeHomeCursor(options.cursor);
    const serverTime = this.now().getTime();

    const [continuePage, recentlyAddedPage, playlistPage] = await Promise.all([
      this.continueWatchingPage(userId, limit, cursor?.continueWatching ?? null),
      this.recentlyAddedPage(userId, limit, cursor?.recentlyAdded ?? null),
      this.playlistsPage(userId, limit, cursor?.playlists ?? null),
    ]);

    const nextCursor = continuePage.hasMore || recentlyAddedPage.hasMore || playlistPage.hasMore
      ? encodeHomeCursor({
          version: HOME_CURSOR_VERSION,
          continueWatching: nextAnimeAnchor(continuePage.rows, cursor?.continueWatching ?? null),
          recentlyAdded: nextAnimeAnchor(recentlyAddedPage.rows, cursor?.recentlyAdded ?? null),
          playlists: nextPlaylistAnchor(playlistPage.rows, cursor?.playlists ?? null),
        })
      : null;

    return {
      serverTime,
      continueWatching: continuePage.rows.map(toAnimeSummary),
      recentlyAdded: recentlyAddedPage.rows.map(toAnimeSummary),
      playlists: playlistPage.rows.map(toPlaylistSummary),
      nextCursor,
    };
  }

  private async continueWatchingPage(
    userId: string,
    limit: number,
    cursor: AnimeCursorAnchor | null,
  ): Promise<Page<AnimeHomeRow>> {
    const conditions = [
      eq(libraryEntries.userId, userId),
      eq(libraryEntries.watchingStatus, "current"),
      isNull(libraryEntries.deletedAt),
      isNull(kitsuAnime.deletedAt),
      ...(cursor ? [afterAnimeCursor(libraryEntries.updatedAt, kitsuAnime.kitsuId, cursor)] : []),
    ];
    const rows = await this.db
      .select({
        kitsuId: kitsuAnime.kitsuId,
        title: kitsuAnime.title,
        posterUrl: kitsuAnime.posterUrl,
        posterUrlLarge: kitsuAnime.posterUrlLarge,
        updatedAt: libraryEntries.updatedAt,
      })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(kitsuAnime.kitsuId, libraryEntries.kitsuId))
      .where(and(...conditions))
      .orderBy(desc(libraryEntries.updatedAt), asc(kitsuAnime.kitsuId))
      .limit(limit + 1);
    return page(rows as AnimeHomeRow[], limit);
  }

  private async recentlyAddedPage(
    userId: string,
    limit: number,
    cursor: AnimeCursorAnchor | null,
  ): Promise<Page<AnimeHomeRow>> {
    // Keep this on the indexed local update clock. It is the only durable
    // timestamp shared by Kitsu-synced and manually added library rows.
    const updatedAt = libraryEntries.updatedAt;
    const conditions = [
      eq(libraryEntries.userId, userId),
      isNull(libraryEntries.deletedAt),
      isNull(kitsuAnime.deletedAt),
      ...(cursor ? [afterAnimeCursor(updatedAt, kitsuAnime.kitsuId, cursor)] : []),
    ];
    const rows = await this.db
      .select({
        kitsuId: kitsuAnime.kitsuId,
        title: kitsuAnime.title,
        posterUrl: kitsuAnime.posterUrl,
        posterUrlLarge: kitsuAnime.posterUrlLarge,
        updatedAt,
      })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(kitsuAnime.kitsuId, libraryEntries.kitsuId))
      .where(and(...conditions))
      .orderBy(desc(updatedAt), asc(kitsuAnime.kitsuId))
      .limit(limit + 1);
    return page(rows as AnimeHomeRow[], limit);
  }

  private async playlistsPage(
    userId: string,
    limit: number,
    cursor: PlaylistCursorAnchor | null,
  ): Promise<Page<PlaylistHomeRow>> {
    const conditions = [
      eq(playlists.userId, userId),
      isNull(playlists.deletedAt),
      ...(cursor ? [afterPlaylistCursor(playlists.updatedAt, playlists.id, cursor)] : []),
    ];
    const rows = await this.db
      .select({
        id: playlists.id,
        name: playlists.name,
        itemCount: sql<number>`count(${playlistEntries.id})`,
        isAuto: playlists.isAuto,
        updatedAt: playlists.updatedAt,
      })
      .from(playlists)
      .leftJoin(playlistEntries, eq(playlistEntries.playlistId, playlists.id))
      .where(and(...conditions))
      .groupBy(playlists.id)
      .orderBy(desc(playlists.updatedAt), asc(playlists.id))
      .limit(limit + 1);
    return page(rows as PlaylistHomeRow[], limit);
  }
}

function page<T>(rows: T[], limit: number): Page<T> {
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

function boundedLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HOME_LIMIT;
  return Math.min(MAX_HOME_LIMIT, Math.max(1, Math.trunc(value)));
}

function afterAnimeCursor(
  updatedAt: Parameters<typeof lt>[0],
  id: Parameters<typeof eq>[0],
  cursor: AnimeCursorAnchor,
) {
  const date = new Date(cursor.updatedAt);
  return or(
    lt(updatedAt, date),
    and(eq(updatedAt, date), gt(id, cursor.kitsuId)),
  );
}

function afterPlaylistCursor(
  updatedAt: Parameters<typeof lt>[0],
  id: Parameters<typeof eq>[0],
  cursor: PlaylistCursorAnchor,
) {
  const date = new Date(cursor.updatedAt);
  return or(
    lt(updatedAt, date),
    and(eq(updatedAt, date), gt(id, cursor.id)),
  );
}

function nextAnimeAnchor(rows: AnimeHomeRow[], previous: AnimeCursorAnchor | null): AnimeCursorAnchor | null {
  const row = rows.at(-1);
  return row
    ? { updatedAt: toMillis(row.updatedAt), kitsuId: row.kitsuId }
    : previous;
}

function nextPlaylistAnchor(rows: PlaylistHomeRow[], previous: PlaylistCursorAnchor | null): PlaylistCursorAnchor | null {
  const row = rows.at(-1);
  return row
    ? { updatedAt: toMillis(row.updatedAt), id: row.id }
    : previous;
}

function toAnimeSummary(row: AnimeHomeRow): BrowserHomeAnimeSummary {
  return {
    kitsuId: row.kitsuId,
    title: row.title,
    posterUrl: serverPosterUrl(row.kitsuId, row.posterUrl, row.posterUrlLarge),
    updatedAt: toMillis(row.updatedAt),
  };
}

function toPlaylistSummary(row: PlaylistHomeRow): BrowserHomePlaylistSummary {
  const count = Number(row.itemCount);
  return {
    id: row.id,
    name: row.name,
    itemCount: Number.isSafeInteger(count) && count >= 0 ? count : 0,
    isAuto: row.isAuto,
    updatedAt: toMillis(row.updatedAt),
  };
}

function serverPosterUrl(kitsuId: string, posterUrl: string | null, posterUrlLarge: string | null): string | null {
  if (![posterUrl, posterUrlLarge].some((url) => typeof url === "string" && url.trim().length > 0)) return null;
  return `/v1/media/images/anime/${encodeURIComponent(kitsuId)}/poster`;
}

function toMillis(value: Date | string | number | null | undefined): number {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : 0;
  }
  return 0;
}

function encodeHomeCursor(cursor: HomeCursor): string {
  const compact = {
    v: cursor.version,
    c: cursor.continueWatching,
    r: cursor.recentlyAdded,
    p: cursor.playlists,
  };
  return Buffer.from(JSON.stringify(compact), "utf8").toString("base64url");
}

function decodeHomeCursor(value: string | null): HomeCursor | null {
  if (!value || value.length > 256) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(parsed) || parsed.v !== HOME_CURSOR_VERSION) return null;
    const continueWatching = decodeAnimeAnchor(parsed.c);
    const recentlyAdded = decodeAnimeAnchor(parsed.r);
    const playlists = decodePlaylistAnchor(parsed.p);
    if (parsed.c !== null && continueWatching === null) return null;
    if (parsed.r !== null && recentlyAdded === null) return null;
    if (parsed.p !== null && playlists === null) return null;
    return { version: HOME_CURSOR_VERSION, continueWatching, recentlyAdded, playlists };
  } catch {
    return null;
  }
}

function decodeAnimeAnchor(value: unknown): AnimeCursorAnchor | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isValidCursorMillis(value.updatedAt) || typeof value.kitsuId !== "string" || value.kitsuId.length === 0) return null;
  return { updatedAt: value.updatedAt, kitsuId: value.kitsuId };
}

function decodePlaylistAnchor(value: unknown): PlaylistCursorAnchor | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isValidCursorMillis(value.updatedAt) || !isPositiveSafeInteger(value.id)) return null;
  return { updatedAt: value.updatedAt, id: value.id };
}

function isValidCursorMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
