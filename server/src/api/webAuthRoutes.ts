import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { makeRequireAuth, WEB_SESSION_COOKIE } from "./requireAuth.js";
import { InvalidAvatarError, type UserProfileApi } from "../auth/profile.js";
import type { AuthService, LoginResult } from "../auth/service.js";
import { SESSION_IDLE_REAUTH_AFTER_MS } from "../auth/service.js";
import type { LiveChangePublisher } from "../web/liveRoutes.js";

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string(),
  deviceName: z.string().min(1).max(100).optional(),
});

const profileBody = z
  .object({ displayName: z.string().trim().max(80).nullable().optional() })
  .refine((value) => value.displayName !== undefined, "A displayName is required.");

export interface WebAuthRouteOptions {
  profile: UserProfileApi;
  onLogin?: ((result: LoginResult) => Promise<void>) | undefined;
  secureCookies?: boolean | undefined;
  publisher?: LiveChangePublisher | undefined;
}

/** Auth/profile routes used by the same-origin web client. */
export function registerWebAuthRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  options: WebAuthRouteOptions,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.post("/auth/login", { schema: { body: loginBody } }, async (request, reply) => {
    const result = await authService.login(request.body);
    let profile;
    try {
      await options.onLogin?.(result);
      profile = await options.profile.getProfile(result.user.kitsuUserId);
    } catch (error) {
      try {
        const auth = await authService.authenticate(result.token);
        if (auth) await authService.logout(auth);
      } catch {
        // Preserve the original setup failure; cleanup is best effort.
      }
      throw error;
    }

    setSessionCookie(reply, result.token, options.secureCookies ?? process.env.NODE_ENV === "production");
    return {
      user: publicUser(result.user, profile, result.kitsuAvatarUrl),
      isNewUser: result.isNewUser,
      syncMode: result.syncMode,
    };
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    await authService.logout(request.auth!);
    return clearSessionCookie(reply, options.secureCookies ?? false).code(204).send();
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    const result = await authService.me(request.auth!);
    const profile = await options.profile.getProfile(request.auth!.user.kitsuUserId);
    return { ...result, user: publicUser(result.user, profile, result.kitsuAvatarUrl) };
  });

  app.patch(
    "/auth/profile",
    { schema: { body: profileBody }, preHandler: requireAuth },
    async (request) => {
      const displayName = request.body.displayName;
      const profile = await options.profile.updateDisplayName(
        request.auth!.user.kitsuUserId,
        displayName === null || displayName === undefined || displayName.trim() === ""
          ? null
          : displayName,
      );
      await options.publisher?.(request.auth!.user.kitsuUserId, ["profile"]);
      return { profile: publicProfile(profile) };
    },
  );

  const uploadAvatar = async (request: FastifyRequest) => {
    const input = extractAvatar(request);
    try {
      const profile = await options.profile.saveAvatar(
        request.auth!.user.kitsuUserId,
        input.bytes,
        input.mimeType,
      );
      await options.publisher?.(request.auth!.user.kitsuUserId, ["profile"]);
      return { profile: publicProfile(profile) };
    } catch (error) {
      if (error instanceof InvalidAvatarError) {
        throw new ApiError(400, "INVALID_AVATAR", error.message);
      }
      throw error;
    }
  };

  app.post("/auth/profile/avatar", { preHandler: requireAuth }, uploadAvatar);
  app.put("/auth/profile/avatar", { preHandler: requireAuth }, uploadAvatar);

  app.delete("/auth/profile/avatar", { preHandler: requireAuth }, async (request, reply) => {
    const profile = await options.profile.removeAvatar(request.auth!.user.kitsuUserId);
    await options.publisher?.(request.auth!.user.kitsuUserId, ["profile"]);
    return reply.send({ profile: publicProfile(profile) });
  });

  app.get("/auth/profile/avatar", { preHandler: requireAuth }, async (request, reply) => {
    const avatar = await options.profile.readAvatar(request.auth!.user.kitsuUserId);
    if (!avatar) throw new ApiError(404, "NOT_FOUND", "No avatar has been uploaded.");
    return reply
      .header("Cache-Control", "private, max-age=300")
      .type(avatar.mimeType)
      .send(avatar.bytes);
  });
}

export function registerWebBodyParsers(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(/^image\/.+$/i, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  fastify.addContentTypeParser(/^multipart\/form-data/i, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
}

function publicUser(user: { kitsuUserId: string; username: string }, profile: { displayName: string | null; avatarPath: string | null }, kitsuAvatarUrl: string | null) {
  return {
    kitsuUserId: user.kitsuUserId,
    username: user.username,
    kitsuAvatarUrl,
    ...publicProfile(profile),
  };
}

function publicProfile(profile: { displayName: string | null; avatarPath: string | null }) {
  return {
    displayName: profile.displayName,
    avatarUrl: profile.avatarPath ? "/api/auth/profile/avatar" : null,
  };
}

function setSessionCookie(reply: { header(name: string, value: string): unknown }, token: string, secure: boolean): void {
  const securePart = secure ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${WEB_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_IDLE_REAUTH_AFTER_MS / 1000)}${securePart}`,
  );
}

function clearSessionCookie(reply: { header(name: string, value: string): any }, secure: boolean): any {
  const securePart = secure ? "; Secure" : "";
  return reply.header(
    "Set-Cookie",
    `${WEB_SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${securePart}`,
  );
}

function extractAvatar(request: FastifyRequest): { bytes: Buffer; mimeType: string } {
  const body = request.body;
  const contentType = request.headers["content-type"] ?? "";
  if (!body || (!Buffer.isBuffer(body) && !(body instanceof Uint8Array))) {
    throw new ApiError(400, "INVALID_AVATAR", "An avatar image is required.");
  }
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const part = parseMultipartAvatar(bytes, contentType);
    if (!part) throw new ApiError(400, "INVALID_AVATAR", "An avatar image is required.");
    return part;
  }
  return { bytes, mimeType: contentType.split(";", 1)[0]!.trim().toLowerCase() };
}

function parseMultipartAvatar(body: Buffer, contentType: string): { bytes: Buffer; mimeType: string } | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]?.trim();
  if (!boundary || boundary.length > 200) return null;
  const source = body.toString("latin1");
  const marker = `--${boundary}`;
  let cursor = 0;
  while (true) {
    const start = source.indexOf(marker, cursor);
    if (start < 0) return null;
    const headersStart = start + marker.length;
    if (source.slice(headersStart, headersStart + 2) === "--") return null;
    const contentStart = source.indexOf("\r\n\r\n", headersStart);
    if (contentStart < 0) return null;
    const headers = source.slice(headersStart, contentStart).toLowerCase();
    const nextBoundary = source.indexOf(`\r\n${marker}`, contentStart + 4);
    if (nextBoundary < 0) return null;
    if (headers.includes("filename=") || headers.includes('name="avatar"')) {
      const mimeMatch = /content-type:\s*([^\r\n]+)/i.exec(source.slice(headersStart, contentStart));
      const mimeType = mimeMatch?.[1]?.trim() ?? "";
      return {
        bytes: Buffer.from(source.slice(contentStart + 4, nextBoundary), "latin1"),
        mimeType,
      };
    }
    cursor = nextBoundary + 2;
  }
}
