import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "./errors.js";
import { makeRequireAuth } from "./requireAuth.js";

export type AudioState = "READY" | "PENDING" | "FAILED" | "MISSING";

export interface MusicTrackDto {
  id: number;
  title: string;
  artistCredit: string;
  durationSeconds: number | null;
  audioUrl: string;
  fileSize: number | null;
  discNumber: number;
  trackNumber: number | null;
  displayOrder: number;
}

export interface MusicReleaseDto {
  id: number;
  title: string;
  artistCredit: string;
  relationshipType: string;
  releaseDate: string | null;
  year: number | null;
  artworkUrl: string | null;
  tracks: MusicTrackDto[];
  anime?: Array<MusicAnimeSummaryDto & { relationshipType: string }>;
}

export interface MusicAnimeSummaryDto {
  kitsuId: string;
  title: string | null;
  titleEn: string | null;
  posterUrl: string | null;
}

export interface AnimeMusicDto {
  anime: MusicAnimeSummaryDto;
  releases: MusicReleaseDto[];
}

export interface ThemeMediaModesDto {
  tvSize: { url: string; durationSeconds: number | null; fileSize: number | null };
  fullSize: { songId: number; url: string; durationSeconds: number | null; fileSize: number | null; sourceReleaseId: number | null } | null;
  video: { url: string; mimeType: string | null; spoiler: boolean; nsfw: boolean; entryVersion: number | null } | null;
}

export interface LibraryAnimeDto {
  kitsuId: string;
  animeThemesId: number | null;
  title: string | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  posterUrl: string | null;
  coverUrl: string | null;
  watchingStatus: string | null;
  subtype: string | null;
  startDate: string | null;
  endDate: string | null;
  episodeCount: number | null;
  ageRating: string | null;
  averageRating: number | null;
  userRating: number | null;
  libraryUpdatedAt: number | null;
  slug: string | null;
  genres: string[];
  updatedAt: number;
  deleted: boolean;
}

export interface LibraryThemeDto {
  id: number;
  animeThemesAnimeId: number;
  kitsuAnimeIds: string[];
  title: string;
  themeType: string | null;
  artists: Array<{ name: string; asCharacter: string | null; alias: string | null }>;
  audioUrl: string;
  videoUrl: string | null;
  audioState: AudioState;
  durationSeconds: number | null;
  fileSize: number | null;
  mediaModes: ThemeMediaModesDto;
  updatedAt: number;
  deleted: boolean;
}

export interface LibraryResponse {
  serverTime: number;
  anime: LibraryAnimeDto[];
  themes: LibraryThemeDto[];
}

export interface ThemePrefDto {
  themeId: number;
  liked: boolean;
  disliked: boolean;
  playCount: number;
  lastPlayedAt: number | null;
  updatedAt: number;
  deleted: boolean;
}

export interface ThemePrefPatch {
  liked?: boolean | undefined;
  disliked?: boolean | undefined;
  // Client op-timestamp (epoch ms) of when the user made this change; drives last-write-wins.
  opTs?: number | undefined;
}

export interface PlaylistDto {
  id: number;
  name: string;
  entries: number[];
  defaultMode: PlaylistPlaybackMode;
  items: PlaylistItemDto[];
  isAuto: boolean;
  isDynamic: boolean;
  autoUpdate: boolean;
  updatedAt: number;
  deleted: boolean;
  dynamicSpecJson: unknown | null;
  dynamicSortJson: unknown | null;
}

export type PlaylistPlaybackMode = "TV_SIZE" | "FULL_SIZE";
export type PlaylistItemInput =
  | { entryId?: number | undefined; itemType: "THEME"; itemId: number; modeOverride?: PlaylistPlaybackMode | null | undefined }
  | { entryId?: number | undefined; itemType: "SONG"; itemId: number; modeOverride?: null | undefined };
export interface PlaylistItemDto {
  entryId: number;
  itemType: "THEME" | "SONG";
  itemId: number;
  modeOverride: PlaylistPlaybackMode | null;
}

export interface PlaylistInput {
  name?: string | undefined;
  entries?: number[] | undefined;
  defaultMode?: PlaylistPlaybackMode | undefined;
  items?: PlaylistItemInput[] | undefined;
  dynamicSpecJson?: unknown;
  dynamicSortJson?: unknown;
  autoUpdate?: boolean | undefined;
  opTs?: number | undefined;
}

export interface PlaylistCreateInput {
  name: string;
  entries?: number[] | undefined;
  defaultMode?: PlaylistPlaybackMode | undefined;
  items?: PlaylistItemInput[] | undefined;
  dynamicSpecJson?: unknown;
  dynamicSortJson?: unknown;
  autoUpdate?: boolean | undefined;
  opTs?: number | undefined;
}

export interface ChangesResponse {
  serverTime: number;
  anime: LibraryAnimeDto[];
  themes: LibraryThemeDto[];
  prefs: ThemePrefDto[];
  playlists: PlaylistDto[];
  musicCatalog: AnimeMusicDto[];
}

export interface ClientApiService {
  getLibrary(userId: string, since: number | null): Promise<LibraryResponse>;
  getChanges(userId: string, since: number | null): Promise<ChangesResponse>;
  getAnime(
    userId: string,
    kitsuId: string,
  ): Promise<{ anime: LibraryAnimeDto; themes: LibraryThemeDto[] } | null>;
  getAnimeMusic(userId: string, kitsuId: string): Promise<AnimeMusicDto | null>;
  getMusicRelease(userId: string, releaseId: number): Promise<MusicReleaseDto | null>;
  getMusicCatalog(userId: string): Promise<AnimeMusicDto[]>;
  searchMusic(userId: string, query: string): Promise<{ releases: unknown[]; tracks: unknown[] }>;
  ensureLibraryForUserData(userId: string): Promise<boolean>;
  ensureLibraryForThemeIds(userId: string, themeIds: number[]): Promise<boolean>;
  addLibraryAnime(
    userId: string,
    input: { kitsuId?: string | undefined; animeThemesId?: number | undefined },
  ): Promise<{ accepted: boolean; queuedJobIds: number[] }>;
  removeLibraryAnime(userId: string, kitsuId: string): Promise<boolean>;
  getThemePrefs(userId: string, since?: number | null): Promise<ThemePrefDto[]>;
  updateThemePref(userId: string, themeId: number, patch: ThemePrefPatch): Promise<ThemePrefDto>;
  refreshAutoPlaylists(userId: string): Promise<void>;
  recordPlays(
    userId: string,
    plays: Array<{ themeId: number; playedAt: number }>,
  ): Promise<{ accepted: number }>;
  listPlaylists(
    userId: string,
    options?: { autoOnly?: boolean; since?: number | null },
  ): Promise<PlaylistDto[]>;
  createPlaylist(userId: string, input: PlaylistCreateInput): Promise<PlaylistDto>;
  updatePlaylist(userId: string, id: number, input: PlaylistInput): Promise<PlaylistDto | null>;
  updatePlaylistSpec(userId: string, id: number, spec: unknown): Promise<PlaylistDto | null>;
  deletePlaylist(userId: string, id: number, opTs?: number | null): Promise<boolean>;
}

const sinceQuery = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
});

const kitsuParams = z.object({
  kitsuId: z.string().min(1),
});

const idParams = z.object({
  id: z.coerce.number().int().positive(),
});

const releaseParams = z.object({ releaseId: z.coerce.number().int().positive() });

const manualAddBody = z
  .object({
    kitsuId: z.string().min(1).optional(),
    animeThemesId: z.number().int().positive().optional(),
  })
  .refine((value) => value.kitsuId !== undefined || value.animeThemesId !== undefined, {
    message: "kitsuId or animeThemesId is required",
  });

const prefPatchBody = z
  .object({
    liked: z.boolean().optional(),
    disliked: z.boolean().optional(),
    opTs: z.number().int().nonnegative().optional(),
  })
  .refine((value) => value.liked !== undefined || value.disliked !== undefined, {
    message: "At least one preference field is required",
  });

const playsBody = z
  .array(
    z.object({
      themeId: z.number().int().positive(),
      playedAt: z.number().int().nonnegative(),
    }),
  )
  .max(1000);

const playlistItemSchema = z.discriminatedUnion("itemType", [
  z.object({ entryId: z.number().int().positive().optional(), itemType: z.literal("THEME"), itemId: z.number().int().positive(), modeOverride: z.enum(["TV_SIZE", "FULL_SIZE"]).nullable().optional() }).strict(),
  z.object({ entryId: z.number().int().positive().optional(), itemType: z.literal("SONG"), itemId: z.number().int().positive(), modeOverride: z.null().optional() }).strict(),
]);

const playlistCreateBody = z.object({
  name: z.string().min(1).max(100),
  entries: z.array(z.number().int().positive()).optional(),
  defaultMode: z.enum(["TV_SIZE", "FULL_SIZE"]).optional(),
  items: z.array(playlistItemSchema).optional(),
  dynamicSpecJson: z.unknown().optional(),
  dynamicSortJson: z.unknown().optional(),
  autoUpdate: z.boolean().optional(),
  opTs: z.number().int().nonnegative().optional(),
}).refine((value) => value.entries === undefined || value.items === undefined, { message: "entries and items are mutually exclusive" });

const playlistUpdateBody = z
  .object({
    name: z.string().min(1).max(100).optional(),
    entries: z.array(z.number().int().positive()).optional(),
    defaultMode: z.enum(["TV_SIZE", "FULL_SIZE"]).optional(),
    items: z.array(playlistItemSchema).optional(),
    dynamicSpecJson: z.unknown().optional(),
    dynamicSortJson: z.unknown().optional(),
    autoUpdate: z.boolean().optional(),
    opTs: z.number().int().nonnegative().optional(),
  })
  .refine((value) => value.entries === undefined || value.items === undefined, { message: "entries and items are mutually exclusive" })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.entries !== undefined ||
      value.defaultMode !== undefined ||
      value.items !== undefined ||
      value.dynamicSpecJson !== undefined ||
      value.dynamicSortJson !== undefined ||
      value.autoUpdate !== undefined,
    { message: "At least one playlist field is required" },
  );

const playlistDeleteQuery = z.object({
  opTs: z.coerce.number().int().nonnegative().optional(),
});

export function registerClientRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  service: ClientApiService,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.get("/v1/library", { schema: { querystring: sinceQuery }, preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.user.kitsuUserId;
    if (await service.ensureLibraryForUserData(userId)) {
      await service.refreshAutoPlaylists(userId);
    }
    return service.getLibrary(userId, request.query.since ?? null);
  });

  // Unified delta feed: one round-trip reconciles library + prefs + playlists. `since=null`
  // is a full snapshot; `since=<cursor>` returns only rows changed after the cursor (incl.
  // tombstones). Clients persist serverTime as the next cursor.
  app.get("/v1/changes", { schema: { querystring: sinceQuery }, preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.user.kitsuUserId;
    if (await service.ensureLibraryForUserData(userId)) {
      await service.refreshAutoPlaylists(userId);
    }
    return service.getChanges(userId, request.query.since ?? null);
  });

  app.get(
    "/v1/anime/:kitsuId",
    { schema: { params: kitsuParams }, preHandler: requireAuth },
    async (request) => {
      const result = await service.getAnime(request.auth!.user.kitsuUserId, request.params.kitsuId);
      if (!result) throw new ApiError(404, "NOT_FOUND", "Anime not found.");
      return result;
    },
  );

  app.get(
    "/v1/anime/:kitsuId/music",
    { schema: { params: kitsuParams }, preHandler: requireAuth },
    async (request) => {
      const result = await service.getAnimeMusic(request.auth!.user.kitsuUserId, request.params.kitsuId);
      if (!result) throw new ApiError(404, "MUSIC_NOT_FOUND", "Ready music was not found for this anime.");
      return result;
    },
  );

  app.get(
    "/v1/music/releases/:releaseId",
    { schema: { params: releaseParams }, preHandler: requireAuth },
    async (request) => {
      const result = await service.getMusicRelease(request.auth!.user.kitsuUserId, request.params.releaseId);
      if (!result) throw new ApiError(404, "MUSIC_NOT_FOUND", "Ready music release was not found.");
      return result;
    },
  );

  app.post(
    "/v1/library/anime",
    { schema: { body: manualAddBody }, preHandler: requireAuth },
    async (request) => {
      const userId = request.auth!.user.kitsuUserId;
      const result = await service.addLibraryAnime(userId, request.body);
      await service.refreshAutoPlaylists(userId);
      return result;
    },
  );

  app.delete(
    "/v1/library/anime/:kitsuId",
    { schema: { params: kitsuParams }, preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.auth!.user.kitsuUserId;
      const removed = await service.removeLibraryAnime(
        userId,
        request.params.kitsuId,
      );
      if (!removed) throw new ApiError(404, "NOT_FOUND", "Library entry not found.");
      await service.refreshAutoPlaylists(userId);
      return reply.code(204).send();
    },
  );

  app.get(
    "/v1/prefs/themes",
    { schema: { querystring: sinceQuery }, preHandler: requireAuth },
    async (request) =>
      service.getThemePrefs(request.auth!.user.kitsuUserId, request.query.since ?? null),
  );

  app.put(
    "/v1/prefs/themes/:id",
    { schema: { params: idParams, body: prefPatchBody }, preHandler: requireAuth },
    async (request) => {
      const userId = request.auth!.user.kitsuUserId;
      await service.ensureLibraryForThemeIds(userId, [request.params.id]);
      const pref = await service.updateThemePref(userId, request.params.id, request.body);
      await service.refreshAutoPlaylists(userId);
      return pref;
    },
  );

  app.post(
    "/v1/plays",
    { schema: { body: playsBody }, preHandler: requireAuth },
    async (request) => {
      const userId = request.auth!.user.kitsuUserId;
      await service.ensureLibraryForThemeIds(userId, uniqueNumbers(request.body.map((play) => play.themeId)));
      const result = await service.recordPlays(userId, request.body);
      await service.refreshAutoPlaylists(userId);
      return result;
    },
  );

  app.get("/v1/playlists/auto", { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.user.kitsuUserId;
    if (await service.ensureLibraryForUserData(userId)) {
      await service.refreshAutoPlaylists(userId);
    }
    return service.listPlaylists(userId, { autoOnly: true });
  });

  app.get(
    "/v1/playlists",
    { schema: { querystring: sinceQuery }, preHandler: requireAuth },
    async (request) => {
      const userId = request.auth!.user.kitsuUserId;
      if (await service.ensureLibraryForUserData(userId)) {
        await service.refreshAutoPlaylists(userId);
      }
      return service.listPlaylists(userId, { since: request.query.since ?? null });
    },
  );

  app.post(
    "/v1/playlists",
    { schema: { body: playlistCreateBody }, preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.auth!.user.kitsuUserId;
      const playlist = await service.createPlaylist(userId, request.body);
      return reply.code(201).send({ playlist });
    },
  );

  app.put(
    "/v1/playlists/:id",
    { schema: { params: idParams, body: playlistUpdateBody }, preHandler: requireAuth },
    async (request) => {
      const userId = request.auth!.user.kitsuUserId;
      const playlist = await service.updatePlaylist(
        userId,
        request.params.id,
        request.body,
      );
      if (!playlist) throw new ApiError(404, "NOT_FOUND", "Playlist not found.");
      return { playlist };
    },
  );

  app.put(
    "/v1/playlists/:id/spec",
    { schema: { params: idParams, body: z.unknown() }, preHandler: requireAuth },
    async (request) => {
      const playlist = await service.updatePlaylistSpec(
        request.auth!.user.kitsuUserId,
        request.params.id,
        request.body,
      );
      if (!playlist) throw new ApiError(404, "NOT_FOUND", "Playlist not found.");
      return { playlist };
    },
  );

  app.delete(
    "/v1/playlists/:id",
    { schema: { params: idParams, querystring: playlistDeleteQuery }, preHandler: requireAuth },
    async (request, reply) => {
      const deleted = await service.deletePlaylist(
        request.auth!.user.kitsuUserId,
        request.params.id,
        request.query.opTs ?? null,
      );
      if (!deleted) throw new ApiError(404, "NOT_FOUND", "Playlist not found.");
      return reply.code(204).send();
    },
  );
}

function uniqueNumbers(items: number[]): number[] {
  return [...new Set(items.filter((item) => Number.isInteger(item) && item > 0))];
}
