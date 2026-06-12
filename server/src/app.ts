import Fastify, { type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { registerAuthRoutes } from "./api/authRoutes.js";
import { ApiError, errorEnvelope } from "./api/errors.js";
import { registerHealthRoutes, type HealthDeps } from "./api/healthRoutes.js";
import type { AuthService } from "./auth/service.js";
import { KitsuAuthError } from "./auth/types.js";

export interface AppDeps {
  authService: AuthService;
  health: HealthDeps;
  logger?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

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
  registerAuthRoutes(app, deps.authService);

  return app;
}
