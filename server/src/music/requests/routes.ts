import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../../auth/service.js";
import { ApiError } from "../../api/errors.js";
import { makeRequireAuth } from "../../api/requireAuth.js";
import { MusicRequestEmptyError, MusicRequestNotFoundError, MusicRequestNotMappedError, type MusicRequestService } from "./service.js";

const animeParams = z.object({ kitsuId: z.string().min(1).max(100) });
const requestParams = z.object({ requestId: z.string().uuid() });

export function registerMusicRequestRoutes(fastify: FastifyInstance, auth: AuthService, service: Pick<MusicRequestService, "trigger" | "get" | "latest" | "status">): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(auth);
  app.post("/v1/anime/:kitsuId/music-requests", { schema: { params: animeParams }, preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await service.trigger(request.auth!.user.kitsuUserId, request.params.kitsuId, "DEBUG_USER", "FULL_SONGS");
      return reply.header("Location", `/v1/music-requests/${result.request.id}`).code(202).send(result);
    } catch (error) { throw routeError(error); }
  });
  for (const [path, scope] of [["full-songs", "FULL_SONGS"], ["extra-music", "EXTRA_MUSIC"]] as const) {
    app.post(`/v1/anime/:kitsuId/music-requests/${path}`, { schema: { params: animeParams }, preHandler: requireAuth }, async (request, reply) => {
      try {
        const result = await service.trigger(request.auth!.user.kitsuUserId, request.params.kitsuId, "DEBUG_USER", scope);
        return reply.header("Location", `/v1/music-requests/${result.request.id}`).code(202).send(result);
      } catch (error) { throw routeError(error); }
    });
  }
  app.get("/v1/music-requests/:requestId", { schema: { params: requestParams }, preHandler: requireAuth }, async (request) => {
    try { return { request: await service.get(request.auth!.user.kitsuUserId, request.params.requestId) }; }
    catch (error) { throw routeError(error); }
  });
  app.get("/v1/anime/:kitsuId/music-requests/latest", { schema: { params: animeParams }, preHandler: requireAuth }, async (request) => {
    try { return { request: await service.latest(request.params.kitsuId) }; }
    catch (error) { throw routeError(error); }
  });
  app.get("/v1/anime/:kitsuId/music-requests/status", { schema: { params: animeParams }, preHandler: requireAuth }, async (request) => {
    try { return await service.status(request.params.kitsuId); }
    catch (error) { throw routeError(error); }
  });
}

function routeError(error: unknown): Error {
  if (error instanceof MusicRequestNotFoundError) return new ApiError(404, "MUSIC_REQUEST_NOT_FOUND", "Music request not found.");
  if (error instanceof MusicRequestNotMappedError) return new ApiError(409, "ANIME_NOT_MAPPED", "Anime is not mapped for music requests.");
  if (error instanceof MusicRequestEmptyError) return new ApiError(409, "MUSIC_REQUEST_EMPTY", error.message);
  return error instanceof Error ? error : new Error("Music request failed");
}
