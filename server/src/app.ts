import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerAuthRoutes } from "./api/authRoutes.js";
import { registerAdminRoutes, type AdminDashboardApi, type MusicSearchSettingsApi } from "./admin/routes.js";
import { registerClientRoutes, type ClientApiService } from "./api/clientRoutes.js";
import { ApiError, errorEnvelope } from "./api/errors.js";
import { registerHealthRoutes, type HealthDeps } from "./api/healthRoutes.js";
import { registerMediaRoutes, type MediaStreamingService } from "./api/mediaRoutes.js";
import { registerProxyRoutes, type ProxyApiService } from "./api/proxyRoutes.js";
import type { AuthService, LoginResult } from "./auth/service.js";
import { KitsuAuthError, type UserRecord } from "./auth/types.js";
import { registerJobAdminRoutes, type JobAdminService } from "./jobs/adminRoutes.js";
import type { LegacyLibraryImportService } from "./legacyLibraryImport.js";
import { registerSyncRoutes, type SyncApiService } from "./api/syncRoutes.js";
import { registerMusicRequestRoutes, type MusicRequestService } from "./music/requests/index.js";
import { registerMusicOperatorRoutes, type MusicOperatorApiService } from "./music/operator/index.js";
import { registerWebAuthRoutes, registerWebBodyParsers } from "./api/webAuthRoutes.js";
import { parseCookieHeader, WEB_SESSION_COOKIE } from "./api/requireAuth.js";
import type { UserProfileApi } from "./auth/profile.js";

export interface AppDeps {
  authService: AuthService;
  health: HealthDeps;
  jobs?: JobAdminService;
  clientApi?: ClientApiService;
  mediaApi?: MediaStreamingService;
  syncApi?: SyncApiService;
  proxyApi?: ProxyApiService;
  legacyLibraryImport?: LegacyLibraryImportService;
  musicRequests?: MusicRequestService;
  musicOperator?: MusicOperatorApiService;
  musicSearchSettings?: MusicSearchSettingsApi;
  adminDashboard?: AdminDashboardApi;
  adminPassword?: string;
  webAuth?: {
    profile: UserProfileApi;
    secureCookies?: boolean;
  };
  onLogin?: (result: LoginResult) => Promise<void>;
  /**
   * Fires after every request that carried a valid session (post-response, so
   * it never adds latency). Drives the device-activity sync trigger.
   */
  onAuthenticatedRequest?: (user: UserRecord) => Promise<void>;
  logger?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 3 * 1024 * 1024 });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerWebBodyParsers(app);

  // Cookies are automatically attached by browsers, so every state-changing
  // /api request carrying the web session must prove same-origin intent. A
  // bearer-authenticated Android request is unaffected by this check.
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/") || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      return;
    }
    const cookie = parseCookieHeader(request.headers.cookie ?? "").get(WEB_SESSION_COOKIE);
    if (!cookie) return;
    if (!isSameOriginRequest(request)) {
      return reply.code(403).send(errorEnvelope("CSRF_ORIGIN_REQUIRED", "A same-origin request is required."));
    }
  });

  if (deps.onAuthenticatedRequest) {
    const onAuthenticatedRequest = deps.onAuthenticatedRequest;
    app.addHook("onResponse", async (request) => {
      const user = request.auth?.user;
      if (!user) return;
      try {
        await onAuthenticatedRequest(user);
      } catch (error) {
        request.log.warn({ err: error }, "onAuthenticatedRequest hook failed");
      }
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof KitsuAuthError) {
      return reply.code(401).send(errorEnvelope("KITSU_AUTH_FAILED", error.message));
    }
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(errorEnvelope(error.code, error.message));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send(errorEnvelope("BAD_REQUEST", error.message));
    }
    // Client-caused Fastify errors (malformed JSON body, payload too large, …)
    const { statusCode, message } = error as { statusCode?: unknown; message?: unknown };
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply
        .code(statusCode)
        .send(errorEnvelope("BAD_REQUEST", typeof message === "string" ? message : "Bad request."));
    }
    request.log.error(error);
    return reply.code(500).send(errorEnvelope("INTERNAL", "Internal server error."));
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorEnvelope("NOT_FOUND", "Route not found."));
  });

  registerHealthRoutes(app, deps.health);
  if (deps.musicSearchSettings) {
    if (!deps.adminPassword) throw new Error("ADMIN_PASSWORD is required when the admin dashboard is enabled.");
    registerAdminRoutes(app, deps.musicSearchSettings, deps.adminPassword, deps.adminDashboard);
  }
  registerApiRoutes(app, deps, false);
  app.register(
    (api, _opts, done) => {
      registerApiRoutes(api, deps, true);
      done();
    },
    { prefix: "/api" },
  );

  return app;
}

function registerApiRoutes(app: FastifyInstance, deps: AppDeps, webPrefix: boolean): void {
  if (webPrefix && deps.webAuth) {
    registerWebAuthRoutes(app, deps.authService, {
      profile: deps.webAuth.profile,
      onLogin: deps.onLogin,
      secureCookies: deps.webAuth.secureCookies,
    });
  }
  registerAuthRoutes(app, deps.authService, {
    onLogin: deps.onLogin,
    legacyLibraryImport: deps.legacyLibraryImport,
  });
  if (deps.clientApi) {
    registerClientRoutes(app, deps.authService, deps.clientApi);
  }
  if (deps.mediaApi) {
    registerMediaRoutes(app, deps.authService, deps.mediaApi);
  }
  if (deps.syncApi) {
    registerSyncRoutes(app, deps.authService, deps.syncApi);
  }
  if (deps.proxyApi) {
    registerProxyRoutes(app, deps.authService, deps.proxyApi);
  }
  if (deps.jobs) {
    registerJobAdminRoutes(app, deps.authService, deps.jobs);
  }
  if (deps.musicRequests) {
    registerMusicRequestRoutes(app, deps.authService, deps.musicRequests);
  }
  if (deps.musicOperator) registerMusicOperatorRoutes(app, deps.authService, deps.musicOperator);
}

function isSameOriginRequest(request: { headers: Record<string, string | string[] | undefined>; protocol: string }): boolean {
  const origin = firstHeader(request.headers.origin);
  const referer = firstHeader(request.headers.referer);
  const candidate = origin ?? referer;
  if (!candidate) return false;
  try {
    const candidateUrl = new URL(candidate);
    const forwardedProto = firstHeader(request.headers["x-forwarded-proto"])?.split(",", 1)[0]?.trim();
    const forwardedHost = firstHeader(request.headers["x-forwarded-host"])?.split(",", 1)[0]?.trim();
    const protocol = forwardedProto || request.protocol;
    const host = forwardedHost || firstHeader(request.headers.host);
    if (!host) return false;
    return candidateUrl.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
