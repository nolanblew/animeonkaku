import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeRequireAuth } from "./requireAuth.js";

export interface ProxyApiService {
  search(userId: string, query: string): Promise<unknown>;
  artist(slug: string): Promise<unknown>;
}

export interface ProxyUpstream {
  search(query: string): Promise<unknown>;
  artist(slug: string): Promise<unknown>;
}

export interface CachedProxyServiceOptions {
  upstream: ProxyUpstream;
  musicSearch?: (
    userId: string,
    query: string,
  ) => Promise<{ releases: unknown[]; tracks: unknown[] }>;
  ttlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

export class CachedProxyService implements ProxyApiService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: CachedProxyServiceOptions) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  async search(userId: string, query: string): Promise<unknown> {
    const [legacy, music] = await Promise.all([
      this.cached(`search:${query}`, () => this.options.upstream.search(query)),
      this.options.musicSearch?.(userId, query) ?? Promise.resolve({ releases: [], tracks: [] }),
    ]);
    return {
      ...(isRecord(legacy) ? legacy : { legacy }),
      music,
    };
  }

  async artist(slug: string): Promise<unknown> {
    return this.cached(`artist:${slug}`, () => this.options.upstream.artist(slug));
  }

  private async cached(key: string, load: () => Promise<unknown>): Promise<unknown> {
    const now = this.now();
    const existing = this.cache.get(key);
    if (existing && existing.expiresAt > now) {
      return existing.value;
    }
    const value = await load();
    this.cache.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }
}

const searchQuery = z.object({
  q: z.string().min(1),
});

const artistParams = z.object({
  slug: z.string().min(1),
});

export function registerProxyRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  service: ProxyApiService,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.get(
    "/v1/search",
    { schema: { querystring: searchQuery }, preHandler: requireAuth },
    async (request) => service.search(request.auth!.user.kitsuUserId, request.query.q),
  );

  app.get(
    "/v1/artists/:slug",
    { schema: { params: artistParams }, preHandler: requireAuth },
    async (request) => service.artist(request.params.slug),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
