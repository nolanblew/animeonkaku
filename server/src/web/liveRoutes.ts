import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "../api/errors.js";
import { makeRequireAuth } from "../api/requireAuth.js";

/** The categories a browser needs to invalidate after a write or sync. */
export type LiveChangeCategory = "library" | "playlist" | "profile";

const LIVE_CHANGE_CATEGORIES: readonly LiveChangeCategory[] = ["library", "playlist", "profile"];

export interface LiveChangePublishOptions {
  /** The `/v1/changes` cursor known by the writer, when available. */
  sourceCursor?: number | undefined;
}

export interface LiveChangeNotification {
  cursor: number;
  categories: LiveChangeCategory[];
  sourceCursor: number | null;
}

export interface LivePublishResult extends LiveChangeNotification {
  delivered: number;
}

export interface BrowserHomeAnimeSummary {
  kitsuId: string;
  title: string | null;
  posterUrl: string | null;
  updatedAt: number;
}

export interface BrowserHomePlaylistSummary {
  id: number;
  name: string;
  itemCount: number;
  isAuto: boolean;
  updatedAt: number;
}

/** A bounded projection for the browser home screen; detailed pages use the existing APIs. */
export interface BrowserHomeResponse {
  serverTime: number;
  continueWatching: BrowserHomeAnimeSummary[];
  recentlyAdded: BrowserHomeAnimeSummary[];
  playlists: BrowserHomePlaylistSummary[];
  nextCursor: string | null;
}

export interface BrowserHomeService {
  getHome(userId: string, options: { limit: number; cursor: string | null }): Promise<BrowserHomeResponse>;
}

export interface LiveRoutesOptions {
  hub: LiveLibraryHub;
  home?: BrowserHomeService | undefined;
}

export interface LiveSseTransport {
  write(chunk: string): boolean;
  on(event: "close" | "drain" | "error", listener: () => void): this;
  removeListener(event: "close" | "drain" | "error", listener: () => void): this;
  end(): void;
  destroyed?: boolean | undefined;
}

interface PendingChange {
  cursor: number;
  categories: LiveChangeCategory[];
  sourceCursor: number | null;
}

interface Subscriber {
  transport: LiveSseTransport;
  changesPath: string;
  pending: PendingChange | null;
  blockedSince: number | null;
  closed: boolean;
  onClose: () => void;
  onDrain: () => void;
  onError: () => void;
}

interface UserState {
  cursor: number;
  sourceCursor: number | null;
  subscribers: Set<Subscriber>;
  lastActiveAt: number;
}

export interface LiveLibraryHubOptions {
  heartbeatMs?: number | undefined;
  maxBackpressureMs?: number | undefined;
  maxSubscribersPerUser?: number | undefined;
  idleStateMs?: number | undefined;
  now?: (() => number) | undefined;
}

/**
 * In-process fan-out for browser invalidation hints.
 *
 * It deliberately carries categories and cursors only. The browser follows an
 * event with the existing authenticated `/v1/changes` request, so this class
 * never performs external API calls or retains library records in memory.
 */
export class LiveLibraryHub {
  private readonly heartbeatMs: number;
  private readonly maxBackpressureMs: number;
  private readonly maxSubscribersPerUser: number;
  private readonly idleStateMs: number;
  private readonly now: () => number;
  private readonly users = new Map<string, UserState>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: LiveLibraryHubOptions = {}) {
    this.heartbeatMs = options.heartbeatMs ?? 25_000;
    this.maxBackpressureMs = options.maxBackpressureMs ?? 30_000;
    this.maxSubscribersPerUser = options.maxSubscribersPerUser ?? 32;
    this.idleStateMs = options.idleStateMs ?? 5 * 60_000;
    this.now = options.now ?? (() => Date.now());
    if (this.heartbeatMs < 0 || this.maxBackpressureMs < 0 || this.maxSubscribersPerUser < 1 || this.idleStateMs < 0) {
      throw new Error("LiveLibraryHub limits must be non-negative and subscriber capacity must be positive.");
    }
  }

  /** Returns whether a new stream may be opened for the user. */
  canSubscribe(userId: string): boolean {
    return (this.users.get(userId)?.subscribers.size ?? 0) < this.maxSubscribersPerUser;
  }

  subscriberCount(userId: string): number {
    return this.users.get(userId)?.subscribers.size ?? 0;
  }

  totalSubscriberCount(): number {
    let count = 0;
    for (const state of this.users.values()) count += state.subscribers.size;
    return count;
  }

  /**
   * Opens a stream and returns a cleanup callback. `close`/`error` events also
   * clean it up, making disconnects safe even when the caller does not retain
   * the callback.
   */
  subscribe(
    userId: string,
    transport: LiveSseTransport,
    options: { lastEventId?: number | undefined; changesPath?: string | undefined } = {},
  ): () => void {
    const state = this.userState(userId);
    if (state.subscribers.size >= this.maxSubscribersPerUser) {
      throw new LiveSubscriberLimitError();
    }

    const subscriber: Subscriber = {
      transport,
      changesPath: options.changesPath ?? "/v1/changes",
      pending: null,
      blockedSince: null,
      closed: false,
      onClose: () => this.remove(userId, subscriber),
      onDrain: () => this.flushPending(userId, subscriber),
      onError: () => this.remove(userId, subscriber),
    };
    state.subscribers.add(subscriber);
    state.lastActiveAt = this.now();
    transport.on("close", subscriber.onClose);
    transport.on("drain", subscriber.onDrain);
    transport.on("error", subscriber.onError);
    this.ensureHeartbeatTimer();

    const lastEventId = options.lastEventId;
    const resync = lastEventId !== undefined && lastEventId < state.cursor;
    this.write(
      userId,
      subscriber,
      sseEvent("ready", state.cursor, {
        cursor: state.cursor,
        sourceCursor: state.sourceCursor,
        resync,
        ...(resync ? { since: state.sourceCursor, pollUrl: changesUrl(state.sourceCursor, subscriber.changesPath) } : {}),
      }),
    );

    return () => this.remove(userId, subscriber);
  }

  publish(
    userId: string,
    categories: readonly LiveChangeCategory[],
    options: LiveChangePublishOptions = {},
  ): LivePublishResult {
    const state = this.userState(userId);
    const normalizedCategories = normalizeCategories(categories);
    if (normalizedCategories.length === 0) {
      return {
        cursor: state.cursor,
        categories: [],
        sourceCursor: state.sourceCursor,
        delivered: 0,
      };
    }

    state.cursor += 1;
    if (options.sourceCursor !== undefined && Number.isSafeInteger(options.sourceCursor) && options.sourceCursor >= 0) {
      state.sourceCursor = Math.max(state.sourceCursor ?? 0, options.sourceCursor);
    }
    state.lastActiveAt = this.now();
    const notification: PendingChange = {
      cursor: state.cursor,
      categories: normalizedCategories,
      sourceCursor: state.sourceCursor,
    };
    let delivered = 0;
    for (const subscriber of state.subscribers) {
      if (this.sendChange(userId, subscriber, notification)) delivered += 1;
    }
    this.cleanupIdleStates();
    return { ...notification, delivered };
  }

  /** Called by the app shutdown hook; closes all client streams and timers. */
  close(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    for (const [userId, state] of this.users) {
      for (const subscriber of [...state.subscribers]) {
        this.remove(userId, subscriber);
        try {
          subscriber.transport.end();
        } catch {
          // The socket may already have been closed by the peer.
        }
      }
    }
    this.users.clear();
  }

  private userState(userId: string): UserState {
    let state = this.users.get(userId);
    if (!state) {
      state = { cursor: 0, sourceCursor: null, subscribers: new Set(), lastActiveAt: this.now() };
      this.users.set(userId, state);
    }
    return state;
  }

  private sendChange(userId: string, subscriber: Subscriber, notification: PendingChange): boolean {
    if (subscriber.closed) return false;
    if (subscriber.blockedSince !== null) {
      subscriber.pending = mergeChanges(subscriber.pending, notification);
      return false;
    }
    return this.write(userId, subscriber, sseEvent("change", notification.cursor, {
      categories: notification.categories,
      cursor: notification.cursor,
      sourceCursor: notification.sourceCursor,
      pollUrl: changesUrl(notification.sourceCursor, subscriber.changesPath),
    }), notification);
  }

  private write(userId: string, subscriber: Subscriber, payload: string, pending?: PendingChange): boolean {
    if (subscriber.closed) return false;
    if (subscriber.transport.destroyed) {
      this.remove(userId, subscriber);
      return false;
    }
    try {
      const writable = subscriber.transport.write(payload);
      if (!writable) {
        subscriber.blockedSince = this.now();
        if (pending) subscriber.pending = mergeChanges(subscriber.pending, pending);
      }
      return true;
    } catch {
      this.remove(userId, subscriber);
      return false;
    }
  }

  private flushPending(userId: string, subscriber: Subscriber): void {
    if (subscriber.closed) return;
    subscriber.blockedSince = null;
    const pending = subscriber.pending;
    subscriber.pending = null;
    if (pending) this.sendChange(userId, subscriber, pending);
  }

  private remove(userId: string, subscriber: Subscriber): void {
    if (subscriber.closed) return;
    subscriber.closed = true;
    subscriber.transport.removeListener("close", subscriber.onClose);
    subscriber.transport.removeListener("drain", subscriber.onDrain);
    subscriber.transport.removeListener("error", subscriber.onError);
    const state = this.users.get(userId);
    state?.subscribers.delete(subscriber);
    if (state) state.lastActiveAt = this.now();
    if (this.totalSubscriberCount() === 0 && this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private ensureHeartbeatTimer(): void {
    if (this.heartbeatMs <= 0 || this.heartbeatTimer !== undefined) return;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    if (typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      this.heartbeatTimer.unref();
    }
  }

  private heartbeat(): void {
    const now = this.now();
    for (const [userId, state] of this.users) {
      for (const subscriber of [...state.subscribers]) {
        if (subscriber.blockedSince !== null) {
          if (now - subscriber.blockedSince >= this.maxBackpressureMs) {
            this.remove(userId, subscriber);
            try {
              subscriber.transport.end();
            } catch {
              // Ignore a peer that already disconnected.
            }
          }
          continue;
        }
        this.write(userId, subscriber, sseEvent("heartbeat", state.cursor, {
          cursor: state.cursor,
          sourceCursor: state.sourceCursor,
        }));
      }
    }
    this.cleanupIdleStates(now);
  }

  private cleanupIdleStates(now = this.now()): void {
    for (const [userId, state] of this.users) {
      if (state.subscribers.size === 0 && now - state.lastActiveAt >= this.idleStateMs) {
        this.users.delete(userId);
      }
    }
  }
}

export class LiveSubscriberLimitError extends Error {
  constructor() {
    super("The maximum number of live browser streams is already connected for this user.");
    this.name = "LiveSubscriberLimitError";
  }
}

const liveQuery = z.object({
  cursor: z.coerce.number().int().nonnegative().optional(),
});

const homeQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(256).optional(),
});

export function registerLiveRoutes(
  fastify: FastifyInstance,
  authService: AuthService,
  options: LiveRoutesOptions,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const requireAuth = makeRequireAuth(authService);

  app.get(
    "/v1/library/live",
    { schema: { querystring: liveQuery }, preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.auth!.user.kitsuUserId;
      const lastEventId = request.query.cursor ?? readLastEventId(request.headers["last-event-id"]);
      if (!options.hub.canSubscribe(userId)) {
        throw new ApiError(429, "LIVE_STREAM_LIMIT", "Too many live browser streams for this user.");
      }
      startSse(reply);
      options.hub.subscribe(userId, reply.raw as unknown as LiveSseTransport, {
        lastEventId,
        changesPath: request.url.startsWith("/api/") ? "/api/v1/changes" : "/v1/changes",
      });
      return reply;
    },
  );

  if (options.home) {
    const home = options.home;
    app.get(
      "/v1/home",
      { schema: { querystring: homeQuery }, preHandler: requireAuth },
      async (request) => {
        const limit = request.query.limit ?? 24;
        const response = await home.getHome(request.auth!.user.kitsuUserId, {
          limit,
          cursor: request.query.cursor ?? null,
        });
        return boundHomeResponse(response, limit);
      },
    );
  }

  fastify.addHook("onClose", async () => options.hub.close());
}

function startSse(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders?.();
}

function boundHomeResponse(response: BrowserHomeResponse, limit: number): BrowserHomeResponse {
  return {
    ...response,
    continueWatching: response.continueWatching.slice(0, limit),
    recentlyAdded: response.recentlyAdded.slice(0, limit),
    playlists: response.playlists.slice(0, limit),
  };
}

function readLastEventId(value: string | string[] | undefined): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text?.trim()) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeCategories(categories: readonly LiveChangeCategory[]): LiveChangeCategory[] {
  const set = new Set(categories);
  return LIVE_CHANGE_CATEGORIES.filter((category) => set.has(category));
}

function mergeChanges(previous: PendingChange | null, next: PendingChange): PendingChange {
  if (!previous) return { ...next, categories: [...next.categories] };
  const sourceCursor = previous.sourceCursor === null
    ? next.sourceCursor
    : next.sourceCursor === null
      ? previous.sourceCursor
      : Math.max(previous.sourceCursor, next.sourceCursor);
  return {
    cursor: Math.max(previous.cursor, next.cursor),
    categories: normalizeCategories([...previous.categories, ...next.categories]),
    sourceCursor,
  };
}

function changesUrl(sourceCursor: number | null, changesPath = "/v1/changes"): string {
  return sourceCursor === null ? changesPath : `${changesPath}?since=${encodeURIComponent(sourceCursor)}`;
}

function sseEvent(event: string, id: number, data: unknown): string {
  return `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
}
