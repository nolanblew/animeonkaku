import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  animeGenres,
  genres,
  kitsuAnime,
  libraryEntries,
  mediaFiles,
  playlistEntries,
  playlists,
  themeArtists,
  themePrefs,
  themes,
} from "../db/schema.js";
import { JobPriority, type JobQueue } from "../jobs/index.js";
import { ApiError } from "./errors.js";
import type {
  AudioState,
  ClientApiService,
  LibraryAnimeDto,
  LibraryResponse,
  PlaylistCreateInput,
  LibraryThemeDto,
  PlaylistDto,
  PlaylistInput,
  ThemePrefDto,
  ThemePrefPatch,
} from "./clientRoutes.js";

export class DrizzleClientApiService implements ClientApiService {
  constructor(
    private readonly db: Db,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getLibrary(userId: string, since: number | null): Promise<LibraryResponse> {
    const sinceDate = millisToDate(since);
    const animeRows = await this.libraryAnimeRows(userId, sinceDate);
    const activeMappings = await this.activeLibraryMappings(userId);
    const animeIds = animeRows.map((row) => row.kitsuId);
    const genreMap = await this.genreMap(animeIds);

    const anime: LibraryAnimeDto[] = animeRows.map((row) => ({
      kitsuId: row.kitsuId,
      animeThemesId: row.animeThemesId,
      title: row.title,
      titleEn: row.titleEn,
      titleRomaji: row.titleRomaji,
      titleJa: row.titleJa,
      posterUrl: row.posterOriginUrl || row.posterLargeOriginUrl
        ? `/v1/media/images/anime/${row.kitsuId}/poster`
        : null,
      coverUrl: row.coverOriginUrl || row.coverLargeOriginUrl
        ? `/v1/media/images/anime/${row.kitsuId}/cover`
        : null,
      watchingStatus: row.watchingStatus,
      subtype: row.subtype,
      startDate: row.startDate,
      endDate: row.endDate,
      episodeCount: row.episodeCount,
      ageRating: row.ageRating,
      averageRating: row.averageRating,
      userRating: row.userRating,
      libraryUpdatedAt: dateMillis(row.libraryUpdatedAt),
      slug: row.slug,
      genres: genreMap.get(row.kitsuId) ?? [],
      updatedAt: Math.max(dateMillis(row.libraryEntryUpdatedAt) ?? 0, dateMillis(row.animeUpdatedAt) ?? 0),
      deleted: row.libraryDeletedAt !== null || row.animeDeletedAt !== null,
    }));

    return {
      serverTime: this.now().getTime(),
      anime,
      themes: await this.libraryThemes(activeMappings, animeRows, sinceDate),
    };
  }

  async getAnime(
    userId: string,
    kitsuId: string,
  ): Promise<{ anime: LibraryAnimeDto; themes: LibraryThemeDto[] } | null> {
    const library = await this.getLibrary(userId, null);
    const anime = library.anime.find((item) => item.kitsuId === kitsuId && !item.deleted);
    if (!anime) return null;
    return {
      anime,
      themes: library.themes.filter((theme) =>
        theme.kitsuAnimeIds.includes(kitsuId),
      ),
    };
  }

  async addLibraryAnime(
    userId: string,
    input: { kitsuId?: string; animeThemesId?: number },
  ): Promise<{ accepted: boolean; queuedJobIds: number[] }> {
    const kitsuId = input.kitsuId ?? (await this.kitsuIdForAnimeThemesId(input.animeThemesId));
    if (!kitsuId) {
      throw new ApiError(422, "UNPROCESSABLE", "No Kitsu anime id could be resolved.");
    }

    const now = this.now();
    await this.db
      .insert(kitsuAnime)
      .values({
        kitsuId,
        animethemesAnimeId: input.animeThemesId ?? null,
        mappingState: input.animeThemesId ? "MAPPED" : "UNMAPPED",
        updatedAt: now,
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: kitsuAnime.kitsuId,
        set: {
          animethemesAnimeId: input.animeThemesId ?? sql`coalesce(${kitsuAnime.animethemesAnimeId}, null)`,
          mappingState: input.animeThemesId ? "MAPPED" : sql`${kitsuAnime.mappingState}`,
          updatedAt: now,
          deletedAt: null,
        },
      });

    await this.db
      .insert(libraryEntries)
      .values({
        userId,
        kitsuId,
        isManuallyAdded: true,
        updatedAt: now,
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: [libraryEntries.userId, libraryEntries.kitsuId],
        set: {
          isManuallyAdded: true,
          updatedAt: now,
          deletedAt: null,
        },
      });

    const mapJob = await this.queue.enqueue({
      type: "MAP_THEMES",
      priority: JobPriority.HIGH,
      payload: { kitsuIds: [kitsuId], userId },
      dedupeKey: `MAP_THEMES:${userId}:${kitsuId}`,
    });
    const playlistJob = await this.queue.enqueue({
      type: "AUTO_PLAYLIST_REFRESH",
      priority: JobPriority.HIGH,
      payload: { userId },
      dedupeKey: `AUTO_PLAYLIST_REFRESH:${userId}`,
    });
    return { accepted: true, queuedJobIds: [mapJob.id, playlistJob.id] };
  }

  async removeLibraryAnime(userId: string, kitsuId: string): Promise<boolean> {
    const updated = await this.db
      .update(libraryEntries)
      .set({ deletedAt: this.now(), updatedAt: this.now() })
      .where(
        and(
          eq(libraryEntries.userId, userId),
          eq(libraryEntries.kitsuId, kitsuId),
          eq(libraryEntries.isManuallyAdded, true),
          isNull(libraryEntries.deletedAt),
        ),
      )
      .returning({ kitsuId: libraryEntries.kitsuId });
    if (updated.length === 0) return false;
    await this.queue.enqueue({
      type: "AUTO_PLAYLIST_REFRESH",
      priority: JobPriority.HIGH,
      payload: { userId },
      dedupeKey: `AUTO_PLAYLIST_REFRESH:${userId}`,
    });
    return true;
  }

  async getThemePrefs(userId: string): Promise<ThemePrefDto[]> {
    const rows = await this.db
      .select({
        themeId: themePrefs.themeId,
        liked: themePrefs.liked,
        disliked: themePrefs.disliked,
        playCount: themePrefs.playCount,
        lastPlayedAt: themePrefs.lastPlayedAt,
      })
      .from(themePrefs)
      .where(eq(themePrefs.userId, userId))
      .orderBy(asc(themePrefs.themeId));
    return rows.map((row) => ({
      themeId: row.themeId,
      liked: row.liked,
      disliked: row.disliked,
      playCount: row.playCount,
      lastPlayedAt: dateMillis(row.lastPlayedAt),
    }));
  }

  async updateThemePref(userId: string, themeId: number, patch: ThemePrefPatch): Promise<ThemePrefDto> {
    const now = this.now();
    const set = normalizedPrefPatch(patch, now);
    await this.db
      .insert(themePrefs)
      .values({
        userId,
        themeId,
        liked: set.liked ?? false,
        disliked: set.disliked ?? false,
        playCount: 0,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [themePrefs.userId, themePrefs.themeId],
        set,
      });
    const [pref] = await this.getThemePrefs(userId).then((prefs) =>
      prefs.filter((item) => item.themeId === themeId),
    );
    return pref!;
  }

  async recordPlays(
    userId: string,
    plays: Array<{ themeId: number; playedAt: number }>,
  ): Promise<{ accepted: number }> {
    const grouped = groupPlays(plays);
    const now = this.now();
    for (const play of grouped) {
      await this.db
        .insert(themePrefs)
        .values({
          userId,
          themeId: play.themeId,
          liked: false,
          disliked: false,
          playCount: play.count,
          lastPlayedAt: new Date(play.lastPlayedAt),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [themePrefs.userId, themePrefs.themeId],
          set: {
            playCount: sql`${themePrefs.playCount} + ${play.count}`,
            lastPlayedAt: sql`greatest(coalesce(${themePrefs.lastPlayedAt}, to_timestamp(0)), ${new Date(play.lastPlayedAt)})`,
            updatedAt: now,
          },
        });
    }
    return { accepted: plays.length };
  }

  async listPlaylists(userId: string, options: { autoOnly?: boolean } = {}): Promise<PlaylistDto[]> {
    const conditions = [eq(playlists.userId, userId), isNull(playlists.deletedAt)];
    if (options.autoOnly) conditions.push(eq(playlists.isAuto, true));
    const rows = await this.db
      .select({
        id: playlists.id,
        name: playlists.name,
        isAuto: playlists.isAuto,
        updatedAt: playlists.updatedAt,
        dynamicSpecJson: playlists.dynamicSpecJson,
      })
      .from(playlists)
      .where(and(...conditions))
      .orderBy(asc(playlists.isAuto), asc(playlists.name));
    const entries = await this.playlistEntryMap(rows.map((row) => row.id));
    return rows.map((row) => playlistDto(row, entries.get(row.id) ?? []));
  }

  async createPlaylist(
    userId: string,
    input: PlaylistCreateInput,
  ): Promise<PlaylistDto> {
    const now = this.now();
    const [row] = await this.db
      .insert(playlists)
      .values({
        userId,
        name: input.name,
        isAuto: false,
        dynamicSpecJson: stringifySpec(input.dynamicSpecJson),
        updatedAt: now,
      })
      .returning({ id: playlists.id });
    await this.replacePlaylistEntries(row!.id, input.entries ?? []);
    const playlist = await this.findPlaylist(userId, row!.id);
    return playlist!;
  }

  async updatePlaylist(userId: string, id: number, input: PlaylistInput): Promise<PlaylistDto | null> {
    const existing = await this.findMutablePlaylist(userId, id);
    if (!existing) return null;
    const set: Partial<typeof playlists.$inferInsert> = { updatedAt: this.now() };
    if (input.name !== undefined) set.name = input.name;
    if (input.dynamicSpecJson !== undefined) set.dynamicSpecJson = stringifySpec(input.dynamicSpecJson);
    await this.db.update(playlists).set(set).where(eq(playlists.id, id));
    if (input.entries !== undefined) {
      await this.replacePlaylistEntries(id, input.entries);
    }
    return this.findPlaylist(userId, id);
  }

  async updatePlaylistSpec(userId: string, id: number, spec: unknown): Promise<PlaylistDto | null> {
    return this.updatePlaylist(userId, id, { dynamicSpecJson: spec });
  }

  async deletePlaylist(userId: string, id: number): Promise<boolean> {
    const existing = await this.findMutablePlaylist(userId, id);
    if (!existing) return false;
    await this.db
      .update(playlists)
      .set({ deletedAt: this.now(), updatedAt: this.now() })
      .where(eq(playlists.id, id));
    return true;
  }

  private async libraryAnimeRows(userId: string, sinceDate: Date | null) {
    const conditions = [eq(libraryEntries.userId, userId)];
    if (sinceDate) {
      conditions.push(
        or(
          gt(libraryEntries.updatedAt, sinceDate),
          gt(kitsuAnime.updatedAt, sinceDate),
          gt(libraryEntries.deletedAt, sinceDate),
          gt(kitsuAnime.deletedAt, sinceDate),
        )!,
      );
    } else {
      conditions.push(isNull(libraryEntries.deletedAt), isNull(kitsuAnime.deletedAt));
    }

    return this.db
      .select({
        kitsuId: kitsuAnime.kitsuId,
        animeThemesId: kitsuAnime.animethemesAnimeId,
        title: kitsuAnime.title,
        titleEn: kitsuAnime.titleEn,
        titleRomaji: kitsuAnime.titleRomaji,
        titleJa: kitsuAnime.titleJa,
        posterOriginUrl: kitsuAnime.posterUrl,
        posterLargeOriginUrl: kitsuAnime.posterUrlLarge,
        coverOriginUrl: kitsuAnime.coverUrl,
        coverLargeOriginUrl: kitsuAnime.coverUrlLarge,
        subtype: kitsuAnime.subtype,
        startDate: kitsuAnime.startDate,
        endDate: kitsuAnime.endDate,
        episodeCount: kitsuAnime.episodeCount,
        ageRating: kitsuAnime.ageRating,
        averageRating: kitsuAnime.averageRating,
        slug: kitsuAnime.slug,
        animeUpdatedAt: kitsuAnime.updatedAt,
        animeDeletedAt: kitsuAnime.deletedAt,
        watchingStatus: libraryEntries.watchingStatus,
        userRating: libraryEntries.userRating,
        libraryUpdatedAt: libraryEntries.libraryUpdatedAt,
        libraryEntryUpdatedAt: libraryEntries.updatedAt,
        libraryDeletedAt: libraryEntries.deletedAt,
      })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(libraryEntries.kitsuId, kitsuAnime.kitsuId))
      .where(and(...conditions))
      .orderBy(asc(kitsuAnime.kitsuId));
  }

  private async activeLibraryMappings(userId: string): Promise<Array<{ kitsuId: string; animeThemesId: number }>> {
    const rows = await this.db
      .select({
        kitsuId: kitsuAnime.kitsuId,
        animeThemesId: kitsuAnime.animethemesAnimeId,
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
      );
    return rows.flatMap((row) =>
      row.animeThemesId === null ? [] : [{ kitsuId: row.kitsuId, animeThemesId: row.animeThemesId }],
    );
  }

  private async genreMap(kitsuIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const ids = unique(kitsuIds);
    if (ids.length === 0) return result;
    const rows = await this.db
      .select({
        kitsuId: animeGenres.kitsuId,
        displayName: genres.displayName,
      })
      .from(animeGenres)
      .innerJoin(genres, eq(animeGenres.genreSlug, genres.slug))
      .where(inArray(animeGenres.kitsuId, ids))
      .orderBy(asc(animeGenres.kitsuId), asc(genres.displayName));
    for (const row of rows) {
      const genresForAnime = result.get(row.kitsuId) ?? [];
      genresForAnime.push(row.displayName);
      result.set(row.kitsuId, genresForAnime);
    }
    return result;
  }

  private async libraryThemes(
    activeMappings: Array<{ kitsuId: string; animeThemesId: number }>,
    changedAnimeRows: Awaited<ReturnType<DrizzleClientApiService["libraryAnimeRows"]>>,
    sinceDate: Date | null,
  ): Promise<LibraryThemeDto[]> {
    const activeAnimeThemesIds = uniqueNumbers(activeMappings.map((row) => row.animeThemesId));
    if (activeAnimeThemesIds.length === 0) return [];

    const changedAnimeThemesIds = uniqueNumbers(
      changedAnimeRows.flatMap((row) => (row.animeThemesId === null ? [] : [row.animeThemesId])),
    );
    const conditions = [inArray(themes.animethemesAnimeId, activeAnimeThemesIds)];
    if (sinceDate) {
      const changedConditions = [gt(themes.updatedAt, sinceDate), gt(themes.deletedAt, sinceDate)];
      if (changedAnimeThemesIds.length > 0) {
        changedConditions.push(inArray(themes.animethemesAnimeId, changedAnimeThemesIds));
      }
      conditions.push(or(...changedConditions)!);
    } else {
      conditions.push(isNull(themes.deletedAt));
    }

    const rows = await this.db
      .select({
        id: themes.id,
        animeThemesAnimeId: themes.animethemesAnimeId,
        title: themes.title,
        themeType: themes.themeType,
        videoUrl: themes.videoOriginUrl,
        durationSeconds: themes.durationSeconds,
        updatedAt: themes.updatedAt,
        deletedAt: themes.deletedAt,
      })
      .from(themes)
      .where(and(...conditions))
      .orderBy(asc(themes.id));

    const themeIds = rows.map((row) => row.id);
    const artists = await this.themeArtistMap(themeIds);
    const media = await this.audioMediaMap(themeIds);
    const kitsuIdsByAnimeThemesId = activeMappings.reduce((map, row) => {
      const ids = map.get(row.animeThemesId) ?? [];
      ids.push(row.kitsuId);
      map.set(row.animeThemesId, ids);
      return map;
    }, new Map<number, string[]>());

    return rows.map((row) => {
      const audio = media.get(row.id);
      return {
        id: row.id,
        animeThemesAnimeId: row.animeThemesAnimeId,
        kitsuAnimeIds: kitsuIdsByAnimeThemesId.get(row.animeThemesAnimeId) ?? [],
        title: row.title,
        themeType: row.themeType,
        artists: artists.get(row.id) ?? [],
        audioUrl: `/v1/media/audio/${row.id}`,
        videoUrl: row.videoUrl,
        audioState: audioState(audio?.state ?? null),
        durationSeconds: row.durationSeconds,
        fileSize: audio?.byteSize ?? null,
        updatedAt: Math.max(dateMillis(row.updatedAt) ?? 0, dateMillis(row.deletedAt) ?? 0),
        deleted: row.deletedAt !== null,
      };
    });
  }

  private async themeArtistMap(themeIds: number[]) {
    const result = new Map<number, Array<{ name: string; asCharacter: string | null; alias: string | null }>>();
    if (themeIds.length === 0) return result;
    const rows = await this.db
      .select({
        themeId: themeArtists.themeId,
        name: themeArtists.artistName,
        asCharacter: themeArtists.asCharacter,
        alias: themeArtists.alias,
      })
      .from(themeArtists)
      .where(inArray(themeArtists.themeId, themeIds))
      .orderBy(asc(themeArtists.themeId), asc(themeArtists.artistName));
    for (const row of rows) {
      const credits = result.get(row.themeId) ?? [];
      credits.push({ name: row.name, asCharacter: row.asCharacter, alias: row.alias });
      result.set(row.themeId, credits);
    }
    return result;
  }

  private async audioMediaMap(themeIds: number[]) {
    if (themeIds.length === 0) return new Map<number, { state: string; byteSize: number | null }>();
    const rows = await this.db
      .select({
        refId: mediaFiles.refId,
        state: mediaFiles.state,
        byteSize: mediaFiles.byteSize,
      })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.kind, "AUDIO"), inArray(mediaFiles.refId, themeIds.map(String))));
    return new Map(
      rows
        .map((row) => [Number(row.refId), { state: row.state, byteSize: row.byteSize }] as const)
        .filter(([themeId]) => Number.isInteger(themeId)),
    );
  }

  private async playlistEntryMap(playlistIds: number[]): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    if (playlistIds.length === 0) return result;
    const rows = await this.db
      .select({
        playlistId: playlistEntries.playlistId,
        themeId: playlistEntries.themeId,
      })
      .from(playlistEntries)
      .where(inArray(playlistEntries.playlistId, playlistIds))
      .orderBy(asc(playlistEntries.playlistId), asc(playlistEntries.orderIndex));
    for (const row of rows) {
      const entries = result.get(row.playlistId) ?? [];
      entries.push(row.themeId);
      result.set(row.playlistId, entries);
    }
    return result;
  }

  private async replacePlaylistEntries(playlistId: number, entries: number[]): Promise<void> {
    await this.db.delete(playlistEntries).where(eq(playlistEntries.playlistId, playlistId));
    if (entries.length === 0) return;
    await this.db.insert(playlistEntries).values(
      entries.map((themeId, orderIndex) => ({
        playlistId,
        themeId,
        orderIndex,
      })),
    );
  }

  private async findMutablePlaylist(userId: string, id: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: playlists.id })
      .from(playlists)
      .where(
        and(
          eq(playlists.id, id),
          eq(playlists.userId, userId),
          eq(playlists.isAuto, false),
          isNull(playlists.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private async findPlaylist(userId: string, id: number): Promise<PlaylistDto | null> {
    const rows = await this.db
      .select({
        id: playlists.id,
        name: playlists.name,
        isAuto: playlists.isAuto,
        updatedAt: playlists.updatedAt,
        dynamicSpecJson: playlists.dynamicSpecJson,
      })
      .from(playlists)
      .where(and(eq(playlists.id, id), eq(playlists.userId, userId), isNull(playlists.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const entries = await this.playlistEntryMap([id]);
    return playlistDto(row, entries.get(id) ?? []);
  }

  private async kitsuIdForAnimeThemesId(animeThemesId: number | undefined): Promise<string | null> {
    if (animeThemesId === undefined) return null;
    const rows = await this.db
      .select({ kitsuId: kitsuAnime.kitsuId })
      .from(kitsuAnime)
      .where(and(eq(kitsuAnime.animethemesAnimeId, animeThemesId), isNull(kitsuAnime.deletedAt)))
      .orderBy(asc(kitsuAnime.kitsuId))
      .limit(1);
    return rows[0]?.kitsuId ?? null;
  }
}

function normalizedPrefPatch(patch: ThemePrefPatch, now: Date): Partial<typeof themePrefs.$inferInsert> {
  const set: Partial<typeof themePrefs.$inferInsert> = { updatedAt: now };
  if (patch.liked !== undefined) {
    set.liked = patch.liked;
    if (patch.liked) set.disliked = false;
  }
  if (patch.disliked !== undefined) {
    set.disliked = patch.disliked;
    if (patch.disliked) set.liked = false;
  }
  return set;
}

function groupPlays(plays: Array<{ themeId: number; playedAt: number }>) {
  const map = new Map<number, { themeId: number; count: number; lastPlayedAt: number }>();
  for (const play of plays) {
    const existing = map.get(play.themeId) ?? {
      themeId: play.themeId,
      count: 0,
      lastPlayedAt: play.playedAt,
    };
    existing.count += 1;
    existing.lastPlayedAt = Math.max(existing.lastPlayedAt, play.playedAt);
    map.set(play.themeId, existing);
  }
  return [...map.values()];
}

function playlistDto(
  row: { id: number; name: string; isAuto: boolean; updatedAt: Date; dynamicSpecJson: string | null },
  entries: number[],
): PlaylistDto {
  return {
    id: row.id,
    name: row.name,
    entries,
    isAuto: row.isAuto,
    updatedAt: row.updatedAt.getTime(),
    dynamicSpecJson: parseSpec(row.dynamicSpecJson),
  };
}

function stringifySpec(spec: unknown): string | null {
  return spec === undefined ? null : JSON.stringify(spec);
}

function parseSpec(spec: string | null): unknown | null {
  if (spec === null) return null;
  try {
    return JSON.parse(spec);
  } catch {
    return spec;
  }
}

function audioState(state: string | null): AudioState {
  if (state === "READY") return "READY";
  if (state === "FAILED") return "FAILED";
  if (state === "QUEUED" || state === "DOWNLOADING") return "PENDING";
  return "MISSING";
}

function millisToDate(value: number | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateMillis(value: Date | string | null): number | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function uniqueNumbers(items: number[]): number[] {
  return [...new Set(items.filter((item) => Number.isInteger(item) && item > 0))];
}
