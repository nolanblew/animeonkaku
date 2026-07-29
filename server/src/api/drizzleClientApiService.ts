import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client.js";

/** Either the root drizzle handle or the `tx` inside `db.transaction(...)`. */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
import {
  animeGenres,
  genres,
  animethemesAnime,
  animeMusicReleases,
  kitsuAnime,
  libraryEntries,
  mediaFiles,
  musicAcquisitions,
  musicReleases,
  playlistEntries,
  playlists,
  playEvents,
  releaseTracks,
  songPrefs,
  songs,
  themeArtists,
  themeFullSongs,
  themePrefs,
  themes,
  themeVideoSources,
} from "../db/schema.js";
import { JobPriority, type JobQueue } from "../jobs/index.js";
import type {
  LegacyLibraryImportPayload,
  LegacyLibraryImportResult,
  LegacyLibraryImportService,
} from "../legacyLibraryImport.js";
import type { AppLogger } from "../logging.js";
import { CANONICAL_AUDIO } from "../media/types.js";
import { normalizeMusicText } from "../music/matching/normalize.js";
import { DrizzleDynamicPlaylistEvaluator } from "../playlists/dynamicPlaylistEvaluator.js";
import { DrizzleAutoPlaylistRefresher } from "../sync/autoPlaylistRefresher.js";
import { resolveOpTs, shouldApplyWrite } from "../sync/lww.js";
import { ApiError } from "./errors.js";
import type {
  AudioState,
  AnimeMusicDto,
  ChangesResponse,
  ClientApiService,
  LibraryAnimeDto,
  LibraryResponse,
  PlaylistCreateInput,
  PlaylistItemDto,
  PlaylistItemInput,
  LibraryThemeDto,
  MusicReleaseDto,
  PlayInput,
  PlaylistDto,
  PlaylistInput,
  ThemePrefDto,
  ThemePrefPatch,
  SongPrefDto,
  SongPrefPatch,
} from "./clientRoutes.js";

export class DrizzleClientApiService implements ClientApiService, LegacyLibraryImportService {
  private readonly autoPlaylistRefresher: DrizzleAutoPlaylistRefresher;
  private readonly dynamicPlaylistEvaluator: DrizzleDynamicPlaylistEvaluator;
  /**
   * Music-mode exposure is configured at process start.  A restart is therefore
   * also a small, implicit revision of every theme descriptor: a client whose
   * cursor predates this process must receive the current descriptors once so
   * an enabled/disabled catalog flag cannot leave stale Full/Video modes in
   * Room forever.
   */
  private readonly themeModeRevisionAt: Date;

  constructor(
    private readonly db: Db,
    private readonly queue: JobQueue,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: AppLogger,
    private readonly musicCatalogEnabled = false,
  ) {
    this.autoPlaylistRefresher = new DrizzleAutoPlaylistRefresher(db);
    this.dynamicPlaylistEvaluator = new DrizzleDynamicPlaylistEvaluator(db, now);
    this.themeModeRevisionAt = now();
  }

  async getAnimeMusic(_userId: string, kitsuId: string): Promise<AnimeMusicDto | null> {
    if (!this.musicCatalogEnabled) return null;
    const [anime] = await this.db
      .select({
        kitsuId: kitsuAnime.kitsuId,
        animeThemesId: kitsuAnime.animethemesAnimeId,
        title: kitsuAnime.title,
        titleEn: kitsuAnime.titleEn,
        posterUrl: kitsuAnime.posterUrl,
        posterUrlLarge: kitsuAnime.posterUrlLarge,
      })
      .from(kitsuAnime)
      .where(and(eq(kitsuAnime.kitsuId, kitsuId), isNull(kitsuAnime.deletedAt)))
      .limit(1);
    if (!anime || anime.animeThemesId === null) return null;
    const releases = await this.readyMusicReleases([anime.animeThemesId]);
    return {
      anime: {
        kitsuId: anime.kitsuId,
        title: anime.title,
        titleEn: anime.titleEn,
        posterUrl: anime.posterUrl || anime.posterUrlLarge ? `/v1/media/images/anime/${anime.kitsuId}/poster` : null,
      },
      releases,
    };
  }

  async getMusicRelease(_userId: string, releaseId: number): Promise<MusicReleaseDto | null> {
    if (!this.musicCatalogEnabled) return null;
    const rows = await this.readyMusicRows(undefined, releaseId);
    const release = musicReleasesFromRows(rows)[0];
    if (!release) return null;
    release.anime = uniqueAnimeSummaries(rows);
    return release;
  }

  async getMusicCatalog(userId: string): Promise<AnimeMusicDto[]> {
    if (!this.musicCatalogEnabled) return [];
    const library = await this.db
      .select({
        kitsuId: libraryEntries.kitsuId,
        animeThemesId: kitsuAnime.animethemesAnimeId,
        title: kitsuAnime.title,
        titleEn: kitsuAnime.titleEn,
        posterUrl: kitsuAnime.posterUrl,
        posterUrlLarge: kitsuAnime.posterUrlLarge,
      })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(kitsuAnime.kitsuId, libraryEntries.kitsuId))
      .where(and(eq(libraryEntries.userId, userId), isNull(libraryEntries.deletedAt), isNull(kitsuAnime.deletedAt)))
      .orderBy(asc(libraryEntries.kitsuId));
    const animeThemesIds = uniqueNumbers(library.flatMap((row) => row.animeThemesId === null ? [] : [row.animeThemesId]));
    const readyRows = animeThemesIds.length > 0 ? await this.readyMusicRows(animeThemesIds) : [];
    return library.flatMap((anime) => {
      if (anime.animeThemesId === null) return [];
      const rows = readyRows.filter((row) => row.kitsuId === anime.kitsuId);
      return [{
        anime: rows[0] ? musicAnimeSummary(rows[0]) : {
          kitsuId: anime.kitsuId,
          title: anime.title,
          titleEn: anime.titleEn,
          posterUrl: anime.posterUrl || anime.posterUrlLarge ? `/v1/media/images/anime/${anime.kitsuId}/poster` : null,
        },
        releases: musicReleasesFromRows(rows),
      }];
    });
  }

  async searchMusic(_userId: string, query: string): Promise<{ releases: unknown[]; tracks: unknown[] }> {
    if (!this.musicCatalogEnabled) return { releases: [], tracks: [] };
    const normalized = normalizeMusicText(query);
    if (!normalized) return { releases: [], tracks: [] };
    // Keep search bounded in PostgreSQL. The in-memory predicate below is a
    // final normalization guard, not a scan of every ready catalog row.
    const rows = await this.readyMusicRows(undefined, undefined, {
      normalizedQuery: normalized,
      limit: 500,
    });
    const trackRows = rows.filter((row) => matchesNormalizedSearch(row, normalized, true));
    const releaseRows = rows.filter((row) => matchesNormalizedSearch(row, normalized, false));
    const tracks = trackRows.slice(0, 25).map((row) => ({
      anime: musicAnimeSummary(row),
      relationshipType: row.relationshipType,
      releaseId: row.releaseId,
      releaseTitle: row.releaseTitle,
      track: musicTrackDto(row),
    }));
    const selectedReleases = musicReleasesFromRows(releaseRows).slice(0, 25);
    // A release can be shared by several anime. The text match may have come
    // from only one owner (for example an anime title), so hydrate every owner
    // for the selected release ids in one bounded IN query before projecting.
    const selectedReleaseIds = selectedReleases.map((release) => release.id);
    const ownershipRows = selectedReleaseIds.length === 0
      ? []
      : await this.readyMusicRows(undefined, undefined, { releaseIds: selectedReleaseIds });
    const hydratedReleases = new Map(
      musicReleasesFromRows(ownershipRows).map((release) => [release.id, release]),
    );
    const releases = selectedReleases
      .flatMap((release) => {
        const hydrated = hydratedReleases.get(release.id);
        return hydrated ? [{
          anime: uniqueAnimeSummaries(ownershipRows.filter((candidate) => candidate.releaseId === release.id)),
          release: hydrated,
        }] : [];
      });
    return { releases, tracks };
  }

  async getLibrary(userId: string, since: number | null): Promise<LibraryResponse> {
    // Capture before any query: rows committed after this point are safely
    // included by the next delta rather than being skipped behind its cursor.
    const serverTime = this.now().getTime();
    const sinceDate = millisToDate(since);
    const animeRows = await this.libraryAnimeRows(userId, sinceDate);
    const activeMappings = await this.activeLibraryMappings(userId);
    const animeIds = animeRows.map((row) => row.kitsuId);
    const genreMap = await this.genreMap(animeIds);

    const anime: LibraryAnimeDto[] = animeRows.map((row) =>
      libraryAnimeDto(row, genreMap.get(row.kitsuId) ?? []),
    );

    const themes = await this.libraryThemes(activeMappings, animeRows, sinceDate);
    return {
      serverTime,
      anime,
      // Older Android releases deserialize this field as non-null. An empty
      // array is the wire-compatible representation of an unchanged delta.
      themes,
    };
  }

  async getAnime(
    userId: string,
    kitsuId: string,
  ): Promise<{ anime: LibraryAnimeDto; themes: LibraryThemeDto[] } | null> {
    const [row] = await this.db
      .select(libraryAnimeColumns)
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(libraryEntries.kitsuId, kitsuAnime.kitsuId))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          eq(libraryEntries.kitsuId, kitsuId),
          isNull(libraryEntries.deletedAt),
          isNull(kitsuAnime.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return this.catalogAnime(kitsuId);
    const genreMap = await this.genreMap([row.kitsuId]);
    return {
      anime: libraryAnimeDto(row, genreMap.get(row.kitsuId) ?? []),
      themes: row.animeThemesId === null
        ? []
        : await this.catalogThemes([{ kitsuId: row.kitsuId, animeThemesId: row.animeThemesId }]),
    };
  }

  async ensureLibraryForUserData(userId: string): Promise<boolean> {
    const prefRows = await this.db
      .select({ themeId: themePrefs.themeId })
      .from(themePrefs)
      .where(and(eq(themePrefs.userId, userId), isNull(themePrefs.deletedAt)));
    const playlistRows = await this.db
      .select({ themeId: playlistEntries.itemId })
      .from(playlists)
      .innerJoin(playlistEntries, eq(playlists.id, playlistEntries.playlistId))
      .where(and(
        eq(playlists.userId, userId),
        eq(playlists.isAuto, false),
        isNull(playlists.deletedAt),
        eq(playlistEntries.itemType, "THEME"),
      ));

    return this.ensureLibraryForThemeIds(
      userId,
      uniqueNumbers([
        ...prefRows.map((row) => row.themeId),
        ...playlistRows.map((row) => row.themeId),
      ]),
    );
  }

  async ensureLibraryForThemeIds(userId: string, themeIds: number[]): Promise<boolean> {
    const ids = uniqueNumbers(themeIds);
    if (ids.length === 0) return false;

    const now = this.now();
    const themeRows = await this.db
      .select({
        themeId: themes.id,
        animeThemesId: themes.animethemesAnimeId,
        animeName: animethemesAnime.name,
        animeNameEn: animethemesAnime.nameEn,
      })
      .from(themes)
      .innerJoin(animethemesAnime, eq(themes.animethemesAnimeId, animethemesAnime.id))
      .where(and(inArray(themes.id, ids), isNull(themes.deletedAt)));

    const animeThemesIds = uniqueNumbers(themeRows.map((row) => row.animeThemesId));
    if (animeThemesIds.length === 0) return false;

    const existingKitsuRows = await this.db
      .select({
        kitsuId: kitsuAnime.kitsuId,
        animeThemesId: kitsuAnime.animethemesAnimeId,
      })
      .from(kitsuAnime)
      .where(and(inArray(kitsuAnime.animethemesAnimeId, animeThemesIds), isNull(kitsuAnime.deletedAt)))
      .orderBy(asc(kitsuAnime.kitsuId));

    const kitsuIdByAnimeThemesId = preferredKitsuIdByAnimeThemesId(existingKitsuRows);
    const themeRowByAnimeThemesId = new Map(themeRows.map((row) => [row.animeThemesId, row]));
    const syntheticRows = animeThemesIds
      .filter((animeThemesId) => !kitsuIdByAnimeThemesId.has(animeThemesId))
      .map((animeThemesId) => {
        const row = themeRowByAnimeThemesId.get(animeThemesId);
        return {
          kitsuId: syntheticKitsuId(animeThemesId),
          animethemesAnimeId: animeThemesId,
          title: row?.animeNameEn ?? row?.animeName ?? null,
          titleEn: row?.animeNameEn ?? null,
          mappingState: "MAPPED",
          updatedAt: now,
          deletedAt: null,
        };
      });

    if (syntheticRows.length > 0) {
      await this.db
        .insert(kitsuAnime)
        .values(syntheticRows)
        .onConflictDoUpdate({
          target: kitsuAnime.kitsuId,
          set: {
            animethemesAnimeId: sql`excluded.animethemes_anime_id`,
            title: sql`excluded.title`,
            titleEn: sql`excluded.title_en`,
            mappingState: "MAPPED",
            updatedAt: now,
            deletedAt: null,
          },
        });
      for (const row of syntheticRows) {
        kitsuIdByAnimeThemesId.set(row.animethemesAnimeId, row.kitsuId);
      }
    }

    const targetKitsuIds = unique(
      themeRows.flatMap((row) => {
        const kitsuId = kitsuIdByAnimeThemesId.get(row.animeThemesId);
        return kitsuId ? [kitsuId] : [];
      }),
    );
    if (targetKitsuIds.length === 0) return syntheticRows.length > 0;

    const existingLibraryRows = await this.db
      .select({
        kitsuId: libraryEntries.kitsuId,
        isManuallyAdded: libraryEntries.isManuallyAdded,
        deletedAt: libraryEntries.deletedAt,
      })
      .from(libraryEntries)
      .where(and(eq(libraryEntries.userId, userId), inArray(libraryEntries.kitsuId, targetKitsuIds)));
    const existingLibraryByKitsuId = new Map(existingLibraryRows.map((row) => [row.kitsuId, row]));
    const rowsToUpsert = targetKitsuIds.filter((kitsuId) => {
      const row = existingLibraryByKitsuId.get(kitsuId);
      return row === undefined || row.deletedAt !== null || !row.isManuallyAdded;
    });

    if (rowsToUpsert.length > 0) {
      await this.db
        .insert(libraryEntries)
        .values(
          rowsToUpsert.map((kitsuId) => ({
            userId,
            kitsuId,
            isManuallyAdded: true,
            updatedAt: now,
            deletedAt: null,
          })),
        )
        .onConflictDoUpdate({
          target: [libraryEntries.userId, libraryEntries.kitsuId],
          set: {
            isManuallyAdded: true,
            updatedAt: now,
            deletedAt: null,
          },
        });
    }

    return syntheticRows.length > 0 || rowsToUpsert.length > 0;
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

  async getThemePrefs(userId: string, since: number | null = null): Promise<ThemePrefDto[]> {
    const sinceDate = millisToDate(since);
    const conditions = [eq(themePrefs.userId, userId)];
    if (sinceDate) {
      conditions.push(or(gt(themePrefs.updatedAt, sinceDate), gt(themePrefs.deletedAt, sinceDate))!);
    } else {
      conditions.push(isNull(themePrefs.deletedAt));
    }
    const rows = await this.db
      .select({
        themeId: themePrefs.themeId,
        liked: themePrefs.liked,
        disliked: themePrefs.disliked,
        dislikedTvSize: themePrefs.dislikedTvSize,
        dislikedFullSize: themePrefs.dislikedFullSize,
        playCount: themePrefs.playCount,
        lastPlayedAt: themePrefs.lastPlayedAt,
        updatedAt: themePrefs.updatedAt,
        deletedAt: themePrefs.deletedAt,
      })
      .from(themePrefs)
      .where(and(...conditions))
      .orderBy(asc(themePrefs.themeId));
    return rows.map((row) => ({
      themeId: row.themeId,
      liked: row.liked,
      disliked: row.disliked,
      dislikedTvSize: row.dislikedTvSize,
      dislikedFullSize: row.dislikedFullSize,
      playCount: row.playCount,
      lastPlayedAt: dateMillis(row.lastPlayedAt),
      updatedAt: Math.max(dateMillis(row.updatedAt) ?? 0, dateMillis(row.deletedAt) ?? 0),
      deleted: row.deletedAt !== null,
    }));
  }

  private async getThemePref(userId: string, themeId: number): Promise<ThemePrefDto | null> {
    const rows = await this.db
      .select({
        themeId: themePrefs.themeId,
        liked: themePrefs.liked,
        disliked: themePrefs.disliked,
        dislikedTvSize: themePrefs.dislikedTvSize,
        dislikedFullSize: themePrefs.dislikedFullSize,
        playCount: themePrefs.playCount,
        lastPlayedAt: themePrefs.lastPlayedAt,
        updatedAt: themePrefs.updatedAt,
        deletedAt: themePrefs.deletedAt,
      })
      .from(themePrefs)
      .where(and(eq(themePrefs.userId, userId), eq(themePrefs.themeId, themeId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      themeId: row.themeId,
      liked: row.liked,
      disliked: row.disliked,
      dislikedTvSize: row.dislikedTvSize,
      dislikedFullSize: row.dislikedFullSize,
      playCount: row.playCount,
      lastPlayedAt: dateMillis(row.lastPlayedAt),
      updatedAt: Math.max(dateMillis(row.updatedAt) ?? 0, dateMillis(row.deletedAt) ?? 0),
      deleted: row.deletedAt !== null,
    };
  }

  async getChanges(userId: string, since: number | null): Promise<ChangesResponse> {
    const library = await this.getLibrary(userId, since);
    const prefs = await this.getThemePrefs(userId, since);
    const playlistList = await this.listPlaylists(userId, { since });
    const changes: ChangesResponse = {
      serverTime: library.serverTime,
      anime: library.anime,
      themes: library.themes,
      prefs,
      songPrefs: await this.getSongPrefs(userId, since),
      playlists: playlistList,
    };
    const sinceDate = millisToDate(since);
    if (sinceDate === null || sinceDate < this.themeModeRevisionAt
      || await this.musicCatalogChanged(userId, sinceDate)) {
      // Android applies catalog responses as an atomic snapshot, so refresh
      // the already set-based, per-library catalog only when its publication
      // inputs changed. This is what makes newly READY music visible without a
      // manual full pull while avoiding an every-poll catalog reload.
      changes.musicCatalog = await this.getMusicCatalog(userId);
    }
    return changes;
  }

  async updateThemePref(userId: string, themeId: number, patch: ThemePrefPatch): Promise<ThemePrefDto> {
    const now = this.now();
    const opTs = resolveOpTs(patch.opTs ?? null, now.getTime());
    const opDate = new Date(opTs);

    // The complete reaction state is one LWW register. The conflict predicate keeps
    // out-of-order concurrent requests from overwriting a newer user action.
    const set = normalizedPrefPatch(patch, now);
    set.likedUpdatedAt = opDate;
    set.deletedAt = null;
    await this.db.insert(themePrefs).values({
      userId,
      themeId,
      liked: set.liked ?? false,
      disliked: set.disliked ?? false,
      dislikedTvSize: set.dislikedTvSize ?? false,
      dislikedFullSize: set.dislikedFullSize ?? false,
      playCount: 0,
      likedUpdatedAt: opDate,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [themePrefs.userId, themePrefs.themeId],
      set,
      setWhere: or(isNull(themePrefs.likedUpdatedAt), lte(themePrefs.likedUpdatedAt, opDate))!,
    });

    const pref = await this.getThemePref(userId, themeId);
    await this.queue.enqueue({
      type: "AUTO_PLAYLIST_REFRESH",
      priority: JobPriority.NORMAL,
      payload: { userId },
      dedupeKey: `AUTO_PLAYLIST_REFRESH:${userId}`,
    });
    return pref!;
  }

  async getSongPrefs(userId: string, since: number | null = null): Promise<SongPrefDto[]> {
    const sinceDate = millisToDate(since);
    const conditions = [eq(songPrefs.userId, userId)];
    if (sinceDate) conditions.push(or(gt(songPrefs.updatedAt, sinceDate), gt(songPrefs.deletedAt, sinceDate))!);
    else conditions.push(isNull(songPrefs.deletedAt));
    const rows = await this.db.select({
      songId: songPrefs.songId,
      liked: songPrefs.liked,
      disliked: songPrefs.disliked,
      playCount: songPrefs.playCount,
      lastPlayedAt: songPrefs.lastPlayedAt,
      updatedAt: songPrefs.updatedAt,
      deletedAt: songPrefs.deletedAt,
    }).from(songPrefs).where(and(...conditions)).orderBy(asc(songPrefs.songId));
    return rows.map(songPrefDto);
  }

  async updateSongPref(userId: string, songId: number, patch: SongPrefPatch): Promise<SongPrefDto> {
    if (!(await this.knownReadyRelatedSongIds([songId])).has(songId)) {
      throw new ApiError(404, "MUSIC_NOT_FOUND", "Ready Related song was not found.");
    }
    const now = this.now();
    const opTs = resolveOpTs(patch.opTs ?? null, now.getTime());
    const opDate = new Date(opTs);
    const set = normalizedSongPrefPatch(patch, now);
    set.likedUpdatedAt = opDate;
    set.deletedAt = null;
    await this.db.insert(songPrefs).values({
      userId,
      songId,
      liked: set.liked ?? false,
      disliked: set.disliked ?? false,
      playCount: 0,
      likedUpdatedAt: opDate,
      updatedAt: now,
      deletedAt: null,
    }).onConflictDoUpdate({
      target: [songPrefs.userId, songPrefs.songId],
      set,
      setWhere: or(isNull(songPrefs.likedUpdatedAt), lte(songPrefs.likedUpdatedAt, opDate))!,
    });
    return (await this.getSongPref(userId, songId))!;
  }

  async deleteSongPref(userId: string, songId: number, requestedOpTs: number | null = null): Promise<boolean> {
    const now = this.now();
    const opTs = resolveOpTs(requestedOpTs, now.getTime());
    const opDate = new Date(opTs);
    const [existing] = await this.db.select({ likedUpdatedAt: songPrefs.likedUpdatedAt })
      .from(songPrefs).where(and(eq(songPrefs.userId, userId), eq(songPrefs.songId, songId))).limit(1);
    if (!existing) return false;
    if (shouldApplyWrite(opTs, existing.likedUpdatedAt?.getTime())) {
      await this.db.update(songPrefs).set({
        liked: false,
        disliked: false,
        likedUpdatedAt: opDate,
        updatedAt: now,
        deletedAt: now,
      }).where(and(
        eq(songPrefs.userId, userId),
        eq(songPrefs.songId, songId),
        or(isNull(songPrefs.likedUpdatedAt), lte(songPrefs.likedUpdatedAt, opDate)),
      ));
    }
    return true;
  }

  private async getSongPref(userId: string, songId: number): Promise<SongPrefDto | null> {
    const [row] = await this.db.select({
      songId: songPrefs.songId,
      liked: songPrefs.liked,
      disliked: songPrefs.disliked,
      playCount: songPrefs.playCount,
      lastPlayedAt: songPrefs.lastPlayedAt,
      updatedAt: songPrefs.updatedAt,
      deletedAt: songPrefs.deletedAt,
    }).from(songPrefs).where(and(eq(songPrefs.userId, userId), eq(songPrefs.songId, songId))).limit(1);
    return row ? songPrefDto(row) : null;
  }

  async importLegacyLibrary(
    userId: string,
    payload: LegacyLibraryImportPayload,
  ): Promise<LegacyLibraryImportResult> {
    const normalized = normalizeLegacyImportEntries(payload);
    const requestedEntries = payload.entries.length;
    const themeIds = normalized.map((entry) => entry.themeId);
    const now = this.now();

    const knownThemeRows = themeIds.length === 0
      ? []
      : await this.db
        .select({ id: themes.id })
        .from(themes)
        .where(and(inArray(themes.id, themeIds), isNull(themes.deletedAt)));
    const knownThemeIds = new Set(knownThemeRows.map((row) => row.id));
    const importable = normalized.filter((entry) => knownThemeIds.has(entry.themeId));

    if (importable.length > 0) {
      await this.db
        .update(themePrefs)
        .set({
          liked: false,
          disliked: false,
          dislikedTvSize: false,
          dislikedFullSize: false,
          playCount: 0,
          lastPlayedAt: null,
          likedUpdatedAt: now,
          updatedAt: now,
          deletedAt: now,
        })
        .where(and(eq(themePrefs.userId, userId), isNull(themePrefs.deletedAt)));

      await this.ensureLibraryForThemeIds(userId, importable.map((entry) => entry.themeId));
      await this.db
        .insert(themePrefs)
        .values(
          importable.map((entry) => ({
            userId,
            themeId: entry.themeId,
            liked: entry.liked,
            disliked: entry.disliked,
            playCount: entry.playCount,
            lastPlayedAt: entry.lastPlayedAt == null ? null : new Date(entry.lastPlayedAt),
            likedUpdatedAt: now,
            updatedAt: now,
            deletedAt: null,
          })),
        )
        .onConflictDoUpdate({
          target: [themePrefs.userId, themePrefs.themeId],
          set: {
            liked: sql`excluded.liked`,
            disliked: sql`excluded.disliked`,
            dislikedTvSize: false,
            dislikedFullSize: false,
            playCount: sql`excluded.play_count`,
            lastPlayedAt: sql`excluded.last_played_at`,
            likedUpdatedAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        });
      await this.refreshAutoPlaylists(userId);
    }

    return {
      requestedEntries,
      importedEntries: importable.length,
      skippedEntries: requestedEntries - importable.length,
      importedLikes: importable.filter((entry) => entry.liked).length,
      importedDislikes: importable.filter((entry) => entry.disliked).length,
      importedPlayCounts: importable.filter((entry) => entry.playCount > 0).length,
    };
  }

  async refreshAutoPlaylists(userId: string): Promise<void> {
    await this.autoPlaylistRefresher.refresh(userId);
    // Dynamic (smart) playlists materialize on the same triggers as the built-in auto playlists.
    await this.dynamicPlaylistEvaluator.refresh(userId);
  }

  async recordPlays(
    userId: string,
    plays: PlayInput[],
  ): Promise<{ accepted: number }> {
    if (plays.length === 0) return { accepted: 0 };
    const now = this.now();
    const normalized = dedupePlayInputs(plays.map(normalizePlayInput));
    return this.db.transaction(async (tx) => {
      const existing = await tx.select({
        clientEventId: playEvents.clientEventId,
        itemType: playEvents.itemType,
        itemId: playEvents.itemId,
        actualMode: playEvents.actualMode,
        playedAt: playEvents.playedAt,
      }).from(playEvents).where(and(
        eq(playEvents.userId, userId),
        inArray(playEvents.clientEventId, normalized.map((play) => play.clientEventId)),
      ));
      const existingById = new Map(existing.map((play) => [play.clientEventId, play]));
      for (const play of normalized) {
        const stored = existingById.get(play.clientEventId);
        if (stored && !samePlayEvent(play, stored)) {
          throw new ApiError(409, "PLAY_EVENT_ID_CONFLICT", "clientEventId was already used for a different play event.");
        }
      }
      const novel = normalized.filter((play) => !existingById.has(play.clientEventId));
      if (novel.length === 0) return { accepted: 0 };
      const themeIds = uniqueNumbers(novel.flatMap((play) => play.itemType === "THEME" ? [play.itemId] : []));
      const songIds = uniqueNumbers(novel.flatMap((play) => play.itemType === "SONG" ? [play.itemId] : []));
      const [knownThemes, knownSongs] = await Promise.all([
        this.knownActiveThemeIds(themeIds, tx),
        this.knownReadyRelatedSongIds(songIds, tx),
      ]);
      if (themeIds.some((id) => !knownThemes.has(id)) || songIds.some((id) => !knownSongs.has(id))) {
        throw new ApiError(404, "MUSIC_NOT_FOUND", "Playable item was not found in the ready catalog.");
      }
      const inserted = await tx.insert(playEvents).values(novel.map((play) => ({
        userId,
        clientEventId: play.clientEventId,
        itemType: play.itemType,
        itemId: play.itemId,
        actualMode: play.actualMode,
        playedAt: new Date(play.playedAt),
        createdAt: now,
      }))).onConflictDoNothing({ target: [playEvents.userId, playEvents.clientEventId] }).returning({
        clientEventId: playEvents.clientEventId,
        itemType: playEvents.itemType,
        itemId: playEvents.itemId,
        playedAt: playEvents.playedAt,
      });
      if (inserted.length < novel.length) {
        const storedAfterConflict = await tx.select({
          clientEventId: playEvents.clientEventId,
          itemType: playEvents.itemType,
          itemId: playEvents.itemId,
          actualMode: playEvents.actualMode,
          playedAt: playEvents.playedAt,
        }).from(playEvents).where(and(
          eq(playEvents.userId, userId),
          inArray(playEvents.clientEventId, novel.map((play) => play.clientEventId)),
        ));
        const storedAfterById = new Map(storedAfterConflict.map((play) => [play.clientEventId, play]));
        for (const play of novel) {
          const stored = storedAfterById.get(play.clientEventId);
          if (stored && !samePlayEvent(play, stored)) {
            throw new ApiError(409, "PLAY_EVENT_ID_CONFLICT", "clientEventId was concurrently used for a different play event.");
          }
        }
      }
      for (const play of groupInsertedPlays(inserted.filter((item) => item.itemType === "THEME"))) {
        await tx.insert(themePrefs).values({
          userId, themeId: play.itemId, playCount: play.count, lastPlayedAt: play.lastPlayedAt, updatedAt: now,
        }).onConflictDoUpdate({ target: [themePrefs.userId, themePrefs.themeId], set: {
          playCount: sql`${themePrefs.playCount} + ${play.count}`,
          lastPlayedAt: sql`greatest(coalesce(${themePrefs.lastPlayedAt}, to_timestamp(0)), ${play.lastPlayedAt})`,
          updatedAt: now,
          deletedAt: null,
        }});
      }
      for (const play of groupInsertedPlays(inserted.filter((item) => item.itemType === "SONG"))) {
        await tx.insert(songPrefs).values({
          userId, songId: play.itemId, playCount: play.count, lastPlayedAt: play.lastPlayedAt, updatedAt: now, deletedAt: null,
        }).onConflictDoUpdate({ target: [songPrefs.userId, songPrefs.songId], set: {
          playCount: sql`${songPrefs.playCount} + ${play.count}`,
          lastPlayedAt: sql`greatest(coalesce(${songPrefs.lastPlayedAt}, to_timestamp(0)), ${play.lastPlayedAt})`,
          updatedAt: now,
          deletedAt: null,
        }});
      }
      return { accepted: inserted.length };
    });
  }

  async listPlaylists(
    userId: string,
    options: { autoOnly?: boolean; since?: number | null } = {},
  ): Promise<PlaylistDto[]> {
    const sinceDate = millisToDate(options.since ?? null);
    const conditions = [eq(playlists.userId, userId)];
    if (options.autoOnly) conditions.push(eq(playlists.isAuto, true));
    if (sinceDate) {
      // updatedAt is bumped on delete too, so tombstones surface in the delta.
      conditions.push(gt(playlists.updatedAt, sinceDate));
    } else {
      conditions.push(isNull(playlists.deletedAt));
    }
    const rows = await this.db
      .select(playlistColumns)
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
    // Offline clients replay pending create ops until acknowledged, so a create
    // whose earlier attempt partially landed (or that raced another device) must
    // converge on the existing active row instead of violating the
    // (user_id, name) active unique index.
    const existing = await this.activePlaylistByName(userId, input.name);
    if (existing) {
      if (existing.isAuto) {
        throw new ApiError(409, "CONFLICT", "A playlist with this name already exists.");
      }
      const replay: PlaylistInput = {};
      if (input.entries !== undefined) replay.entries = input.entries;
      if (input.defaultMode !== undefined) replay.defaultMode = input.defaultMode;
      if (input.items !== undefined) replay.items = input.items;
      if (input.dynamicSpecJson !== undefined) replay.dynamicSpecJson = input.dynamicSpecJson;
      if (input.dynamicSortJson !== undefined) replay.dynamicSortJson = input.dynamicSortJson;
      if (input.autoUpdate !== undefined) replay.autoUpdate = input.autoUpdate;
      if (input.opTs !== undefined) replay.opTs = input.opTs;
      const playlist = await this.updatePlaylist(userId, existing.id, replay);
      return playlist!;
    }

    const now = this.now();
    const opDate = new Date(resolveOpTs(input.opTs ?? null, now.getTime()));
    const isDynamic = input.dynamicSpecJson !== undefined && input.dynamicSpecJson !== null;
    // Auto-update dynamic (smart) playlists are server-authoritative: the spec —
    // not the device's local evaluation — decides the entries, so client-sent
    // entries are ignored and the spec is materialized here.
    const serverEvaluated = isDynamic && (input.autoUpdate ?? true);
    // Transactional so a failed entries insert cannot leave an orphaned playlist
    // row that blocks every retry on the active-name unique index.
    const playlistId = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(playlists)
        .values({
          userId,
          name: input.name,
          isAuto: false,
          isDynamic,
          dynamicAutoUpdate: input.autoUpdate ?? true,
          dynamicSpecJson: stringifySpec(input.dynamicSpecJson),
          dynamicSortJson: stringifySpec(input.dynamicSortJson),
          dynamicSpecUpdatedAt: isDynamic ? now : null,
          defaultMode: input.defaultMode ?? "TV_SIZE",
          mutationUpdatedAt: opDate,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: playlists.id });
      if (!row) return null;
      if (!serverEvaluated) {
        if (input.items !== undefined) await this.replacePlaylistItems(row.id, input.items, tx);
        else await this.replacePlaylistEntries(row.id, input.entries ?? [], tx);
      }
      return row.id;
    });
    // A same-name create can appear after the preflight but before INSERT. The
    // unique index is the final arbiter; converge after ON CONFLICT instead of
    // surfacing a transient 500 to an offline client that will replay forever.
    if (playlistId === null) {
      const raced = await this.activePlaylistByName(userId, input.name);
      if (!raced || raced.isAuto) {
        throw new ApiError(409, "CONFLICT", "A playlist with this name already exists.");
      }
      const replay: PlaylistInput = {};
      if (input.entries !== undefined) replay.entries = input.entries;
      if (input.defaultMode !== undefined) replay.defaultMode = input.defaultMode;
      if (input.items !== undefined) replay.items = input.items;
      if (input.dynamicSpecJson !== undefined) replay.dynamicSpecJson = input.dynamicSpecJson;
      if (input.dynamicSortJson !== undefined) replay.dynamicSortJson = input.dynamicSortJson;
      if (input.autoUpdate !== undefined) replay.autoUpdate = input.autoUpdate;
      if (input.opTs !== undefined) replay.opTs = input.opTs;
      const playlist = await this.updatePlaylist(userId, raced.id, replay);
      return playlist!;
    }
    if (serverEvaluated) {
      await this.dynamicPlaylistEvaluator.refresh(userId, playlistId);
    }
    const playlist = await this.findPlaylist(userId, playlistId);
    return playlist!;
  }

  private async activePlaylistByName(
    userId: string,
    name: string,
  ): Promise<{ id: number; isAuto: boolean } | null> {
    const rows = await this.db
      .select({ id: playlists.id, isAuto: playlists.isAuto })
      .from(playlists)
      .where(
        and(
          eq(playlists.userId, userId),
          eq(playlists.name, name),
          isNull(playlists.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async updatePlaylist(userId: string, id: number, input: PlaylistInput): Promise<PlaylistDto | null> {
    const existing = await this.mutablePlaylistRow(userId, id);
    if (!existing) return null;

    const now = this.now();
    const opTs = resolveOpTs(input.opTs ?? null, now.getTime());
    const opDate = new Date(opTs);
    const storedTs = existing.mutationUpdatedAt.getTime();
    // Last-write-wins: a stale edit arriving after a newer one is dropped, but we still
    // return the authoritative row so the caller reconciles.
    if (!shouldApplyWrite(opTs, storedTs)) {
      return this.findPlaylist(userId, id);
    }
    const set: Partial<typeof playlists.$inferInsert> = { updatedAt: now, mutationUpdatedAt: opDate };
    if (input.name !== undefined) set.name = input.name;
    if (input.defaultMode !== undefined) set.defaultMode = input.defaultMode;
    if (input.autoUpdate !== undefined) set.dynamicAutoUpdate = input.autoUpdate;
    if (input.dynamicSortJson !== undefined) set.dynamicSortJson = stringifySpec(input.dynamicSortJson);
    if (input.dynamicSpecJson !== undefined) {
      set.dynamicSpecJson = stringifySpec(input.dynamicSpecJson);
      set.isDynamic = input.dynamicSpecJson !== null;
      set.dynamicSpecUpdatedAt = now;
    }
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ mutationUpdatedAt: playlists.mutationUpdatedAt })
        .from(playlists)
        .where(and(eq(playlists.id, id), eq(playlists.userId, userId), eq(playlists.isAuto, false), isNull(playlists.deletedAt)))
        .for("update")
        .limit(1);
      if (!locked || !shouldApplyWrite(opTs, locked.mutationUpdatedAt.getTime())) return { applied: false, serverEvaluated: false };
      if (input.entries !== undefined && input.items === undefined && await this.playlistRequiresNewClient(id, tx)) {
        throw new ApiError(409, "PLAYLIST_REQUIRES_NEW_CLIENT", "This playlist contains modes or songs that require a newer client.");
      }
      if (input.items !== undefined) await this.validatePlaylistItems(input.items, tx);
      await tx.update(playlists).set(set).where(eq(playlists.id, id));
      const [state] = await tx
        .select({ isDynamic: playlists.isDynamic, autoUpdate: playlists.dynamicAutoUpdate })
        .from(playlists)
        .where(eq(playlists.id, id))
        .limit(1);
      const serverEvaluated = state?.isDynamic === true && state.autoUpdate;
      if (!serverEvaluated && input.items !== undefined) await this.replacePlaylistItems(id, input.items, tx, true);
      else if (!serverEvaluated && input.entries !== undefined) await this.replacePlaylistEntries(id, input.entries, tx);
      return { applied: true, serverEvaluated };
    });
    if (!result.applied) return this.findPlaylist(userId, id);
    if (result.serverEvaluated) {
      await this.dynamicPlaylistEvaluator.refresh(userId, id);
    }
    return this.findPlaylist(userId, id);
  }

  async updatePlaylistSpec(userId: string, id: number, spec: unknown): Promise<PlaylistDto | null> {
    return this.updatePlaylist(userId, id, { dynamicSpecJson: spec });
  }

  async deletePlaylist(userId: string, id: number, opTs: number | null = null): Promise<boolean> {
    const existing = await this.mutablePlaylistRow(userId, id);
    if (!existing) return false;
    const now = this.now();
    const resolvedOpTs = resolveOpTs(opTs, now.getTime());
    if (!shouldApplyWrite(resolvedOpTs, existing.mutationUpdatedAt.getTime())) {
      return true;
    }
    const opDate = new Date(resolvedOpTs);
    await this.db
      .update(playlists)
      .set({ deletedAt: now, updatedAt: now, mutationUpdatedAt: opDate })
      .where(
        and(
          eq(playlists.id, id),
          eq(playlists.userId, userId),
          isNull(playlists.deletedAt),
          lte(playlists.mutationUpdatedAt, opDate),
        ),
      );
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
      .select(libraryAnimeColumns)
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

    const conditions = [inArray(themes.animethemesAnimeId, activeAnimeThemesIds)];
    const modeRevisionRequiresSnapshot = sinceDate !== null && sinceDate < this.themeModeRevisionAt;
    const changedMappingAnimeIds = new Set(
      activeMappings
        .filter((mapping) => changedAnimeRows.some((row) => row.kitsuId === mapping.kitsuId))
        .map((mapping) => mapping.animeThemesId),
    );
    const descriptorRevisions = sinceDate !== null && !modeRevisionRequiresSnapshot
      ? await this.changedThemeDescriptorRevisions(activeAnimeThemesIds, sinceDate)
      : new Map<number, number>();
    const descriptorThemeIds = [...descriptorRevisions.keys()];

    if (sinceDate && !modeRevisionRequiresSnapshot) {
      // A delta is a patch, never a compact full snapshot. Theme metadata and
      // tombstones both have their own cursor. The descriptor revision sources
      // cover cached TV media, Full-size publication, and video candidates;
      // changed/re-mapped library anime must also receive their already-known
      // themes even when those theme rows predate the library entry itself.
      conditions.push(or(
        gt(themes.updatedAt, sinceDate),
        gt(themes.deletedAt, sinceDate),
        ...(changedMappingAnimeIds.size > 0
          ? [inArray(themes.animethemesAnimeId, [...changedMappingAnimeIds])]
          : []),
        ...(descriptorThemeIds.length > 0 ? [inArray(themes.id, descriptorThemeIds)] : []),
      )!);
    } else {
      conditions.push(isNull(themes.deletedAt));
    }

    const rows = await this.db
      .select({
        id: themes.id,
        animeThemesAnimeId: themes.animethemesAnimeId,
        title: themes.title,
        themeType: themes.themeType,
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
    const catalogModes = await this.themeCatalogModes(themeIds);
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
        videoUrl: null,
        audioState: audioState(audio?.state ?? null),
        durationSeconds: row.durationSeconds,
        fileSize: audio?.byteSize ?? null,
        mediaModes: {
          tvSize: { url: `/v1/media/audio/${row.id}`, durationSeconds: row.durationSeconds, fileSize: audio?.byteSize ?? null },
          fullSize: row.deletedAt === null ? catalogModes.full.get(row.id) ?? null : null,
          video: row.deletedAt === null ? catalogModes.video.get(row.id) ?? null : null,
        },
        updatedAt: Math.max(
          dateMillis(row.updatedAt) ?? 0,
          dateMillis(row.deletedAt) ?? 0,
          descriptorRevisions.get(row.id) ?? 0,
        ),
        deleted: row.deletedAt !== null,
      };
    });
  }

  /**
   * Returns a per-theme descriptor revision for data that changes how a theme
   * is played without changing its metadata row. Every query is set-based and
   * scoped to the listener's active AnimeThemes ids; this avoids a full theme
   * snapshot (or a query per theme) on ordinary incremental pulls.
   */
  private async changedThemeDescriptorRevisions(
    activeAnimeThemesIds: number[],
    sinceDate: Date,
  ): Promise<Map<number, number>> {
    const themeScope = inArray(themes.animethemesAnimeId, activeAnimeThemesIds);
    const [shortMedia, videoSources, fullLinks, fullSongs, fullReleases, fullAcquisitions, fullMedia] = await Promise.all([
      this.db
        .select({ themeId: themes.id, updatedAt: mediaFiles.updatedAt })
        .from(themes)
        .innerJoin(mediaFiles, and(
          eq(mediaFiles.kind, CANONICAL_AUDIO.kind),
          eq(mediaFiles.variant, CANONICAL_AUDIO.variant),
          sql`${mediaFiles.refId} = (${themes.id}::text)`,
        ))
        .where(and(themeScope, gt(mediaFiles.updatedAt, sinceDate))),
      this.db
        .select({ themeId: themes.id, updatedAt: themeVideoSources.updatedAt })
        .from(themes)
        .innerJoin(themeVideoSources, eq(themeVideoSources.themeId, themes.id))
        .where(and(themeScope, gt(themeVideoSources.updatedAt, sinceDate))),
      this.db
        .select({ themeId: themes.id, updatedAt: themeFullSongs.updatedAt })
        .from(themes)
        .innerJoin(themeFullSongs, eq(themeFullSongs.themeId, themes.id))
        .where(and(themeScope, gt(themeFullSongs.updatedAt, sinceDate))),
      this.db
        .select({ themeId: themes.id, updatedAt: songs.updatedAt })
        .from(themes)
        .innerJoin(themeFullSongs, eq(themeFullSongs.themeId, themes.id))
        .innerJoin(songs, eq(songs.id, themeFullSongs.songId))
        .where(and(themeScope, or(gt(songs.updatedAt, sinceDate), gt(songs.deletedAt, sinceDate))!)),
      this.db
        .select({ themeId: themes.id, updatedAt: musicReleases.updatedAt })
        .from(themes)
        .innerJoin(themeFullSongs, eq(themeFullSongs.themeId, themes.id))
        .innerJoin(musicReleases, eq(musicReleases.id, themeFullSongs.sourceReleaseId))
        .where(and(themeScope, or(gt(musicReleases.updatedAt, sinceDate), gt(musicReleases.deletedAt, sinceDate))!)),
      this.db
        .select({ themeId: themes.id, updatedAt: musicAcquisitions.updatedAt })
        .from(themes)
        .innerJoin(themeFullSongs, eq(themeFullSongs.themeId, themes.id))
        .innerJoin(musicAcquisitions, and(
          eq(musicAcquisitions.themeId, themeFullSongs.themeId),
          eq(musicAcquisitions.songId, themeFullSongs.songId),
          eq(musicAcquisitions.releaseId, themeFullSongs.sourceReleaseId),
          eq(musicAcquisitions.purpose, "FULL_SIZE"),
        ))
        .where(and(themeScope, gt(musicAcquisitions.updatedAt, sinceDate))),
      this.db
        .select({ themeId: themes.id, updatedAt: mediaFiles.updatedAt })
        .from(themes)
        .innerJoin(themeFullSongs, eq(themeFullSongs.themeId, themes.id))
        .innerJoin(songs, eq(songs.id, themeFullSongs.songId))
        .innerJoin(mediaFiles, and(
          eq(mediaFiles.kind, "AUDIO"),
          eq(mediaFiles.variant, "ORIGINAL"),
          sql`${mediaFiles.refId} = ('song:' || ${songs.id}::text)`,
        ))
        .where(and(themeScope, gt(mediaFiles.updatedAt, sinceDate))),
    ]);
    const revisions = new Map<number, number>();
    for (const row of [
      ...shortMedia,
      ...videoSources,
      ...fullLinks,
      ...fullSongs,
      ...fullReleases,
      ...fullAcquisitions,
      ...fullMedia,
    ]) {
      revisions.set(row.themeId, Math.max(revisions.get(row.themeId) ?? 0, dateMillis(row.updatedAt) ?? 0));
    }
    return revisions;
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
      .where(
        and(
          eq(mediaFiles.kind, CANONICAL_AUDIO.kind),
          eq(mediaFiles.variant, CANONICAL_AUDIO.variant),
          inArray(mediaFiles.refId, themeIds.map(String)),
        ),
      );
    return new Map(
      rows
        .map((row) => [Number(row.refId), { state: row.state, byteSize: row.byteSize }] as const)
        .filter(([themeId]) => Number.isInteger(themeId)),
    );
  }

  private async playlistEntryMap(playlistIds: number[]): Promise<Map<number, PlaylistItemDto[]>> {
    const result = new Map<number, PlaylistItemDto[]>();
    if (playlistIds.length === 0) return result;
    const rows = await this.db
      .select({
        playlistId: playlistEntries.playlistId,
        entryId: playlistEntries.id,
        itemType: playlistEntries.itemType,
        itemId: playlistEntries.itemId,
        modeOverride: playlistEntries.modeOverride,
      })
      .from(playlistEntries)
      .where(inArray(playlistEntries.playlistId, playlistIds))
      .orderBy(asc(playlistEntries.playlistId), asc(playlistEntries.orderIndex));
    for (const row of rows) {
      const items = result.get(row.playlistId) ?? [];
      items.push({
        entryId: row.entryId,
        itemType: row.itemType,
        itemId: row.itemId,
        modeOverride: row.modeOverride,
      });
      result.set(row.playlistId, items);
    }
    return result;
  }

  private async replacePlaylistEntries(
    playlistId: number,
    entries: number[],
    db: DbOrTx = this.db,
  ): Promise<void> {
    // Devices can reference themes this server has never cataloged (e.g. liked
    // themes pulled from an older server instance). The polymorphic item_id has
    // no database FK, so keep the existing listener contract by persisting only
    // the known THEME subset instead of retaining dangling catalog identities.
    const knownThemeIds = await this.knownThemeIds(entries, db);
    const insertable = entries.filter((themeId) => knownThemeIds.has(themeId));
    const droppedThemeIds = uniqueNumbers(entries.filter((themeId) => !knownThemeIds.has(themeId)));
    if (droppedThemeIds.length > 0) {
      this.logger?.warn?.(
        { playlistId, droppedThemeIds, requestedEntries: entries.length, keptEntries: insertable.length },
        "dropping playlist entries for theme ids unknown to this server",
      );
    }
    await this.replacePlaylistItems(
      playlistId,
      insertable.map((itemId) => ({ itemType: "THEME", itemId, modeOverride: null })),
      db,
      true,
    );
  }

  private async replacePlaylistItems(
    playlistId: number,
    items: PlaylistItemInput[],
    db: DbOrTx = this.db,
    validated = false,
  ): Promise<void> {
    if (!validated) await this.validatePlaylistItems(items, db);
    const requestedIds = items.flatMap((item) => item.entryId === undefined ? [] : [item.entryId]);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new ApiError(422, "UNPROCESSABLE", "Playlist entry ids must be unique occurrences.");
    }
    const existingRows = await db
      .select({ id: playlistEntries.id, itemType: playlistEntries.itemType, itemId: playlistEntries.itemId, modeOverride: playlistEntries.modeOverride })
      .from(playlistEntries)
      .where(eq(playlistEntries.playlistId, playlistId))
      .orderBy(asc(playlistEntries.orderIndex))
      .for("update");
    if (items.every((item) => item.entryId === undefined)
      && existingRows.length === items.length
      && items.every((item, index) => {
        const current = existingRows[index];
        return current?.itemType === item.itemType
          && current.itemId === item.itemId
          && current.modeOverride === (item.modeOverride ?? null);
      })) return;
    const existingIds = new Set(existingRows.map((row) => row.id));
    if (requestedIds.some((entryId) => !existingIds.has(entryId))) {
      throw new ApiError(422, "UNPROCESSABLE", "Playlist entry id does not belong to this playlist.");
    }
    await db.delete(playlistEntries).where(requestedIds.length === 0
      ? eq(playlistEntries.playlistId, playlistId)
      : and(eq(playlistEntries.playlistId, playlistId), notInArray(playlistEntries.id, requestedIds))!);
    for (const [orderIndex, item] of items.entries()) {
      if (item.entryId === undefined) continue;
      await db.update(playlistEntries).set({
        itemType: item.itemType,
        itemId: item.itemId,
        orderIndex,
        modeOverride: item.modeOverride ?? null,
      }).where(and(eq(playlistEntries.playlistId, playlistId), eq(playlistEntries.id, item.entryId)));
    }
    const added = items.flatMap((item, orderIndex) => item.entryId === undefined ? [{
      playlistId,
      itemType: item.itemType,
      itemId: item.itemId,
      orderIndex,
      modeOverride: item.modeOverride ?? null,
    }] : []);
    if (added.length > 0) await db.insert(playlistEntries).values(added);
  }

  private async validatePlaylistItems(items: PlaylistItemInput[], db: DbOrTx = this.db): Promise<void> {
    const themeIds = uniqueNumbers(items.flatMap((item) => item.itemType === "THEME" ? [item.itemId] : []));
    const songIds = uniqueNumbers(items.flatMap((item) => item.itemType === "SONG" ? [item.itemId] : []));
    const knownThemes = await this.knownActiveThemeIds(themeIds, db);
    const knownSongs = await this.knownReadyRelatedSongIds(songIds, db);
    const invalid = items.filter((item) => item.itemType === "THEME"
      ? !knownThemes.has(item.itemId)
      : !knownSongs.has(item.itemId));
    if (invalid.length > 0) {
      throw new ApiError(422, "UNPROCESSABLE", "Playlist items must reference existing themes or ready Related songs.");
    }
  }

  private async knownReadyRelatedSongIds(songIds: number[], db: DbOrTx = this.db): Promise<Set<number>> {
    if (songIds.length === 0) return new Set();
    const rows = await db
      .selectDistinct({ id: songs.id })
      .from(songs)
      .innerJoin(releaseTracks, eq(releaseTracks.songId, songs.id))
      .innerJoin(animeMusicReleases, eq(animeMusicReleases.releaseId, releaseTracks.releaseId))
      .innerJoin(musicReleases, and(eq(musicReleases.id, releaseTracks.releaseId), isNull(musicReleases.deletedAt)))
      .innerJoin(musicAcquisitions, and(
        eq(musicAcquisitions.animethemesAnimeId, animeMusicReleases.animethemesAnimeId),
        eq(musicAcquisitions.releaseId, releaseTracks.releaseId),
        eq(musicAcquisitions.purpose, "RELATED_RELEASE"),
        eq(musicAcquisitions.state, "READY"),
      ))
      .innerJoin(mediaFiles, and(
        eq(mediaFiles.kind, "AUDIO"),
        eq(mediaFiles.variant, "ORIGINAL"),
        eq(mediaFiles.state, "READY"),
        sql`${mediaFiles.refId} = ('song:' || ${songs.id}::text)`,
      ))
      .where(and(inArray(songs.id, songIds), isNull(songs.deletedAt)));
    return new Set(rows.map((row) => row.id));
  }

  private async knownActiveThemeIds(themeIds: number[], db: DbOrTx = this.db): Promise<Set<number>> {
    if (themeIds.length === 0) return new Set();
    const rows = await db
      .select({ id: themes.id })
      .from(themes)
      .where(and(inArray(themes.id, themeIds), isNull(themes.deletedAt)));
    return new Set(rows.map((row) => row.id));
  }

  private async playlistRequiresNewClient(playlistId: number, db: DbOrTx = this.db): Promise<boolean> {
    const rows = await db
      .select({ itemType: playlistEntries.itemType, modeOverride: playlistEntries.modeOverride })
      .from(playlistEntries)
      .where(eq(playlistEntries.playlistId, playlistId));
    return rows.some((row) => row.itemType === "SONG" || row.modeOverride !== null);
  }

  private async knownThemeIds(themeIds: number[], db: DbOrTx = this.db): Promise<Set<number>> {
    const ids = uniqueNumbers(themeIds);
    if (ids.length === 0) return new Set();
    const rows = await db
      .select({ id: themes.id })
      .from(themes)
      .where(inArray(themes.id, ids));
    return new Set(rows.map((row) => row.id));
  }

  private async findMutablePlaylist(userId: string, id: number): Promise<boolean> {
    return (await this.mutablePlaylistRow(userId, id)) !== null;
  }

  /** A user-owned, non-auto (manual or dynamic), non-deleted playlist row, or null. */
  private async mutablePlaylistRow(
    userId: string,
    id: number,
  ): Promise<{ id: number; mutationUpdatedAt: Date } | null> {
    const rows = await this.db
      .select({ id: playlists.id, mutationUpdatedAt: playlists.mutationUpdatedAt })
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
    return rows[0] ?? null;
  }

  private async findPlaylist(userId: string, id: number): Promise<PlaylistDto | null> {
    const rows = await this.db
      .select(playlistColumns)
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
    if (rows[0]?.kitsuId) return rows[0].kitsuId;

    const existingAnimeThemes = await this.db
      .select({ id: animethemesAnime.id })
      .from(animethemesAnime)
      .where(eq(animethemesAnime.id, animeThemesId))
      .limit(1);
    return existingAnimeThemes.length > 0 ? syntheticKitsuId(animeThemesId) : null;
  }

  private async catalogAnime(kitsuIdOrAnimeThemesId: string): Promise<{ anime: LibraryAnimeDto; themes: LibraryThemeDto[] } | null> {
    const byKitsu = await this.catalogAnimeByKitsuId(kitsuIdOrAnimeThemesId);
    if (byKitsu) return byKitsu;

    if (!/^\d+$/.test(kitsuIdOrAnimeThemesId)) return null;
    return this.catalogAnimeByAnimeThemesId(Number(kitsuIdOrAnimeThemesId));
  }

  private async catalogAnimeByKitsuId(kitsuId: string): Promise<{ anime: LibraryAnimeDto; themes: LibraryThemeDto[] } | null> {
    const rows = await this.db
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
        updatedAt: kitsuAnime.updatedAt,
      })
      .from(kitsuAnime)
      .where(and(eq(kitsuAnime.kitsuId, kitsuId), isNull(kitsuAnime.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row || row.animeThemesId === null) return null;
    return {
      anime: catalogKitsuAnimeDto(row),
      themes: await this.catalogThemes([{ kitsuId, animeThemesId: row.animeThemesId }]),
    };
  }

  private async catalogAnimeByAnimeThemesId(animeThemesId: number): Promise<{ anime: LibraryAnimeDto; themes: LibraryThemeDto[] } | null> {
    const kitsuRows = await this.db
      .select({ kitsuId: kitsuAnime.kitsuId })
      .from(kitsuAnime)
      .where(and(eq(kitsuAnime.animethemesAnimeId, animeThemesId), isNull(kitsuAnime.deletedAt)))
      .orderBy(asc(kitsuAnime.kitsuId))
      .limit(1);
    const kitsuId = kitsuRows[0]?.kitsuId;
    if (kitsuId) return this.catalogAnimeByKitsuId(kitsuId);

    const rows = await this.db
      .select({
        id: animethemesAnime.id,
        name: animethemesAnime.name,
        nameEn: animethemesAnime.nameEn,
        coverUrl: animethemesAnime.coverUrl,
        syncedAt: animethemesAnime.syncedAt,
      })
      .from(animethemesAnime)
      .where(eq(animethemesAnime.id, animeThemesId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const syntheticKitsuId = `animethemes-${row.id}`;
    return {
      anime: {
        kitsuId: syntheticKitsuId,
        animeThemesId: row.id,
        title: row.nameEn ?? row.name,
        titleEn: row.nameEn,
        titleRomaji: null,
        titleJa: null,
        posterUrl: null,
        coverUrl: null,
        watchingStatus: null,
        subtype: null,
        startDate: null,
        endDate: null,
        episodeCount: null,
        ageRating: null,
        averageRating: null,
        userRating: null,
        libraryUpdatedAt: null,
        slug: null,
        genres: [],
        updatedAt: dateMillis(row.syncedAt) ?? 0,
        deleted: false,
      },
      themes: await this.catalogThemes([{ kitsuId: syntheticKitsuId, animeThemesId: row.id }]),
    };
  }

  private async catalogThemes(
    mappings: Array<{ kitsuId: string; animeThemesId: number }>,
  ): Promise<LibraryThemeDto[]> {
    const animeThemesIds = uniqueNumbers(mappings.map((row) => row.animeThemesId));
    if (animeThemesIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: themes.id,
        animeThemesAnimeId: themes.animethemesAnimeId,
        title: themes.title,
        themeType: themes.themeType,
        durationSeconds: themes.durationSeconds,
        updatedAt: themes.updatedAt,
        deletedAt: themes.deletedAt,
      })
      .from(themes)
      .where(and(inArray(themes.animethemesAnimeId, animeThemesIds), isNull(themes.deletedAt)))
      .orderBy(asc(themes.id));
    const themeIds = rows.map((row) => row.id);
    const artists = await this.themeArtistMap(themeIds);
    const media = await this.audioMediaMap(themeIds);
    const catalogModes = await this.themeCatalogModes(themeIds);
    const kitsuIdsByAnimeThemesId = mappings.reduce((map, row) => {
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
        videoUrl: null,
        audioState: audioState(audio?.state ?? null),
        durationSeconds: row.durationSeconds,
        fileSize: audio?.byteSize ?? null,
        mediaModes: {
          tvSize: { url: `/v1/media/audio/${row.id}`, durationSeconds: row.durationSeconds, fileSize: audio?.byteSize ?? null },
          fullSize: catalogModes.full.get(row.id) ?? null,
          video: catalogModes.video.get(row.id) ?? null,
        },
        updatedAt: dateMillis(row.updatedAt) ?? 0,
        deleted: false,
      };
    });
  }

  /**
   * Checks whether the listener-facing Related-music snapshot changed since a
   * cursor. The actual refresh remains a single set-based catalog query; this
   * bounded existence check prevents repeatedly rebuilding it on every normal
   * library poll.
   */
  private async musicCatalogChanged(userId: string, sinceDate: Date): Promise<boolean> {
    if (!this.musicCatalogEnabled) return false;
    const rows = await this.db
      .select({ kitsuId: libraryEntries.kitsuId })
      .from(libraryEntries)
      .innerJoin(kitsuAnime, eq(kitsuAnime.kitsuId, libraryEntries.kitsuId))
      .leftJoin(animeMusicReleases, eq(animeMusicReleases.animethemesAnimeId, kitsuAnime.animethemesAnimeId))
      .leftJoin(musicReleases, eq(musicReleases.id, animeMusicReleases.releaseId))
      .leftJoin(releaseTracks, eq(releaseTracks.releaseId, musicReleases.id))
      .leftJoin(songs, eq(songs.id, releaseTracks.songId))
      .leftJoin(mediaFiles, and(
        eq(mediaFiles.kind, "AUDIO"),
        eq(mediaFiles.variant, "ORIGINAL"),
        sql`${mediaFiles.refId} = ('song:' || ${songs.id}::text)`,
      ))
      .leftJoin(musicAcquisitions, and(
        eq(musicAcquisitions.animethemesAnimeId, kitsuAnime.animethemesAnimeId),
        eq(musicAcquisitions.releaseId, musicReleases.id),
        eq(musicAcquisitions.purpose, "RELATED_RELEASE"),
      ))
      .where(and(
        eq(libraryEntries.userId, userId),
        or(
          gt(libraryEntries.updatedAt, sinceDate),
          gt(libraryEntries.deletedAt, sinceDate),
          gt(kitsuAnime.updatedAt, sinceDate),
          gt(kitsuAnime.deletedAt, sinceDate),
          gt(animeMusicReleases.updatedAt, sinceDate),
          gt(musicReleases.updatedAt, sinceDate),
          gt(musicReleases.deletedAt, sinceDate),
          gt(songs.updatedAt, sinceDate),
          gt(songs.deletedAt, sinceDate),
          gt(mediaFiles.updatedAt, sinceDate),
          gt(musicAcquisitions.updatedAt, sinceDate),
        )!,
      ))
      .limit(1);
    return rows.length > 0;
  }

  private async readyMusicReleases(animeThemesIds?: number[], releaseId?: number): Promise<MusicReleaseDto[]> {
    const rows = await this.readyMusicRows(animeThemesIds, releaseId);
    return musicReleasesFromRows(rows);
  }

  private async themeCatalogModes(themeIds: number[]) {
    const full = new Map<number, { songId: number; url: string; durationSeconds: number | null; fileSize: number | null; sourceReleaseId: number | null }>();
    const video = new Map<number, { url: string; mimeType: string | null; spoiler: boolean; nsfw: boolean; entryVersion: number | null }>();
    if (!this.musicCatalogEnabled || themeIds.length === 0) return { full, video };

    const fullRows = await this.db
      .selectDistinct({
        themeId: themeFullSongs.themeId,
        songId: themeFullSongs.songId,
        sourceReleaseId: themeFullSongs.sourceReleaseId,
        durationSeconds: songs.durationSeconds,
        fileSize: mediaFiles.byteSize,
      })
      .from(themeFullSongs)
      .innerJoin(songs, and(eq(songs.id, themeFullSongs.songId), isNull(songs.deletedAt)))
      .innerJoin(musicReleases, and(
        eq(musicReleases.id, themeFullSongs.sourceReleaseId),
        isNull(musicReleases.deletedAt),
      ))
      .innerJoin(musicAcquisitions, and(
        eq(musicAcquisitions.themeId, themeFullSongs.themeId),
        eq(musicAcquisitions.songId, themeFullSongs.songId),
        eq(musicAcquisitions.releaseId, themeFullSongs.sourceReleaseId),
        eq(musicAcquisitions.purpose, "FULL_SIZE"),
        eq(musicAcquisitions.state, "READY"),
      ))
      .innerJoin(mediaFiles, and(
        eq(mediaFiles.kind, "AUDIO"),
        eq(mediaFiles.variant, "ORIGINAL"),
        eq(mediaFiles.state, "READY"),
        sql`${mediaFiles.refId} = ('song:' || ${songs.id}::text)`,
      ))
      .where(inArray(themeFullSongs.themeId, themeIds))
      .orderBy(asc(themeFullSongs.themeId));
    for (const row of fullRows) {
      if (!full.has(row.themeId)) {
        full.set(row.themeId, {
          songId: row.songId,
          url: `/v1/media/songs/${row.songId}/audio`,
          durationSeconds: row.durationSeconds,
          fileSize: row.fileSize,
          sourceReleaseId: row.sourceReleaseId,
        });
      }
    }

    const videoRows = await this.db
      .select({
        themeId: themeVideoSources.themeId,
        url: themeVideoSources.link,
        mimeType: themeVideoSources.mimeType,
        spoiler: themeVideoSources.spoiler,
        nsfw: themeVideoSources.nsfw,
        entryVersion: themeVideoSources.entryVersion,
      })
      .from(themeVideoSources)
      .where(inArray(themeVideoSources.themeId, themeIds))
      .orderBy(asc(themeVideoSources.themeId), asc(themeVideoSources.preferenceRank), asc(themeVideoSources.animethemesVideoId));
    for (const row of videoRows) {
      if (!video.has(row.themeId)) video.set(row.themeId, row);
    }
    return { full, video };
  }

  private async readyMusicRows(
    animeThemesIds?: number[],
    releaseId?: number,
    options?: { normalizedQuery?: string; limit?: number; releaseIds?: number[] },
  ) {
    const conditions = [
      eq(musicAcquisitions.purpose, "RELATED_RELEASE"),
      eq(musicAcquisitions.state, "READY"),
      eq(mediaFiles.kind, "AUDIO"),
      eq(mediaFiles.variant, "ORIGINAL"),
      eq(mediaFiles.state, "READY"),
      isNull(musicReleases.deletedAt),
      isNull(songs.deletedAt),
    ];
    if (animeThemesIds) conditions.push(inArray(animeMusicReleases.animethemesAnimeId, animeThemesIds));
    if (releaseId !== undefined) conditions.push(eq(musicReleases.id, releaseId));
    if (options?.releaseIds && options.releaseIds.length > 0) {
      conditions.push(inArray(musicReleases.id, options.releaseIds));
    }
    if (options?.normalizedQuery) conditions.push(readyMusicSearchPredicate(options.normalizedQuery));
    const query = this.db
      .select({
        animeThemesId: animeMusicReleases.animethemesAnimeId,
        kitsuId: kitsuAnime.kitsuId,
        animeTitle: kitsuAnime.title,
        animeTitleEn: kitsuAnime.titleEn,
        animeTitleRomaji: kitsuAnime.titleRomaji,
        animeTitleJa: kitsuAnime.titleJa,
        animePosterUrl: kitsuAnime.posterUrl,
        animePosterUrlLarge: kitsuAnime.posterUrlLarge,
        releaseId: musicReleases.id,
        releaseTitle: musicReleases.title,
        releaseTitleEnglish: musicReleases.titleEnglish,
        releaseTitleRomaji: musicReleases.titleRomaji,
        releaseTitleJapanese: musicReleases.titleJapanese,
        releaseArtistCredit: musicReleases.artistCredit,
        releaseArtistNames: musicReleases.artistNames,
        relationshipType: animeMusicReleases.relationshipType,
        releaseDate: musicReleases.releaseDate,
        artworkUrl: musicReleases.artworkUrl,
        songId: songs.id,
        songTitle: songs.title,
        songTitleEnglish: songs.titleEnglish,
        songTitleRomaji: songs.titleRomaji,
        songTitleJapanese: songs.titleJapanese,
        songArtistCredit: songs.artistCredit,
        songArtistNames: songs.artistNames,
        durationSeconds: songs.durationSeconds,
        fileSize: mediaFiles.byteSize,
        discNumber: releaseTracks.discNumber,
        trackNumber: releaseTracks.trackNumber,
        displayOrder: releaseTracks.displayOrder,
      })
      .from(animeMusicReleases)
      .innerJoin(musicReleases, eq(musicReleases.id, animeMusicReleases.releaseId))
      .innerJoin(releaseTracks, eq(releaseTracks.releaseId, musicReleases.id))
      .innerJoin(songs, eq(songs.id, releaseTracks.songId))
      .innerJoin(kitsuAnime, and(eq(kitsuAnime.animethemesAnimeId, animeMusicReleases.animethemesAnimeId), isNull(kitsuAnime.deletedAt)))
      .innerJoin(mediaFiles, and(
        eq(mediaFiles.kind, "AUDIO"),
        eq(mediaFiles.variant, "ORIGINAL"),
        sql`${mediaFiles.refId} = ('song:' || ${songs.id}::text)`,
      ))
      .innerJoin(musicAcquisitions, and(
        eq(musicAcquisitions.animethemesAnimeId, animeMusicReleases.animethemesAnimeId),
        eq(musicAcquisitions.releaseId, musicReleases.id),
      ))
      .where(and(...conditions))
      .orderBy(
        asc(musicReleases.id),
        asc(releaseTracks.discNumber),
        asc(sql`COALESCE(${releaseTracks.trackNumber}, 2147483647)`),
        asc(releaseTracks.displayOrder),
        asc(songs.id)
      );
    return options?.limit === undefined ? query : query.limit(options.limit);
  }
}

type ReadyMusicRow = Awaited<ReturnType<DrizzleClientApiService["readyMusicRows"]>>[number];

function musicReleasesFromRows(rows: ReadyMusicRow[]): MusicReleaseDto[] {
  const releases = new Map<number, MusicReleaseDto>();
  const seenSongs = new Map<number, Set<number>>();
  for (const row of rows) {
    let release = releases.get(row.releaseId);
    if (!release) {
      release = {
        id: row.releaseId,
        title: row.releaseTitle,
        titleEnglish: row.releaseTitleEnglish,
        titleRomaji: row.releaseTitleRomaji,
        titleJapanese: row.releaseTitleJapanese,
        artistCredit: row.releaseArtistCredit,
        artistNames: row.releaseArtistNames,
        relationshipType: row.relationshipType,
        releaseDate: row.releaseDate,
        year: releaseYear(row.releaseDate),
        artworkUrl: row.artworkUrl,
        tracks: [],
      };
      releases.set(row.releaseId, release);
      seenSongs.set(row.releaseId, new Set());
    }
    if (!seenSongs.get(row.releaseId)!.has(row.songId)) {
      release.tracks.push(musicTrackDto(row));
      seenSongs.get(row.releaseId)!.add(row.songId);
    }
  }
  return [...releases.values()];
}

function musicTrackDto(row: ReadyMusicRow) {
  return {
    id: row.songId,
    title: row.songTitle,
    titleEnglish: row.songTitleEnglish,
    titleRomaji: row.songTitleRomaji,
    titleJapanese: row.songTitleJapanese,
    artistCredit: row.songArtistCredit,
    artistNames: row.songArtistNames,
    durationSeconds: row.durationSeconds,
    audioUrl: `/v1/media/songs/${row.songId}/audio`,
    fileSize: row.fileSize,
    discNumber: row.discNumber,
    trackNumber: row.trackNumber,
    displayOrder: row.displayOrder,
  };
}

function musicAnimeSummary(row: ReadyMusicRow) {
  return {
    kitsuId: row.kitsuId,
    title: row.animeTitle,
    titleEn: row.animeTitleEn,
    posterUrl: row.animePosterUrl || row.animePosterUrlLarge
      ? `/v1/media/images/anime/${row.kitsuId}/poster`
      : null,
  };
}

function musicOwnership(row: ReadyMusicRow) {
  return { ...musicAnimeSummary(row), relationshipType: row.relationshipType };
}

function releaseYear(value: string | null): number | null {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function matchesNormalizedSearch(row: ReadyMusicRow, query: string, includeTrack: boolean): boolean {
  const values = [
    row.releaseTitle,
    row.releaseArtistCredit,
    row.animeTitle,
    row.animeTitleEn,
    row.animeTitleRomaji,
    row.animeTitleJa,
    ...(includeTrack ? [row.songTitle, row.songArtistCredit] : []),
  ];
  return values.some((value) => value !== null && normalizeMusicText(value).includes(query));
}

/**
 * Music release/song titles have durable normalized columns. Other listener
 * text remains source-faithful, so normalize punctuation/case in PostgreSQL as
 * a broad, bounded candidate filter and retain the exact JS normalizer above
 * as the final predicate. `LIKE` metacharacters are escaped first.
 */
function readyMusicSearchPredicate(normalizedQuery: string) {
  const pattern = `%${escapeLike(normalizedQuery)}%`;
  return or(
    sql`${musicReleases.normalizedTitle} LIKE ${pattern} ESCAPE '\\'`,
    sql`${songs.normalizedTitle} LIKE ${pattern} ESCAPE '\\'`,
    sql`${songs.normalizedArtist} LIKE ${pattern} ESCAPE '\\'`,
    normalizedCatalogTextLike(musicReleases.title, pattern),
    normalizedCatalogTextLike(musicReleases.titleEnglish, pattern),
    normalizedCatalogTextLike(musicReleases.titleRomaji, pattern),
    normalizedCatalogTextLike(musicReleases.titleJapanese, pattern),
    normalizedCatalogTextLike(musicReleases.artistCredit, pattern),
    normalizedCatalogTextLike(songs.title, pattern),
    normalizedCatalogTextLike(songs.titleEnglish, pattern),
    normalizedCatalogTextLike(songs.titleRomaji, pattern),
    normalizedCatalogTextLike(songs.titleJapanese, pattern),
    normalizedCatalogTextLike(songs.artistCredit, pattern),
    normalizedCatalogTextLike(kitsuAnime.title, pattern),
    normalizedCatalogTextLike(kitsuAnime.titleEn, pattern),
    normalizedCatalogTextLike(kitsuAnime.titleRomaji, pattern),
    normalizedCatalogTextLike(kitsuAnime.titleJa, pattern),
  )!;
}

function normalizedCatalogTextLike(column: unknown, pattern: string) {
  // The matching migration installs PostgreSQL's trusted `unaccent` module.
  // NFKD + unaccent + NFKC is intentionally a *superset* of the JavaScript
  // normalizer (which only strips Latin marks), so the final JS predicate can
  // reject broad candidates but never misses Cafe/Café or full-width text.
  return sql`lower(regexp_replace(normalize(unaccent(normalize(coalesce(${column}, '')::text, NFKD)), NFKC), '[^[:alnum:]]+', ' ', 'g')) LIKE ${pattern} ESCAPE '\\'`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function uniqueAnimeSummaries(rows: ReadyMusicRow[]) {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.kitsuId)) return [];
    seen.add(row.kitsuId);
    return [musicOwnership(row)];
  });
}

const libraryAnimeColumns = {
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
} as const;

type LibraryAnimeRow = {
  kitsuId: string;
  animeThemesId: number | null;
  title: string | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  posterOriginUrl: string | null;
  posterLargeOriginUrl: string | null;
  coverOriginUrl: string | null;
  coverLargeOriginUrl: string | null;
  subtype: string | null;
  startDate: string | null;
  endDate: string | null;
  episodeCount: number | null;
  ageRating: string | null;
  averageRating: number | null;
  slug: string | null;
  animeUpdatedAt: Date | string | null;
  animeDeletedAt: Date | string | null;
  watchingStatus: string | null;
  userRating: number | null;
  libraryUpdatedAt: Date | string | null;
  libraryEntryUpdatedAt: Date | string | null;
  libraryDeletedAt: Date | string | null;
};

function libraryAnimeDto(row: LibraryAnimeRow, genres: string[]): LibraryAnimeDto {
  return {
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
    genres,
    updatedAt: Math.max(dateMillis(row.libraryEntryUpdatedAt) ?? 0, dateMillis(row.animeUpdatedAt) ?? 0),
    deleted: row.libraryDeletedAt !== null || row.animeDeletedAt !== null,
  };
}

function normalizedPrefPatch(patch: ThemePrefPatch, now: Date): Partial<typeof themePrefs.$inferInsert> {
  const set: Partial<typeof themePrefs.$inferInsert> = { updatedAt: now };
  if (patch.liked !== undefined) {
    set.liked = patch.liked;
    if (patch.liked) {
      set.disliked = false;
      set.dislikedTvSize = false;
      set.dislikedFullSize = false;
    }
  }
  if (patch.disliked !== undefined) {
    set.disliked = patch.disliked;
    if (patch.disliked) {
      set.liked = false;
      set.dislikedTvSize = false;
      set.dislikedFullSize = false;
    }
  }
  if (patch.dislikedTvSize !== undefined) {
    set.dislikedTvSize = patch.dislikedTvSize;
    if (patch.dislikedTvSize) { set.liked = false; set.disliked = false; }
  }
  if (patch.dislikedFullSize !== undefined) {
    set.dislikedFullSize = patch.dislikedFullSize;
    if (patch.dislikedFullSize) { set.liked = false; set.disliked = false; }
  }
  return set;
}

function normalizedSongPrefPatch(patch: SongPrefPatch, now: Date): Partial<typeof songPrefs.$inferInsert> {
  const set: Partial<typeof songPrefs.$inferInsert> = { updatedAt: now };
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

function songPrefDto(row: {
  songId: number; liked: boolean; disliked: boolean; playCount: number;
  lastPlayedAt: Date | null; updatedAt: Date; deletedAt: Date | null;
}): SongPrefDto {
  return {
    songId: row.songId,
    liked: row.liked,
    disliked: row.disliked,
    playCount: row.playCount,
    lastPlayedAt: dateMillis(row.lastPlayedAt),
    updatedAt: Math.max(dateMillis(row.updatedAt) ?? 0, dateMillis(row.deletedAt) ?? 0),
    deleted: row.deletedAt !== null,
  };
}

function normalizeLegacyImportEntries(payload: LegacyLibraryImportPayload): LegacyLibraryImportPayload["entries"] {
  const byThemeId = new Map<number, LegacyLibraryImportPayload["entries"][number]>();
  for (const entry of payload.entries) {
    if (!Number.isInteger(entry.themeId) || entry.themeId <= 0) continue;
    if (entry.liked && entry.disliked) continue;
    const playCount = Math.max(0, Math.floor(entry.playCount));
    const normalized = {
      themeId: entry.themeId,
      liked: entry.liked,
      disliked: entry.disliked,
      playCount,
      lastPlayedAt: playCount > 0 ? entry.lastPlayedAt ?? null : null,
    };
    if (!normalized.liked && !normalized.disliked && normalized.playCount === 0) continue;
    byThemeId.set(normalized.themeId, normalized);
  }
  return [...byThemeId.values()];
}

function normalizePlayInput(play: PlayInput) {
  return "themeId" in play
    ? { clientEventId: `legacy:${randomUUID()}`, itemType: "THEME" as const, itemId: play.themeId, actualMode: "TV_SIZE" as const, playedAt: play.playedAt }
    : play;
}

type NormalizedPlayInput = ReturnType<typeof normalizePlayInput>;

function dedupePlayInputs(plays: NormalizedPlayInput[]): NormalizedPlayInput[] {
  const unique = new Map<string, NormalizedPlayInput>();
  for (const play of plays) {
    const previous = unique.get(play.clientEventId);
    if (previous && !samePlayEvent(play, previous)) {
      throw new ApiError(409, "PLAY_EVENT_ID_CONFLICT", "clientEventId must identify one stable play event.");
    }
    if (!previous) unique.set(play.clientEventId, play);
  }
  return [...unique.values()];
}

function samePlayEvent(
  incoming: NormalizedPlayInput,
  stored: { itemType: "THEME" | "SONG"; itemId: number; actualMode: "TV_SIZE" | "FULL_SIZE" | "VIDEO" | "AUDIO"; playedAt: Date } | NormalizedPlayInput,
): boolean {
  const storedPlayedAt = stored.playedAt instanceof Date ? stored.playedAt.getTime() : stored.playedAt;
  return incoming.itemType === stored.itemType
    && incoming.itemId === stored.itemId
    && incoming.actualMode === stored.actualMode
    && incoming.playedAt === storedPlayedAt;
}

function groupInsertedPlays(plays: Array<{ itemId: number; playedAt: Date }>) {
  const map = new Map<number, { itemId: number; count: number; lastPlayedAt: Date }>();
  for (const play of plays) {
    const existing = map.get(play.itemId) ?? {
      itemId: play.itemId,
      count: 0,
      lastPlayedAt: play.playedAt,
    };
    existing.count += 1;
    if (play.playedAt > existing.lastPlayedAt) existing.lastPlayedAt = play.playedAt;
    map.set(play.itemId, existing);
  }
  return [...map.values()];
}

const playlistColumns = {
  id: playlists.id,
  name: playlists.name,
  defaultMode: playlists.defaultMode,
  isAuto: playlists.isAuto,
  isDynamic: playlists.isDynamic,
  autoUpdate: playlists.dynamicAutoUpdate,
  updatedAt: playlists.updatedAt,
  deletedAt: playlists.deletedAt,
  dynamicSpecJson: playlists.dynamicSpecJson,
  dynamicSortJson: playlists.dynamicSortJson,
} as const;

function playlistDto(
  row: {
    id: number;
    name: string;
    defaultMode: "TV_SIZE" | "FULL_SIZE";
    isAuto: boolean;
    isDynamic: boolean;
    autoUpdate: boolean;
    updatedAt: Date;
    deletedAt: Date | null;
    dynamicSpecJson: string | null;
    dynamicSortJson: string | null;
  },
  items: PlaylistItemDto[],
): PlaylistDto {
  return {
    id: row.id,
    name: row.name,
    entries: items.flatMap((item) => item.itemType === "THEME" ? [item.itemId] : []),
    defaultMode: row.defaultMode,
    items,
    isAuto: row.isAuto,
    isDynamic: row.isDynamic,
    autoUpdate: row.autoUpdate,
    updatedAt: Math.max(dateMillis(row.updatedAt) ?? 0, dateMillis(row.deletedAt) ?? 0),
    deleted: row.deletedAt !== null,
    dynamicSpecJson: parseSpec(row.dynamicSpecJson),
    dynamicSortJson: parseSpec(row.dynamicSortJson),
  };
}

function catalogKitsuAnimeDto(row: {
  kitsuId: string;
  animeThemesId: number | null;
  title: string | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  posterOriginUrl: string | null;
  posterLargeOriginUrl: string | null;
  coverOriginUrl: string | null;
  coverLargeOriginUrl: string | null;
  subtype: string | null;
  startDate: string | null;
  endDate: string | null;
  episodeCount: number | null;
  ageRating: string | null;
  averageRating: number | null;
  slug: string | null;
  updatedAt: Date | string | null;
}): LibraryAnimeDto {
  return {
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
    watchingStatus: null,
    subtype: row.subtype,
    startDate: row.startDate,
    endDate: row.endDate,
    episodeCount: row.episodeCount,
    ageRating: row.ageRating,
    averageRating: row.averageRating,
    userRating: null,
    libraryUpdatedAt: null,
    slug: row.slug,
    genres: [],
    updatedAt: dateMillis(row.updatedAt) ?? 0,
    deleted: false,
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

function preferredKitsuIdByAnimeThemesId(
  rows: Array<{ kitsuId: string; animeThemesId: number | null }>,
): Map<number, string> {
  const grouped = new Map<number, string[]>();
  for (const row of rows) {
    if (row.animeThemesId === null) continue;
    const ids = grouped.get(row.animeThemesId) ?? [];
    ids.push(row.kitsuId);
    grouped.set(row.animeThemesId, ids);
  }
  return new Map(
    [...grouped.entries()].map(([animeThemesId, kitsuIds]) => [
      animeThemesId,
      kitsuIds.sort(preferRealKitsuId)[0]!,
    ]),
  );
}

function preferRealKitsuId(a: string, b: string): number {
  const aSynthetic = a.startsWith("animethemes-");
  const bSynthetic = b.startsWith("animethemes-");
  if (aSynthetic !== bSynthetic) return aSynthetic ? 1 : -1;
  return a.localeCompare(b);
}

function syntheticKitsuId(animeThemesId: number): string {
  return `animethemes-${animeThemesId}`;
}
