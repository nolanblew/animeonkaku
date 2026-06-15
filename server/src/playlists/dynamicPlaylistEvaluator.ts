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

/**
 * Materializes user dynamic (smart) playlists server-side, mirroring the device's
 * FilterEvaluator so the same spec yields the same entries on every device. Only auto-update
 * dynamic playlists are recomputed; snapshot dynamic playlists keep whatever entries were last
 * written. The candidate theme set is the user's mapped library (same universe the device sees).
 *
 * Device-only dimensions (downloaded) evaluate as empty server-side — see plan 10.
 */
export class DrizzleDynamicPlaylistEvaluator {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async refresh(userId: string): Promise<void> {
    const dynamicRows = await this.db
      .select({
        id: playlists.id,
        dynamicSpecJson: playlists.dynamicSpecJson,
        dynamicSortJson: playlists.dynamicSortJson,
      })
      .from(playlists)
      .where(
        and(
          eq(playlists.userId, userId),
          eq(playlists.isAuto, false),
          eq(playlists.isDynamic, true),
          eq(playlists.dynamicAutoUpdate, true),
          isNull(playlists.deletedAt),
        ),
      );
    if (dynamicRows.length === 0) return;

    const ctx = await this.loadContext(userId);
    for (const row of dynamicRows) {
      const filter = parseJson(row.dynamicSpecJson);
      if (filter === null) continue;
      const sort = parseJson(row.dynamicSortJson);
      const themeIds = evaluate(filter, sort, ctx);
      await this.saveEntries(row.id, themeIds);
    }
  }

  private async loadContext(userId: string): Promise<EvalContext> {
    // Library anime the user owns and that is mapped to AnimeThemes.
    const libraryRows = await this.db
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
      ? await this.db
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
    const artistNameByTheme = await this.artistNames(themeIds);
    const evalThemes: EvalTheme[] = themeRows.map((row) => ({
      id: row.id,
      title: row.title,
      themeType: row.themeType,
      artistName: artistNameByTheme.get(row.id) ?? null,
      animeThemesId: row.animeThemesId,
    }));

    const genresByKitsuId = await this.genres(kitsuIds);
    const prefs = await this.prefs(userId);

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

  private async artistNames(themeIds: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string[]>();
    if (themeIds.length === 0) return new Map();
    const rows = await this.db
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

  private async genres(kitsuIds: string[]): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    const ids = [...new Set(kitsuIds)];
    if (ids.length === 0) return result;
    const rows = await this.db
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

  private async prefs(userId: string): Promise<{
    liked: Set<number>;
    disliked: Set<number>;
    playCount: Map<number, number>;
    lastPlayed: Map<number, number>;
  }> {
    const rows = await this.db
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

  private async saveEntries(playlistId: number, themeIds: number[]): Promise<void> {
    await this.db.delete(playlistEntries).where(eq(playlistEntries.playlistId, playlistId));
    if (themeIds.length > 0) {
      await this.db.insert(playlistEntries).values(
        themeIds.map((themeId, orderIndex) => ({ playlistId, themeId, orderIndex })),
      );
    }
    await this.db
      .update(playlists)
      .set({ updatedAt: this.now() })
      .where(eq(playlists.id, playlistId));
  }
}

function parseJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
