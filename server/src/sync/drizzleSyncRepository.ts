import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
} from "drizzle-orm";
import type { AnimeThemeEntry, AnimeThemesArtistCredit } from "../animethemes/types.js";
import type { Db } from "../db/client.js";
import {
  animeGenres,
  animethemesAnime,
  artists,
  genres,
  kitsuAnime,
  libraryEntries,
  mediaFiles,
  playlistEntries,
  playlists,
  themeArtists,
  themePrefs,
  themes,
  users,
} from "../db/schema.js";
import type { KitsuAnimeEntry, KitsuGenre } from "../kitsu/types.js";
import type { KitsuCatalogRecord, SyncRepository, SyncUserAuth } from "./types.js";

type AutoPlaylistKind = "KITSU_LIBRARY" | "CURRENTLY_WATCHING" | "LIKED_SONGS";

const AUTO_PLAYLISTS: Array<{ kind: AutoPlaylistKind; name: string }> = [
  { kind: "KITSU_LIBRARY", name: "Kitsu Library" },
  { kind: "CURRENTLY_WATCHING", name: "Currently Watching" },
  { kind: "LIKED_SONGS", name: "Liked Songs" },
];

export class DrizzleSyncRepository implements SyncRepository {
  constructor(private readonly db: Db) {}

  async getUserSyncAuth(userId: string): Promise<SyncUserAuth | null> {
    const rows = await this.db
      .select({
        userId: users.kitsuUserId,
        accessToken: users.kitsuAccessToken,
        kitsuAuthState: users.kitsuAuthState,
        lastSyncAt: users.lastSyncAt,
        lastStatusSyncAt: users.lastStatusSyncAt,
      })
      .from(users)
      .where(eq(users.kitsuUserId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertKitsuAnime(entries: KitsuAnimeEntry[]): Promise<void> {
    const now = new Date();
    for (const entry of uniqueBy(entries, (item) => item.id)) {
      await this.db
        .insert(kitsuAnime)
        .values({
          kitsuId: entry.id,
          title: entry.title,
          titleEn: entry.titleEn,
          titleRomaji: entry.titleRomaji,
          titleJa: entry.titleJa,
          posterUrl: entry.posterUrl,
          posterUrlLarge: entry.posterUrlLarge,
          coverUrl: entry.coverUrl,
          coverUrlLarge: entry.coverUrlLarge,
          subtype: entry.subtype,
          startDate: entry.startDate,
          endDate: entry.endDate,
          episodeCount: entry.episodeCount,
          ageRating: entry.ageRating,
          averageRating: entry.averageRating,
          slug: entry.slug,
          updatedAt: now,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: kitsuAnime.kitsuId,
          set: {
            title: entry.title,
            titleEn: entry.titleEn,
            titleRomaji: entry.titleRomaji,
            titleJa: entry.titleJa,
            posterUrl: entry.posterUrl,
            posterUrlLarge: entry.posterUrlLarge,
            coverUrl: entry.coverUrl,
            coverUrlLarge: entry.coverUrlLarge,
            subtype: entry.subtype,
            startDate: entry.startDate,
            endDate: entry.endDate,
            episodeCount: entry.episodeCount,
            ageRating: entry.ageRating,
            averageRating: entry.averageRating,
            slug: entry.slug,
            updatedAt: now,
            deletedAt: null,
          },
        });
    }
  }

  async upsertLibraryEntries(userId: string, entries: KitsuAnimeEntry[]): Promise<void> {
    const now = new Date();
    for (const entry of uniqueBy(entries, (item) => item.id)) {
      await this.db
        .insert(libraryEntries)
        .values({
          userId,
          kitsuId: entry.id,
          watchingStatus: entry.watchingStatus,
          userRating: entry.userRating,
          libraryUpdatedAt: parseDateTime(entry.libraryUpdatedAt),
          isManuallyAdded: false,
          updatedAt: now,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: [libraryEntries.userId, libraryEntries.kitsuId],
          set: {
            watchingStatus: entry.watchingStatus,
            userRating: entry.userRating,
            libraryUpdatedAt: parseDateTime(entry.libraryUpdatedAt),
            updatedAt: now,
            deletedAt: null,
          },
        });
    }
  }

  async tombstoneMissingLibraryEntries(userId: string, activeKitsuIds: string[]): Promise<void> {
    const active = uniqueStrings(activeKitsuIds);
    const conditions = [
      eq(libraryEntries.userId, userId),
      eq(libraryEntries.isManuallyAdded, false),
      isNull(libraryEntries.deletedAt),
    ];
    if (active.length > 0) {
      conditions.push(notInArray(libraryEntries.kitsuId, active));
    }

    await this.db
      .update(libraryEntries)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions));
  }

  async upsertAnimeGenres(kitsuId: string, inputGenres: KitsuGenre[]): Promise<void> {
    const cleanGenres = uniqueBy(
      inputGenres.filter((genre) => genre.slug.length > 0 && genre.displayName.length > 0),
      (genre) => genre.slug,
    );
    if (cleanGenres.length === 0) return;

    for (const genre of cleanGenres) {
      await this.db
        .insert(genres)
        .values({
          slug: genre.slug,
          displayName: genre.displayName,
          source: genre.source,
        })
        .onConflictDoUpdate({
          target: genres.slug,
          set: {
            displayName: genre.displayName,
            source: genre.source,
          },
        });
    }

    await this.db.delete(animeGenres).where(eq(animeGenres.kitsuId, kitsuId));
    await this.db.insert(animeGenres).values(
      cleanGenres.map((genre) => ({
        kitsuId,
        genreSlug: genre.slug,
      })),
    );
  }

  async updateUserSyncTimestamps(
    userId: string,
    timestamps: { lastSyncAt?: Date; lastStatusSyncAt?: Date },
  ): Promise<void> {
    await this.db
      .update(users)
      .set({
        ...("lastSyncAt" in timestamps ? { lastSyncAt: timestamps.lastSyncAt } : {}),
        ...("lastStatusSyncAt" in timestamps
          ? { lastStatusSyncAt: timestamps.lastStatusSyncAt }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.kitsuUserId, userId));
  }

  async refreshAutoPlaylists(userId: string): Promise<void> {
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

  async getKitsuAnimeForMapping(kitsuIds: string[]): Promise<KitsuCatalogRecord[]> {
    const ids = uniqueStrings(kitsuIds);
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        kitsuId: kitsuAnime.kitsuId,
        title: kitsuAnime.title,
        titleEn: kitsuAnime.titleEn,
        titleRomaji: kitsuAnime.titleRomaji,
        titleJa: kitsuAnime.titleJa,
        animethemesAnimeId: kitsuAnime.animethemesAnimeId,
        mappingState: kitsuAnime.mappingState,
      })
      .from(kitsuAnime)
      .where(and(inArray(kitsuAnime.kitsuId, ids), isNull(kitsuAnime.deletedAt)));
    return rows.map((row) => ({ ...row, abbreviatedTitles: [] }));
  }

  async saveAnimeThemesCatalog(inputThemes: AnimeThemeEntry[]): Promise<void> {
    const cleanThemes = uniqueBy(
      inputThemes.filter(
        (theme) =>
          Number.isInteger(theme.animeId) &&
          theme.animeId > 0 &&
          Number.isInteger(theme.themeId) &&
          theme.themeId > 0 &&
          theme.audioUrl.length > 0,
      ),
      (theme) => theme.themeId,
    );
    if (cleanThemes.length === 0) return;

    const animeRows = uniqueBy(cleanThemes, (theme) => theme.animeId);
    for (const anime of animeRows) {
      await this.db
        .insert(animethemesAnime)
        .values({
          id: anime.animeId,
          name: anime.animeName,
          nameEn: anime.animeNameEn,
          coverUrl: anime.coverUrl,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: animethemesAnime.id,
          set: {
            name: anime.animeName,
            nameEn: anime.animeNameEn,
            coverUrl: anime.coverUrl,
            syncedAt: new Date(),
          },
        });
    }

    for (const theme of cleanThemes) {
      await this.db
        .insert(themes)
        .values({
          id: theme.themeId,
          animethemesAnimeId: theme.animeId,
          title: theme.title,
          themeType: theme.themeType,
          audioOriginUrl: theme.audioUrl,
          videoOriginUrl: theme.videoUrl,
          durationSeconds: null,
          updatedAt: new Date(),
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: themes.id,
          set: {
            animethemesAnimeId: theme.animeId,
            title: theme.title,
            themeType: theme.themeType,
            audioOriginUrl: theme.audioUrl,
            videoOriginUrl: theme.videoUrl,
            updatedAt: new Date(),
            deletedAt: null,
          },
        });
    }

    const themeIds = cleanThemes.map((theme) => theme.themeId);
    await this.db.delete(themeArtists).where(inArray(themeArtists.themeId, themeIds));

    const artistRows = uniqueBy(
      cleanThemes.flatMap((theme) => artistCreditsFor(theme)),
      (credit) => `${credit.themeId}:${credit.artistName}`,
    );
    if (artistRows.length > 0) {
      await this.db.insert(themeArtists).values(artistRows);
    }

    const globalArtists = uniqueBy(
      artistRows.map((credit) => ({ slug: slugify(credit.artistName), name: credit.artistName })),
      (artist) => artist.slug,
    ).filter((artist) => artist.slug.length > 0);
    for (const artist of globalArtists) {
      await this.db
        .insert(artists)
        .values({ ...artist, imageUrl: null })
        .onConflictDoUpdate({
          target: artists.slug,
          set: { name: artist.name },
        });
    }
  }

  async setAnimeThemeMappings(mappings: Map<string, number>): Promise<void> {
    for (const [kitsuId, animeThemesId] of mappings) {
      await this.db
        .update(kitsuAnime)
        .set({
          animethemesAnimeId: animeThemesId,
          mappingState: "MAPPED",
          updatedAt: new Date(),
          deletedAt: null,
        })
        .where(eq(kitsuAnime.kitsuId, kitsuId));
    }
  }

  async markAnimeUnmatched(kitsuIds: string[]): Promise<void> {
    const ids = uniqueStrings(kitsuIds);
    if (ids.length === 0) return;
    await this.db
      .update(kitsuAnime)
      .set({ mappingState: "UNMATCHED", updatedAt: new Date() })
      .where(inArray(kitsuAnime.kitsuId, ids));
  }

  async getThemeIdsMissingReadyAudio(userId?: string): Promise<number[]> {
    const themeIds = await this.libraryThemeIds(userId);
    if (themeIds.length === 0) return [];

    const readyRows = await this.db
      .select({ refId: mediaFiles.refId })
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.kind, "AUDIO"),
          eq(mediaFiles.state, "READY"),
          inArray(mediaFiles.refId, themeIds.map(String)),
        ),
      );
    const ready = new Set(readyRows.map((row) => row.refId));
    return themeIds.filter((themeId) => !ready.has(String(themeId)));
  }

  async getFailedAudioThemeIds(): Promise<number[]> {
    const rows = await this.db
      .select({ refId: mediaFiles.refId })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.kind, "AUDIO"), eq(mediaFiles.state, "FAILED")));
    return rows
      .map((row) => Number(row.refId))
      .filter((id) => Number.isInteger(id) && id > 0);
  }

  async markAudioMediaMissing(themeIds: string[]): Promise<void> {
    const ids = uniqueStrings(themeIds);
    if (ids.length === 0) return;
    await this.db
      .update(mediaFiles)
      .set({
        state: "MISSING",
        filePath: null,
        byteSize: null,
        sha256: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(eq(mediaFiles.kind, "AUDIO"), inArray(mediaFiles.refId, ids)));
  }

  async listReadyMediaFilePaths(): Promise<string[]> {
    const rows = await this.db
      .select({ filePath: mediaFiles.filePath })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.state, "READY"), isNotNull(mediaFiles.filePath)));
    return rows
      .map((row) => row.filePath)
      .filter((filePath): filePath is string => filePath !== null);
  }

  async listActiveUserIds(): Promise<string[]> {
    const rows = await this.db
      .select({ userId: users.kitsuUserId })
      .from(users)
      .where(and(eq(users.kitsuAuthState, "OK"), isNotNull(users.kitsuAccessToken)))
      .orderBy(asc(users.kitsuUserId));
    return rows.map((row) => row.userId);
  }

  private async libraryThemeIds(userId?: string, status?: string): Promise<number[]> {
    const conditions = [
      isNull(libraryEntries.deletedAt),
      isNull(themes.deletedAt),
      isNotNull(kitsuAnime.animethemesAnimeId),
    ];
    if (userId !== undefined) conditions.push(eq(libraryEntries.userId, userId));
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

function parseDateTime(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string | number): T[] {
  return [...new Map(items.map((item) => [keyOf(item), item])).values()];
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function uniqueNumbers(items: number[]): number[] {
  return [...new Set(items.filter((item) => Number.isInteger(item) && item > 0))];
}

function artistCreditsFor(theme: AnimeThemeEntry): Array<{
  themeId: number;
  artistName: string;
  asCharacter: string | null;
  alias: string | null;
}> {
  const credits: AnimeThemesArtistCredit[] =
    theme.artists.length > 0
      ? theme.artists
      : theme.artistName
        ? [{ name: theme.artistName, asCharacter: null, alias: null }]
        : [];
  return credits
    .filter((credit) => credit.name.trim().length > 0)
    .map((credit) => ({
      themeId: theme.themeId,
      artistName: credit.name.trim(),
      asCharacter: credit.asCharacter,
      alias: credit.alias,
    }));
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function gradientSeed(kind: AutoPlaylistKind): number {
  if (kind === "KITSU_LIBRARY") return 11;
  if (kind === "CURRENTLY_WATCHING") return 23;
  return 37;
}
