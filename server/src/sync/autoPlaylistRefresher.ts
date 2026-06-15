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
      await this.libraryThemeIds(userId, "current"),
    );
    await this.saveAutoPlaylist(userId, "LIKED_SONGS", await this.likedThemeIds(userId));
  }

  private async libraryThemeIds(userId: string, status?: string): Promise<number[]> {
    const conditions = [
      eq(libraryEntries.userId, userId),
      isNull(libraryEntries.deletedAt),
      isNull(themes.deletedAt),
      isNotNull(kitsuAnime.animethemesAnimeId),
    ];
    if (status !== undefined) conditions.push(eq(libraryEntries.watchingStatus, status));

    const rows = await this.db
      .select({ themeId: themes.id })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(libraryEntries.kitsuId, kitsuAnime.kitsuId))
      .innerJoin(themes, eq(kitsuAnime.animethemesAnimeId, themes.animethemesAnimeId))
      .where(and(...conditions))
      .orderBy(asc(themes.id));
    return uniqueNumbers(rows.map((row) => row.themeId));
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
    const existing = await this.db
      .select({ id: playlists.id })
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
            gradientSeed: gradientSeed(spec.kind),
            deletedAt: null,
          })
          .returning({ id: playlists.id })
      )[0]!.id;

    await this.db
      .update(playlists)
      .set({
        isAuto: true,
        autoKind: spec.kind,
        gradientSeed: gradientSeed(spec.kind),
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(playlists.id, playlistId));

    await this.db.delete(playlistEntries).where(eq(playlistEntries.playlistId, playlistId));
    const entries = uniqueNumbers(themeIds).map((themeId, index) => ({
      playlistId,
      themeId,
      orderIndex: index,
    }));
    if (entries.length > 0) {
      await this.db.insert(playlistEntries).values(entries);
    }
  }
}

function uniqueNumbers(items: number[]): number[] {
  return [...new Set(items.filter((item) => Number.isInteger(item) && item > 0))];
}

function gradientSeed(kind: AutoPlaylistKind): number {
  if (kind === "KITSU_LIBRARY") return 11;
  if (kind === "CURRENTLY_WATCHING") return 23;
  return 37;
}
