import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  animeGenres,
  kitsuAnime,
  libraryEntries,
  playlistEntries,
  playlists,
  themeArtists,
  themePrefs,
  themes,
} from "../db/schema.js";
import { evaluate, type EvalAnime, type EvalContext, type EvalTheme } from "./evaluate.js";

type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Materializes user dynamic (smart) playlists server-side, mirroring the device's
 * FilterEvaluator so the same spec yields the same entries on every device. Only auto-update
 * dynamic playlists are recomputed; snapshot dynamic playlists keep whatever entries were last
 * written. The candidate theme set is the user's mapped library (same universe the device sees).
 *
 * Device-only dimensions (downloaded) are broad no-ops server-side; Android applies them as a
 * view-time overlay using local download state.
 */
export class DrizzleDynamicPlaylistEvaluator {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Re-materialize the user's auto-update dynamic playlists; `playlistId` limits it to one. */
  async refresh(userId: string, playlistId?: number): Promise<void> {
    const conditions = [
      eq(playlists.userId, userId),
      eq(playlists.isAuto, false),
      eq(playlists.isDynamic, true),
      eq(playlists.dynamicAutoUpdate, true),
      isNull(playlists.deletedAt),
    ];
    if (playlistId !== undefined) conditions.push(eq(playlists.id, playlistId));
    await this.db.transaction(async (tx) => {
      // Serialize overlapping refresh triggers before loading evaluation state.
      // Otherwise an older evaluation can finish last and overwrite fresher entries.
      const dynamicRows = await tx
        .select({
          id: playlists.id,
          dynamicSpecJson: playlists.dynamicSpecJson,
          dynamicSortJson: playlists.dynamicSortJson,
        })
        .from(playlists)
        .where(and(...conditions))
        .orderBy(asc(playlists.id))
        .for("update");
      if (dynamicRows.length === 0) return;

      const ctx = await this.loadContext(userId, tx);
      for (const row of dynamicRows) {
        const { filter, sort } = dynamicPlaylistPayload(row.dynamicSpecJson, row.dynamicSortJson);
        if (filter === null) continue;
        const themeIds = evaluate(filter, sort, ctx);
        await this.saveEntries(row.id, themeIds, tx);
      }
    });
  }

  private async loadContext(userId: string, db: DbOrTx): Promise<EvalContext> {
    // Library anime the user owns and that is mapped to AnimeThemes.
    const libraryRows = await db
      .select({
        kitsuId: kitsuAnime.kitsuId,
        animeThemesId: kitsuAnime.animethemesAnimeId,
        title: kitsuAnime.title,
        startDate: kitsuAnime.startDate,
        subtype: kitsuAnime.subtype,
        averageRating: kitsuAnime.averageRating,
        userRating: libraryEntries.userRating,
        watchingStatus: libraryEntries.watchingStatus,
        libraryUpdatedAt: libraryEntries.libraryUpdatedAt,
      })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(libraryEntries.kitsuId, kitsuAnime.kitsuId))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          isNull(libraryEntries.deletedAt),
          isNull(kitsuAnime.deletedAt),
          isNotNull(kitsuAnime.animethemesAnimeId),
        ),
      )
      .orderBy(asc(kitsuAnime.kitsuId));

    const animeByThemesId = new Map<number, EvalAnime>();
    const kitsuIds: string[] = [];
    const animeThemesIds: number[] = [];
    for (const row of libraryRows) {
      if (row.animeThemesId === null) continue;
      kitsuIds.push(row.kitsuId);
      animeThemesIds.push(row.animeThemesId);
      // Last writer wins for a shared AnimeThemes id, matching the device's associateBy.
      animeByThemesId.set(row.animeThemesId, {
        title: row.title,
        startDate: row.startDate,
        subtype: row.subtype,
        averageRating: row.averageRating,
        userRating: row.userRating,
        watchingStatus: row.watchingStatus,
        libraryUpdatedAt: row.libraryUpdatedAt ? row.libraryUpdatedAt.getTime() : null,
        kitsuId: row.kitsuId,
      });
    }

    const uniqueAnimeThemesIds = [...new Set(animeThemesIds)];
    const themeRows = uniqueAnimeThemesIds.length
      ? await db
          .select({
            id: themes.id,
            title: themes.title,
            themeType: themes.themeType,
            animeThemesId: themes.animethemesAnimeId,
          })
          .from(themes)
          .where(and(inArray(themes.animethemesAnimeId, uniqueAnimeThemesIds), isNull(themes.deletedAt)))
          .orderBy(asc(themes.id))
      : [];

    const themeIds = themeRows.map((row) => row.id);
    const artistNameByTheme = await this.artistNames(themeIds, db);
    const evalThemes: EvalTheme[] = themeRows.map((row) => ({
      id: row.id,
      title: row.title,
      themeType: row.themeType,
      artistName: artistNameByTheme.get(row.id) ?? null,
      animeThemesId: row.animeThemesId,
    }));

    const genresByKitsuId = await this.genres(kitsuIds, db);
    const prefs = await this.prefs(userId, db);

    return {
      themes: evalThemes,
      animeByThemesId,
      genresByKitsuId,
      likedThemeIds: prefs.liked,
      dislikedThemeIds: prefs.disliked,
      downloadedThemeIds: new Set<number>(),
      playCountByTheme: prefs.playCount,
      lastPlayedByTheme: prefs.lastPlayed,
      nowMillis: this.now().getTime(),
    };
  }

  private async artistNames(themeIds: number[], db: DbOrTx): Promise<Map<number, string>> {
    const result = new Map<number, string[]>();
    if (themeIds.length === 0) return new Map();
    const rows = await db
      .select({ themeId: themeArtists.themeId, name: themeArtists.artistName })
      .from(themeArtists)
      .where(inArray(themeArtists.themeId, themeIds))
      .orderBy(asc(themeArtists.themeId), asc(themeArtists.artistName));
    for (const row of rows) {
      const names = result.get(row.themeId) ?? [];
      names.push(row.name);
      result.set(row.themeId, names);
    }
    return new Map([...result.entries()].map(([id, names]) => [id, names.join(", ")]));
  }

  private async genres(kitsuIds: string[], db: DbOrTx): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    const ids = [...new Set(kitsuIds)];
    if (ids.length === 0) return result;
    const rows = await db
      .select({ kitsuId: animeGenres.kitsuId, slug: animeGenres.genreSlug })
      .from(animeGenres)
      .where(inArray(animeGenres.kitsuId, ids));
    for (const row of rows) {
      const set = result.get(row.kitsuId) ?? new Set<string>();
      set.add(row.slug);
      result.set(row.kitsuId, set);
    }
    return result;
  }

  private async prefs(userId: string, db: DbOrTx): Promise<{
    liked: Set<number>;
    disliked: Set<number>;
    playCount: Map<number, number>;
    lastPlayed: Map<number, number>;
  }> {
    const rows = await db
      .select({
        themeId: themePrefs.themeId,
        liked: themePrefs.liked,
        disliked: themePrefs.disliked,
        playCount: themePrefs.playCount,
        lastPlayedAt: themePrefs.lastPlayedAt,
      })
      .from(themePrefs)
      .where(eq(themePrefs.userId, userId));
    const liked = new Set<number>();
    const disliked = new Set<number>();
    const playCount = new Map<number, number>();
    const lastPlayed = new Map<number, number>();
    for (const row of rows) {
      if (row.liked) liked.add(row.themeId);
      if (row.disliked) disliked.add(row.themeId);
      if (row.playCount > 0) playCount.set(row.themeId, row.playCount);
      if (row.lastPlayedAt) lastPlayed.set(row.themeId, row.lastPlayedAt.getTime());
    }
    return { liked, disliked, playCount, lastPlayed };
  }

  private async saveEntries(playlistId: number, themeIds: number[], db: DbOrTx): Promise<void> {
    const existing = await db
      .select({ itemType: playlistEntries.itemType, itemId: playlistEntries.itemId, modeOverride: playlistEntries.modeOverride })
      .from(playlistEntries)
      .where(eq(playlistEntries.playlistId, playlistId))
      .orderBy(asc(playlistEntries.orderIndex));
    const unchanged = existing.length === themeIds.length && existing.every((item, index) =>
      item.itemType === "THEME" && item.itemId === themeIds[index] && item.modeOverride === null);
    if (!unchanged) {
      await db.delete(playlistEntries).where(eq(playlistEntries.playlistId, playlistId));
    }
    if (!unchanged && themeIds.length > 0) {
      await db.insert(playlistEntries).values(
        themeIds.map((themeId, orderIndex) => ({
          playlistId,
          itemType: "THEME" as const,
          itemId: themeId,
          orderIndex,
        })),
      );
    }
    if (!unchanged) {
      await db
        .update(playlists)
        .set({ updatedAt: this.now() })
        .where(eq(playlists.id, playlistId));
    }
  }
}

export function dynamicPlaylistPayload(
  dynamicSpecJson: string | null,
  dynamicSortJson: string | null,
): { filter: unknown | null; sort: unknown | null } {
  const spec = parseJson(dynamicSpecJson);
  const sort = parseJson(dynamicSortJson);
  if (!isJson(spec)) return { filter: spec, sort };
  const envelopeFilter = spec.filterJson;
  if (envelopeFilter !== undefined) {
    return {
      filter: parseMaybeJson(envelopeFilter),
      sort: sort ?? parseMaybeJson(spec.sortJson),
    };
  }
  return { filter: spec, sort };
}

function parseJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseMaybeJson(value: unknown): unknown | null {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isJson(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
