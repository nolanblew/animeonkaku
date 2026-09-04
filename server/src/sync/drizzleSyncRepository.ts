import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm";
import type { AnimeThemeEntry, AnimeThemesArtistCredit } from "../animethemes/types.js";
import type { Db } from "../db/client.js";
import {
  animeGenres,
  animethemesAnime,
  artists,
  deviceSessions,
  genres,
  kitsuAnime,
  libraryEntries,
  mediaFiles,
  songs,
  themeArtists,
  themeVideoSources,
  themes,
  users,
} from "../db/schema.js";
import type { KitsuAnimeEntry, KitsuGenre } from "../kitsu/types.js";
import { CANONICAL_AUDIO, IMAGE_VARIANT } from "../media/types.js";
import { DrizzleDynamicPlaylistEvaluator } from "../playlists/dynamicPlaylistEvaluator.js";
import { DrizzleAutoPlaylistRefresher } from "./autoPlaylistRefresher.js";
import type { KitsuCatalogRecord, SyncRepository, SyncUserAuth } from "./types.js";

export class DrizzleSyncRepository implements SyncRepository {
  private readonly autoPlaylistRefresher: DrizzleAutoPlaylistRefresher;
  private readonly dynamicPlaylistEvaluator: DrizzleDynamicPlaylistEvaluator;

  constructor(private readonly db: Db) {
    this.autoPlaylistRefresher = new DrizzleAutoPlaylistRefresher(db);
    this.dynamicPlaylistEvaluator = new DrizzleDynamicPlaylistEvaluator(db);
  }

  async getUserSyncAuth(userId: string): Promise<SyncUserAuth | null> {
    const rows = await this.db
      .select({
        userId: users.kitsuUserId,
        accessToken: users.kitsuAccessToken,
        refreshToken: users.kitsuRefreshToken,
        tokenExpiresAt: users.kitsuTokenExpiresAt,
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
          watchedAt: parseDateTime(entry.watchedAt ?? null),
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
            watchedAt: parseDateTime(entry.watchedAt ?? null),
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

  async updateKitsuTokens(
    userId: string,
    tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date | null },
  ): Promise<void> {
    await this.db
      .update(users)
      .set({
        kitsuAccessToken: tokens.accessToken,
        kitsuRefreshToken: tokens.refreshToken,
        kitsuTokenExpiresAt: tokens.expiresAt,
        kitsuAuthState: "OK",
        updatedAt: new Date(),
      })
      .where(eq(users.kitsuUserId, userId));
  }

  async markKitsuReauthRequired(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        kitsuAuthState: "REAUTH_REQUIRED",
        updatedAt: new Date(),
      })
      .where(eq(users.kitsuUserId, userId));
  }

  async refreshAutoPlaylists(userId: string): Promise<void> {
    await this.autoPlaylistRefresher.refresh(userId);
    await this.dynamicPlaylistEvaluator.refresh(userId);
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
          slug: anime.animeSlug,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: animethemesAnime.id,
          set: {
            name: anime.animeName,
            nameEn: anime.animeNameEn,
            coverUrl: anime.coverUrl,
            slug: anime.animeSlug,
            syncedAt: new Date(),
          },
        });
    }

    for (const theme of cleanThemes) {
      await this.db
        .insert(themes)
        .values({
          id: theme.themeId,
          animethemesSongId: theme.animeThemesSongId,
          animethemesAnimeId: theme.animeId,
          title: theme.title,
          themeType: theme.themeType,
          audioOriginUrl: theme.audioUrl,
          videoOriginUrl: legacyVideoOriginUrl(theme),
          durationSeconds: null,
          updatedAt: new Date(),
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: themes.id,
          set: {
            animethemesSongId: theme.animeThemesSongId,
            animethemesAnimeId: theme.animeId,
            title: theme.title,
            themeType: theme.themeType,
            audioOriginUrl: theme.audioUrl,
            videoOriginUrl: legacyVideoOriginUrl(theme),
            updatedAt: new Date(),
            deletedAt: null,
          },
        });
    }

    // AnimeThemes song IDs are global and may be reused by several themes.
    // Persist one canonical song row now so discovery can attach acquired full
    // audio without duplicating the recording later.
    for (const theme of uniqueBy(
      cleanThemes.filter((candidate) => candidate.animeThemesSongId !== null),
      (candidate) => candidate.animeThemesSongId!,
    )) {
      const artistCredit = theme.artistName?.trim() ?? "";
      const musicbrainzRecordingId = musicBrainzRecordingId(theme);
      const songUpdate = {
        title: theme.title,
        normalizedTitle: normalizeCatalogText(theme.title),
        artistCredit,
        normalizedArtist: normalizeCatalogText(artistCredit),
        updatedAt: new Date(),
        deletedAt: null,
        ...(musicbrainzRecordingId !== null ? { musicbrainzRecordingId } : {}),
      };
      await this.db
        .insert(songs)
        .values({
          animethemesSongId: theme.animeThemesSongId!,
          musicbrainzRecordingId,
          title: theme.title,
          normalizedTitle: normalizeCatalogText(theme.title),
          artistCredit,
          normalizedArtist: normalizeCatalogText(artistCredit),
          durationSeconds: null,
          updatedAt: new Date(),
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: songs.animethemesSongId,
          // Omitting the column when the latest AnimeThemes payload lacks the
          // resource preserves a recording ID learned by an earlier remap.
          set: songUpdate,
        });
    }

    // Video remains a remote AnimeThemes descriptor. Refresh every candidate
    // on normal remapping, remove candidates no longer returned upstream, and
    // never create media_files rows for these links.
    for (const theme of cleanThemes) {
      const candidateIds = theme.videoCandidates.map((candidate) => candidate.animeThemesVideoId);
      const staleCondition = candidateIds.length > 0
        ? and(
            eq(themeVideoSources.themeId, theme.themeId),
            notInArray(themeVideoSources.animethemesVideoId, candidateIds),
          )
        : eq(themeVideoSources.themeId, theme.themeId);
      await this.db.delete(themeVideoSources).where(staleCondition);

      for (const candidate of theme.videoCandidates) {
        const values = {
          animethemesVideoId: candidate.animeThemesVideoId,
          animethemesEntryId: candidate.animeThemesEntryId,
          themeId: theme.themeId,
          entryVersion: candidate.entryVersion,
          entryOrder: candidate.entryOrder,
          link: candidate.link,
          mimeType: candidate.mimeType,
          resolution: candidate.resolution,
          source: candidate.source,
          spoiler: candidate.spoiler,
          nsfw: candidate.nsfw,
          creditless: candidate.creditless,
          subbed: candidate.subbed,
          lyrics: candidate.lyrics,
          preferenceRank: candidate.preferenceRank,
          updatedAt: new Date(),
        };
        await this.db
          .insert(themeVideoSources)
          .values(values)
          .onConflictDoUpdate({
            target: themeVideoSources.animethemesVideoId,
            set: values,
          });
      }
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

  async saveOnlineAnimeCatalog(inputThemes: AnimeThemeEntry[]): Promise<void> {
    await this.saveAnimeThemesCatalog(inputThemes);
    const cleanThemes = uniqueBy(
      inputThemes.filter(
        (theme) =>
          Number.isInteger(theme.animeId) &&
          theme.animeId > 0 &&
          Number.isInteger(theme.themeId) &&
          theme.themeId > 0 &&
          theme.kitsuId !== null &&
          theme.kitsuId.trim().length > 0,
      ),
      (theme) => theme.kitsuId!,
    );
    if (cleanThemes.length === 0) return;

    const now = new Date();
    for (const theme of cleanThemes) {
      await this.db
        .insert(kitsuAnime)
        .values({
          kitsuId: theme.kitsuId!,
          animethemesAnimeId: theme.animeId,
          title: theme.animeName,
          titleEn: theme.animeNameEn,
          // Online-only anime have no Kitsu sync yet; fall back to the AnimeThemes
          // cover for both poster and cover so search/added results show artwork.
          posterUrl: theme.coverUrl,
          posterUrlLarge: theme.coverUrl,
          coverUrl: theme.coverUrl,
          coverUrlLarge: theme.coverUrl,
          mappingState: "MAPPED",
          updatedAt: now,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: kitsuAnime.kitsuId,
          set: {
            animethemesAnimeId: theme.animeId,
            title: theme.animeName ?? sql`${kitsuAnime.title}`,
            titleEn: theme.animeNameEn ?? sql`${kitsuAnime.titleEn}`,
            // Only fill artwork when missing — never clobber real Kitsu artwork
            // already synced for library anime.
            posterUrl: sql`COALESCE(${kitsuAnime.posterUrl}, ${theme.coverUrl ?? null})`,
            posterUrlLarge: sql`COALESCE(${kitsuAnime.posterUrlLarge}, ${theme.coverUrl ?? null})`,
            coverUrl: sql`COALESCE(${kitsuAnime.coverUrl}, ${theme.coverUrl ?? null})`,
            coverUrlLarge: sql`COALESCE(${kitsuAnime.coverUrlLarge}, ${theme.coverUrl ?? null})`,
            mappingState: "MAPPED",
            updatedAt: now,
            deletedAt: null,
          },
        });
    }
  }

  async upsertArtistImages(inputArtists: Array<{ slug: string; name: string; imageUrl: string | null }>): Promise<void> {
    const cleanArtists = uniqueBy(
      inputArtists
        .map((artist) => ({
          slug: artist.slug.trim(),
          name: artist.name.trim(),
          imageUrl: artist.imageUrl?.trim() || null,
        }))
        .filter((artist) => artist.slug.length > 0 && artist.name.length > 0),
      (artist) => artist.slug,
    );
    for (const artist of cleanArtists) {
      await this.db
        .insert(artists)
        .values(artist)
        .onConflictDoUpdate({
          target: artists.slug,
          set: {
            name: artist.name,
            imageUrl: artist.imageUrl,
          },
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
          eq(mediaFiles.kind, CANONICAL_AUDIO.kind),
          eq(mediaFiles.variant, CANONICAL_AUDIO.variant),
          eq(mediaFiles.state, "READY"),
          inArray(mediaFiles.refId, themeIds.map(String)),
        ),
      );
    const ready = new Set(readyRows.map((row) => row.refId));
    return themeIds.filter((themeId) => !ready.has(String(themeId)));
  }

  async getAnimeImagesMissingReady(
    userId?: string,
  ): Promise<Array<{ kind: "ANIME_POSTER" | "ANIME_COVER"; refId: string }>> {
    const conditions = [isNull(libraryEntries.deletedAt), isNull(kitsuAnime.deletedAt)];
    if (userId !== undefined) conditions.push(eq(libraryEntries.userId, userId));
    const animeRows = await this.db
      .selectDistinct({
        kitsuId: kitsuAnime.kitsuId,
        posterUrl: kitsuAnime.posterUrl,
        coverUrl: kitsuAnime.coverUrl,
      })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(libraryEntries.kitsuId, kitsuAnime.kitsuId))
      .where(and(...conditions))
      .orderBy(asc(kitsuAnime.kitsuId));
    if (animeRows.length === 0) return [];

    const readyRows = await this.db
      .select({ kind: mediaFiles.kind, refId: mediaFiles.refId })
      .from(mediaFiles)
      .where(
        and(
          inArray(mediaFiles.kind, ["ANIME_POSTER", "ANIME_COVER"]),
          eq(mediaFiles.variant, IMAGE_VARIANT),
          eq(mediaFiles.state, "READY"),
          inArray(mediaFiles.refId, animeRows.map((row) => row.kitsuId)),
        ),
      );
    const ready = new Set(readyRows.map((row) => `${row.kind}:${row.refId}`));

    const missing: Array<{ kind: "ANIME_POSTER" | "ANIME_COVER"; refId: string }> = [];
    for (const row of animeRows) {
      if (row.posterUrl && !ready.has(`ANIME_POSTER:${row.kitsuId}`)) {
        missing.push({ kind: "ANIME_POSTER", refId: row.kitsuId });
      }
      if (row.coverUrl && !ready.has(`ANIME_COVER:${row.kitsuId}`)) {
        missing.push({ kind: "ANIME_COVER", refId: row.kitsuId });
      }
    }
    return missing;
  }

  async getFailedAudioThemeIds(): Promise<number[]> {
    const rows = await this.db
      .select({ refId: mediaFiles.refId })
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.kind, CANONICAL_AUDIO.kind),
          eq(mediaFiles.variant, CANONICAL_AUDIO.variant),
          eq(mediaFiles.state, "FAILED"),
        ),
      );
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
      .where(
        and(
          eq(mediaFiles.kind, CANONICAL_AUDIO.kind),
          eq(mediaFiles.variant, CANONICAL_AUDIO.variant),
          inArray(mediaFiles.refId, ids),
        ),
      );
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

  async listActiveUserIds(activeAfter?: Date): Promise<string[]> {
    const conditions = [eq(users.kitsuAuthState, "OK"), isNotNull(users.kitsuAccessToken)];
    if (activeAfter) conditions.push(gte(deviceSessions.lastUsedAt, activeAfter));
    const rows = await this.db
      .select({ userId: users.kitsuUserId })
      .from(users)
      .innerJoin(deviceSessions, eq(deviceSessions.userId, users.kitsuUserId))
      .where(and(...conditions))
      .orderBy(asc(users.kitsuUserId));
    return [...new Set(rows.map((row) => row.userId))];
  }

  async deactivateInactiveUsers(activeAfter: Date): Promise<string[]> {
    const candidates = await this.db
      .select({ userId: users.kitsuUserId })
      .from(users)
      .where(and(eq(users.kitsuAuthState, "OK"), isNotNull(users.kitsuAccessToken)));
    if (candidates.length === 0) return [];

    const recentSessions = await this.db
      .select({ userId: deviceSessions.userId })
      .from(deviceSessions)
      .where(gte(deviceSessions.lastUsedAt, activeAfter));
    const recentlyActive = new Set(recentSessions.map((row) => row.userId));
    const inactiveIds = candidates
      .map((row) => row.userId)
      .filter((userId) => !recentlyActive.has(userId));
    if (inactiveIds.length === 0) return [];

    await this.db
      .update(users)
      .set({
        kitsuAccessToken: null,
        kitsuRefreshToken: null,
        kitsuTokenExpiresAt: null,
        kitsuAuthState: "REAUTH_REQUIRED",
        updatedAt: new Date(),
      })
      .where(inArray(users.kitsuUserId, inactiveIds));
    await this.db.delete(deviceSessions).where(inArray(deviceSessions.userId, inactiveIds));
    return inactiveIds;
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

function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Preserve the legacy equality marker used by the audio fetcher for webm fallback. */
function legacyVideoOriginUrl(theme: AnimeThemeEntry): string | null {
  return theme.videoFallback ? theme.audioUrl : theme.videoUrl;
}

function musicBrainzRecordingId(theme: AnimeThemeEntry): string | null {
  return theme.songResources.find((resource) =>
    resource.site.trim().toLowerCase() === "musicbrainz",
  )?.externalId.trim() || null;
}
