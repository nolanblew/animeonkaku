import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { registerLiveRoutes, LiveLibraryHub, type BrowserHomeResponse, type LiveChangeCategory } from "../src/web/liveRoutes.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-live-test-"));

class FakeTransport {
  readonly writes: string[] = [];
  ended = false;
  writable = true;
  private readonly listeners = new Map<string, Set<() => void>>();

  write(chunk: string): boolean {
    if (this.ended) throw new Error("write after end");
    this.writes.push(chunk);
    return this.writable;
  }

  on(event: string, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event: string, listener: () => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.emit("close");
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

const homeResponse: BrowserHomeResponse = {
  serverTime: 1_760_000_000_000,
  continueWatching: [
    { kitsuId: "1", title: "Bocchi the Rock!", posterUrl: "/v1/media/images/anime/1/poster", updatedAt: 10 },
  ],
  recentlyAdded: [],
  playlists: [{ id: 7, name: "Liked Songs", itemCount: 3, isAuto: true, updatedAt: 11 }],
  nextCursor: "page-2",
};

let app: FastifyInstance;
let auth: AuthService;
let hub: LiveLibraryHub;
let homeCalls: Array<{ userId: string; limit: number; cursor: string | null }>;

beforeEach(() => {
  auth = new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient());
  hub = new LiveLibraryHub({ heartbeatMs: 10, maxBackpressureMs: 100, now: () => Date.now() });
  homeCalls = [];
  app = buildApp({
    authService: auth,
    health: { pingDb: async () => {}, mediaRoot },
  });
  registerLiveRoutes(app, auth, {
    hub,
    home: {
      async getHome(userId, options) {
        homeCalls.push({ userId, ...options });
        return homeResponse;
      },
    },
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
});

async function bearer(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username: "nolan", password: "hunter2" },
  });
  return response.json().token as string;
}

describe("LiveLibraryHub", () => {
  it("publishes category changes with bounded, monotonic cursors", () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    hub.subscribe("stub-nolan", first);
    hub.subscribe("stub-nolan", second);

    const result = hub.publish("stub-nolan", ["playlist", "library", "playlist"], { sourceCursor: 100 });

    expect(result).toMatchObject({ cursor: 1, delivered: 2 });
    expect(first.writes.at(-1)).toContain('"categories":["library","playlist"]');
    expect(first.writes.at(-1)).toContain('"sourceCursor":100');
    expect(first.writes.at(-1)).toContain("event: change");
  });

  it("coalesces notifications while backpressured and flushes one bounded update on drain", () => {
    const transport = new FakeTransport();
    hub.subscribe("stub-nolan", transport);
    transport.writable = false;

    hub.publish("stub-nolan", ["library"], { sourceCursor: 10 });
    hub.publish("stub-nolan", ["profile"], { sourceCursor: 11 });
    expect(transport.writes).toHaveLength(2); // ready + the write that entered backpressure

    transport.writable = true;
    transport.emit("drain");

    expect(transport.writes).toHaveLength(3);
    expect(transport.writes.at(-1)).toContain('"categories":["library","profile"]');
    expect(transport.writes.at(-1)).toContain('"sourceCursor":11');
  });

  it("uses the last event id as a resync hint and cleans up closed subscribers", () => {
    hub.publish("stub-nolan", ["library"], { sourceCursor: 500 });
    const transport = new FakeTransport();

    hub.subscribe("stub-nolan", transport, { lastEventId: 0 });

    expect(transport.writes[0]).toContain("event: ready");
    expect(transport.writes[0]).toContain('"resync":true');
    expect(transport.writes[0]).toContain('"sourceCursor":500');
    expect(transport.writes[0]).toContain("/v1/changes?since=500");
    expect(hub.subscriberCount("stub-nolan")).toBe(1);

    transport.emit("close");
    expect(hub.subscriberCount("stub-nolan")).toBe(0);
  });

  it("sends heartbeats and expires a subscriber that never drains", () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    hub.subscribe("stub-nolan", transport);
    transport.writable = false;

    vi.advanceTimersByTime(10);
    expect(transport.writes.at(-1)).toContain("event: heartbeat");

    vi.advanceTimersByTime(100);
    expect(transport.ended).toBe(true);
    expect(hub.subscriberCount("stub-nolan")).toBe(0);
  });
});

describe("live browser routes", () => {
  it("requires the existing bearer auth abstraction for both browser endpoints", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/library/live" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/home" })).statusCode).toBe(401);
  });

  it("returns a bounded home projection and passes the opaque page cursor", async () => {
    const token = await bearer();
    const response = await app.inject({
      method: "GET",
      url: "/v1/home?limit=24&cursor=page-2",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(homeCalls).toEqual([{ userId: "stub-nolan", limit: 24, cursor: "page-2" }]);
    expect(response.json()).toEqual(homeResponse);
  });

  it("authenticates an SSE stream and delivers a published category notification", async () => {
    const token = await bearer();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a port");

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/library/live`, {
      headers: { authorization: `Bearer ${token}`, "last-event-id": "0" },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).not.toBeNull();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("event: ready");

    hub.publish("stub-nolan", ["profile"], { sourceCursor: 700 });
    const second = await reader.read();
    const chunk = decoder.decode(second.value);
    expect(chunk).toContain("event: change");
    expect(chunk).toContain('"categories":["profile"]');
    expect(chunk).toContain('"sourceCursor":700');

    await reader.cancel();
    controller.abort();
  });

  it("rejects an unbounded home request", async () => {
    const token = await bearer();
    const response = await app.inject({
      method: "GET",
      url: "/v1/home?limit=101",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(400);
  });
});

// Keep this compile-time assertion close to the contract so category additions
// cannot accidentally widen the wire format without updating the tests.
const allLiveCategories: LiveChangeCategory[] = ["library", "playlist", "profile"];
expect(allLiveCategories).toHaveLength(3);
