import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  kitsuAnime,
  libraryEntries,
  playlistEntries,
  playlists,
  themePrefs,
  themes,
} from "../db/schema.js";

type AutoPlaylistKind = "KITSU_LIBRARY" | "CURRENTLY_WATCHING" | "LIKED_SONGS";

const AUTO_PLAYLISTS: Array<{ kind: AutoPlaylistKind; name: string }> = [
  { kind: "KITSU_LIBRARY", name: "Kitsu Library" },
  { kind: "CURRENTLY_WATCHING", name: "Currently Watching" },
  { kind: "LIKED_SONGS", name: "Liked Songs" },
];

export class DrizzleAutoPlaylistRefresher {
  constructor(private readonly db: Db) {}

  async refresh(userId: string): Promise<void> {
    await this.saveAutoPlaylist(
      userId,
      "KITSU_LIBRARY",
      await this.libraryThemeIds(userId),
    );
    await this.saveAutoPlaylist(
      userId,
      "CURRENTLY_WATCHING",
      await this.currentlyWatchingThemeIds(userId),
    );
    await this.saveAutoPlaylist(userId, "LIKED_SONGS", await this.likedThemeIds(userId));
  }

  private async libraryThemeIds(userId: string): Promise<number[]> {
    const conditions = [
      eq(libraryEntries.userId, userId),
      isNull(libraryEntries.deletedAt),
      isNull(themes.deletedAt),
      isNotNull(kitsuAnime.animethemesAnimeId),
    ];
    const rows = await this.db
      .select({ themeId: themes.id })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(libraryEntries.kitsuId, kitsuAnime.kitsuId))
      .innerJoin(themes, eq(kitsuAnime.animethemesAnimeId, themes.animethemesAnimeId))
      .where(and(...conditions))
      .orderBy(asc(themes.id));
    return uniqueNumbers(rows.map((row) => row.themeId));
  }

  private async currentlyWatchingThemeIds(userId: string): Promise<number[]> {
    const rows = await this.db
      .select({
        themeId: themes.id,
        animeThemesId: kitsuAnime.animethemesAnimeId,
        libraryUpdatedAt: libraryEntries.libraryUpdatedAt,
        themeType: themes.themeType,
      })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(libraryEntries.kitsuId, kitsuAnime.kitsuId))
      .innerJoin(themes, eq(kitsuAnime.animethemesAnimeId, themes.animethemesAnimeId))
      .where(and(
        eq(libraryEntries.userId, userId),
        eq(libraryEntries.watchingStatus, "current"),
        isNull(libraryEntries.deletedAt),
        isNull(themes.deletedAt),
        isNotNull(kitsuAnime.animethemesAnimeId),
      ))
      .orderBy(asc(themes.id));
    return currentlyWatchingThemeIds(rows.map((row) => ({
      themeId: row.themeId,
      animeThemesId: row.animeThemesId!,
      libraryUpdatedAt: row.libraryUpdatedAt?.getTime() ?? null,
      themeType: row.themeType,
    })));
  }

  private async likedThemeIds(userId: string): Promise<number[]> {
    const rows = await this.db
      .select({ themeId: themePrefs.themeId })
      .from(themePrefs)
      .innerJoin(themes, eq(themePrefs.themeId, themes.id))
      .where(
        and(
          eq(themePrefs.userId, userId),
          eq(themePrefs.liked, true),
          isNull(themes.deletedAt),
        ),
      )
      .orderBy(asc(themePrefs.themeId));
    return uniqueNumbers(rows.map((row) => row.themeId));
  }

  private async saveAutoPlaylist(
    userId: string,
    kind: AutoPlaylistKind,
    themeIds: number[],
  ): Promise<void> {
    const spec = AUTO_PLAYLISTS.find((playlist) => playlist.kind === kind)!;
    const gradient = gradientSeed(spec.kind);
    const nextThemeIds = uniqueNumbers(themeIds);
    const existing = await this.db
      .select({
        id: playlists.id,
        isAuto: playlists.isAuto,
        autoKind: playlists.autoKind,
        gradientSeed: playlists.gradientSeed,
        defaultMode: playlists.defaultMode,
        deletedAt: playlists.deletedAt,
      })
      .from(playlists)
      .where(and(eq(playlists.userId, userId), eq(playlists.name, spec.name)))
      .limit(1);

    const playlistId =
      existing[0]?.id ??
      (
        await this.db
          .insert(playlists)
          .values({
            userId,
            name: spec.name,
            isAuto: true,
            autoKind: spec.kind,
            gradientSeed: gradient,
            deletedAt: null,
          })
          .returning({ id: playlists.id })
      )[0]!.id;

    const existingRow = existing[0] ?? null;
    const existingEntries = existingRow ? await this.autoPlaylistEntries(playlistId) : [];
    const existingThemeIds = existingEntries.flatMap((entry) => entry.itemType === "THEME" ? [entry.itemId] : []);
    const metadataChanged =
      existingRow === null ||
      !existingRow.isAuto ||
      existingRow.autoKind !== spec.kind ||
      existingRow.gradientSeed !== gradient ||
      existingRow.defaultMode !== "TV_SIZE" ||
      existingRow.deletedAt !== null;
    const entriesChanged = existingEntries.some((entry) => entry.itemType !== "THEME" || entry.modeOverride !== null)
      || !orderedThemeIdsMatch(existingThemeIds, nextThemeIds);
    if (!metadataChanged && !entriesChanged) {
      return;
    }

    await this.db
      .update(playlists)
      .set({
        isAuto: true,
        autoKind: spec.kind,
        gradientSeed: gradient,
        defaultMode: "TV_SIZE",
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(playlists.id, playlistId));

    if (entriesChanged) {
      await this.db.delete(playlistEntries).where(eq(playlistEntries.playlistId, playlistId));
      const entries = nextThemeIds.map((themeId, index) => ({
        playlistId,
        itemType: "THEME" as const,
        itemId: themeId,
        orderIndex: index,
      }));
      if (entries.length > 0) {
        await this.db.insert(playlistEntries).values(entries);
      }
    }
  }

  private async autoPlaylistEntries(playlistId: number) {
    const rows = await this.db
      .select({ itemType: playlistEntries.itemType, itemId: playlistEntries.itemId, modeOverride: playlistEntries.modeOverride })
      .from(playlistEntries)
      .where(eq(playlistEntries.playlistId, playlistId))
      .orderBy(asc(playlistEntries.orderIndex));
    return rows;
  }
}

function uniqueNumbers(items: number[]): number[] {
  return [...new Set(items.filter((item) => Number.isInteger(item) && item > 0))];
}

export function orderedThemeIdsMatch(current: number[], next: number[]): boolean {
  if (current.length !== next.length) return false;
  return current.every((themeId, index) => themeId === next[index]);
}

export interface CurrentlyWatchingThemeRow {
  themeId: number;
  animeThemesId: number;
  libraryUpdatedAt: number | null;
  themeType: string | null;
}

/** The persisted Current Watching order: newest anime first, then OPs, EDs, and remaining themes. */
export function currentlyWatchingThemeIds(rows: CurrentlyWatchingThemeRow[]): number[] {
  return uniqueNumbers(
    [...rows]
      .filter((row) => Number.isInteger(row.animeThemesId) && row.animeThemesId > 0)
      .sort(compareCurrentlyWatchingThemes)
      .map((row) => row.themeId),
  );
}

function compareCurrentlyWatchingThemes(a: CurrentlyWatchingThemeRow, b: CurrentlyWatchingThemeRow): number {
  const updateCmp = compareNullableDescending(a.libraryUpdatedAt, b.libraryUpdatedAt);
  if (updateCmp !== 0) return updateCmp;
  if (a.animeThemesId !== b.animeThemesId) return a.animeThemesId - b.animeThemesId;

  const themeCmp = compareGroupedNaturalThemeType(a.themeType, b.themeType);
  if (themeCmp !== 0) return themeCmp;
  return a.themeId - b.themeId;
}

function compareNullableDescending(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function compareGroupedNaturalThemeType(a: string | null, b: string | null): number {
  const aParts = naturalThemeTypeParts(a);
  const bParts = naturalThemeTypeParts(b);
  if (aParts.group !== bParts.group) return aParts.group - bParts.group;
  if (aParts.sequence !== bParts.sequence) return aParts.sequence - bParts.sequence;
  return compareCaseInsensitive(aParts.normalized, bParts.normalized);
}

function naturalThemeTypeParts(themeType: string | null): {
  group: number;
  sequence: number;
  normalized: string;
} {
  const normalized = themeType?.toUpperCase() ?? "";
  const group = normalized.startsWith("OP") ? 0 : normalized.startsWith("ED") ? 1 : 2;
  const digits = normalized.replace(/\D/g, "");
  return {
    group,
    sequence: digits.length > 0 ? Number.parseInt(digits, 10) : Number.MAX_SAFE_INTEGER,
    normalized,
  };
}

function compareCaseInsensitive(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function gradientSeed(kind: AutoPlaylistKind): number {
  if (kind === "KITSU_LIBRARY") return 11;
  if (kind === "CURRENTLY_WATCHING") return 23;
  return 37;
}
