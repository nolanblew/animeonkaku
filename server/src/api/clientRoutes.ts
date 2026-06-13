import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "./errors.js";
import { makeRequireAuth } from "./requireAuth.js";

export type AudioState = "READY" | "PENDING" | "FAILED" | "MISSING";

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
}

export interface ThemePrefPatch {
  liked?: boolean | undefined;
  disliked?: boolean | undefined;
}

export interface PlaylistDto {
  id: number;
  name: string;
  entries: number[];
  isAuto: boolean;
  updatedAt: number;
  dynamicSpecJson: unknown | null;
}

export interface PlaylistInput {
  name?: string | undefined;
  entries?: number[] | undefined;
  dynamicSpecJson?: unknown;
}

export interface PlaylistCreateInput {
  name: string;
  entries?: number[] | undefined;
  dynamicSpecJson?: unknown;
}

export interface ClientApiService {
  getLibrary(userId: string, since: number | null): Promise<LibraryResponse>;
  getAnime(
    userId: string,
    kitsuId: string,
  ): Promise<{ anime: LibraryAnimeDto; themes: LibraryThemeDto[] } | null>;
  addLibraryAnime(
    userId: string,
    input: { kitsuId?: string | undefined; animeThemesId?: number | undefined },
  ): Promise<{ accepted: boolean; queuedJobIds: number[] }>;
  removeLibraryAnime(userId: string, kitsuId: string): Promise<boolean>;
  getThemePrefs(userId: string): Promise<ThemePrefDto[]>;
  updateThemePref(userId: string, themeId: number, patch: ThemePrefPatch): Promise<ThemePrefDto>;
  recordPlays(
    userId: string,
    plays: Array<{ themeId: number; playedAt: number }>,
  ): Promise<{ accepted: number }>;
  listPlaylists(userId: string, options?: { autoOnly?: boolean }): Promise<PlaylistDto[]>;
  createPlaylist(userId: string, input: PlaylistCreateInput): Promise<PlaylistDto>;
  updatePlaylist(userId: string, id: number, input: PlaylistInput): Promise<PlaylistDto | null>;
  updatePlaylistSpec(userId: string, id: number, spec: unknown): Promise<PlaylistDto | null>;
  deletePlaylist(userId: string, id: number): Promise<boolean>;
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

const playlistCreateBody = z.object({
  name: z.string().min(1).max(100),
  entries: z.array(z.number().int().positive()).optional(),
  dynamicSpecJson: z.unknown().optional(),
});

const playlistUpdateBody = z
  .object({
    name: z.string().min(1).max(100).optional(),
    entries: z.array(z.number().int().positive()).optional(),
    dynamicSpecJson: z.unknown().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.entries !== undefined ||
      value.dynamicSpecJson !== undefined,
    { message: "At least one playlist field is required" },
  );

export function registerClientRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  service: ClientApiService,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.get("/v1/library", { schema: { querystring: sinceQuery }, preHandler: requireAuth }, async (request) =>
    service.getLibrary(request.auth!.user.kitsuUserId, request.query.since ?? null),
  );

  app.get(
    "/v1/anime/:kitsuId",
    { schema: { params: kitsuParams }, preHandler: requireAuth },
    async (request) => {
      const result = await service.getAnime(request.auth!.user.kitsuUserId, request.params.kitsuId);
      if (!result) throw new ApiError(404, "NOT_FOUND", "Anime not found.");
      return result;
    },
  );

  app.post(
    "/v1/library/anime",
    { schema: { body: manualAddBody }, preHandler: requireAuth },
    async (request) => service.addLibraryAnime(request.auth!.user.kitsuUserId, request.body),
  );

  app.delete(
    "/v1/library/anime/:kitsuId",
    { schema: { params: kitsuParams }, preHandler: requireAuth },
    async (request, reply) => {
      const removed = await service.removeLibraryAnime(
        request.auth!.user.kitsuUserId,
        request.params.kitsuId,
      );
      if (!removed) throw new ApiError(404, "NOT_FOUND", "Library entry not found.");
      return reply.code(204).send();
    },
  );

  app.get("/v1/prefs/themes", { preHandler: requireAuth }, async (request) =>
    service.getThemePrefs(request.auth!.user.kitsuUserId),
  );

  app.put(
    "/v1/prefs/themes/:id",
    { schema: { params: idParams, body: prefPatchBody }, preHandler: requireAuth },
    async (request) =>
      service.updateThemePref(request.auth!.user.kitsuUserId, request.params.id, request.body),
  );

  app.post(
    "/v1/plays",
    { schema: { body: playsBody }, preHandler: requireAuth },
    async (request) => service.recordPlays(request.auth!.user.kitsuUserId, request.body),
  );

  app.get("/v1/playlists/auto", { preHandler: requireAuth }, async (request) =>
    service.listPlaylists(request.auth!.user.kitsuUserId, { autoOnly: true }),
  );

  app.get("/v1/playlists", { preHandler: requireAuth }, async (request) =>
    service.listPlaylists(request.auth!.user.kitsuUserId),
  );

  app.post(
    "/v1/playlists",
    { schema: { body: playlistCreateBody }, preHandler: requireAuth },
    async (request, reply) => {
      const playlist = await service.createPlaylist(request.auth!.user.kitsuUserId, request.body);
      return reply.code(201).send({ playlist });
    },
  );

  app.put(
    "/v1/playlists/:id",
    { schema: { params: idParams, body: playlistUpdateBody }, preHandler: requireAuth },
    async (request) => {
      const playlist = await service.updatePlaylist(
        request.auth!.user.kitsuUserId,
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
    { schema: { params: idParams }, preHandler: requireAuth },
    async (request, reply) => {
      const deleted = await service.deletePlaylist(request.auth!.user.kitsuUserId, request.params.id);
      if (!deleted) throw new ApiError(404, "NOT_FOUND", "Playlist not found.");
      return reply.code(204).send();
    },
  );
}
